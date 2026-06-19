import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { logEvent } from "@/lib/events";
import { createLogger, serializeError } from "@/lib/log";

const log = createLogger("webhook:stripe");

/**
 * Webhook Stripe — réception des événements de paiement.
 *
 * Stripe appelle cette route en POST à chaque événement abonné. On ne traite
 * que `checkout.session.completed` : c'est l'événement qui confirme qu'un
 * paiement de carnet de tickets a abouti. On crédite alors la table `tickets`.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ SÉCURITÉ — vérification de signature (OBLIGATOIRE)                         │
 * │                                                                           │
 * │ Stripe signe chaque payload. Le header `Stripe-Signature` a la forme :    │
 * │   t=1700000000,v1=<hex>,v0=<hex>                                           │
 * │ Le « signed payload » est la concaténation `${t}.${rawBody}`. On en       │
 * │ calcule le HMAC-SHA256 avec `STRIPE_WEBHOOK_SECRET` (whsec_...) et on le   │
 * │ compare en timing-safe à la valeur `v1`. Rejet (400) si invalide.         │
 * │ Anti-replay : on rejette aussi si l'horodatage `t` est trop vieux (>5min).│
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ RUNTIME — Cloudflare Workers (edge, via OpenNext).                        │
 * │   HMAC en Web Crypto (`crypto.subtle`) UNIQUEMENT — jamais le module      │
 * │   `crypto` de Node (indisponible sur Workers). Écriture DB via le client  │
 * │   Supabase service_role (bypass RLS, pas de session cookie ici).          │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ IDEMPOTENCE — Stripe peut rejouer un webhook (retries, doublons réseau).  │
 * │   On déduplique sur `stripe_session_id` (index UNIQUE côté DB, Lot B) via │
 * │   un upsert `ignoreDuplicates` : une même session ne crédite JAMAIS 2×.   │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

/** Tolérance anti-replay sur l'horodatage de la signature (5 minutes). */
const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

/** Forme (partielle) d'un objet Checkout Session renvoyé par Stripe. */
interface StripeCheckoutSession {
  id: string;
  client_reference_id?: string | null;
  payment_intent?: string | null;
  payment_status?: string;
  /** Montant total payé, en CENTIMES (devise mineure) — pour la LTV / le CA. */
  amount_total?: number | null;
  metadata?: {
    user_id?: string;
    type?: string;
    quantite?: string;
  } | null;
}

/** Forme (partielle) d'un event Stripe. */
interface StripeEvent {
  id: string;
  type: string;
  data: { object: StripeCheckoutSession };
}

/** hex d'un ArrayBuffer (sortie HMAC). */
function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/**
 * Comparaison à temps constant de deux chaînes hex de même longueur.
 * Évite les timing attacks sur la vérification de signature.
 */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Parse le header `Stripe-Signature` → { t, v1 } (premier `v1` rencontré). */
function parseStripeSignatureHeader(
  header: string,
): { timestamp: number; v1: string } | null {
  let timestamp: number | null = null;
  let v1: string | null = null;

  for (const part of header.split(",")) {
    const [key, value] = part.split("=", 2);
    if (!key || value === undefined) continue;
    if (key.trim() === "t") {
      const t = Number.parseInt(value.trim(), 10);
      if (!Number.isNaN(t)) timestamp = t;
    } else if (key.trim() === "v1" && v1 === null) {
      // Stripe peut envoyer plusieurs `v1` (rotation de secret) ; on prend le
      // premier. (Avec un seul secret configuré, il n'y en a qu'un.)
      v1 = value.trim().toLowerCase();
    }
  }

  if (timestamp === null || v1 === null) return null;
  return { timestamp, v1 };
}

/**
 * Vérifie la signature Stripe du corps brut (edge-compatible, Web Crypto).
 * @returns true si `v1` correspond au HMAC-SHA256 de `${t}.${rawBody}` ET que
 *          l'horodatage est dans la fenêtre de tolérance.
 */
async function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): Promise<boolean> {
  if (!signatureHeader) return false;

  const parsed = parseStripeSignatureHeader(signatureHeader);
  if (!parsed) return false;

  // Anti-replay : on refuse une signature trop ancienne.
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - parsed.timestamp) > SIGNATURE_TOLERANCE_SECONDS) {
    return false;
  }

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  // Stripe signe la concaténation `${timestamp}.${rawBody}`.
  const signedPayload = `${parsed.timestamp}.${rawBody}`;
  const sigBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(signedPayload),
  );
  const expected = toHex(sigBuffer);

  return timingSafeEqualHex(expected, parsed.v1);
}

/**
 * Crédite les tickets correspondant à une session de paiement complétée.
 * Idempotent : déduplication sur `stripe_session_id` (index UNIQUE Lot B).
 */
async function crediterTickets(session: StripeCheckoutSession): Promise<void> {
  // user_id : on privilégie metadata.user_id, fallback client_reference_id.
  const userId = session.metadata?.user_id ?? session.client_reference_id;
  const type = session.metadata?.type;
  const quantite = Number.parseInt(session.metadata?.quantite ?? "", 10);

  // Garde-fous : sans ces données, on ne sait pas quoi créditer. On log et on
  // sort sans erreur (l'ACK 200 reste valable : rejouer n'aiderait pas).
  if (!userId || !type || Number.isNaN(quantite) || quantite <= 0) {
    log.error("Session sans données exploitables — crédit ignoré", {
      session_id: session.id,
      user_id: userId,
      type,
      quantite_raw: session.metadata?.quantite,
    });
    return;
  }

  const supabase = createServiceClient();

  // Upsert idempotent : si un ticket existe déjà pour cette session Stripe
  // (rejeu du webhook), on l'ignore au lieu de re-créditer. Repose sur l'index
  // UNIQUE sur `stripe_session_id` posé par le Lot B.
  const { error } = await supabase.from("tickets").upsert(
    {
      user_id: userId,
      type,
      quantite_initiale: quantite,
      quantite_restante: quantite,
      stripe_payment_id: session.payment_intent ?? null,
      stripe_session_id: session.id,
    },
    { onConflict: "stripe_session_id", ignoreDuplicates: true },
  );

  if (error) {
    // On remonte l'erreur à l'appelant pour répondre non-2xx → Stripe re-tente
    // (l'upsert idempotent rend ce rejeu sans danger).
    throw new Error(`Insertion ticket échouée : ${error.message}`);
  }

  log.info("Tickets crédités", {
    user_id: userId,
    type,
    quantite,
    session_id: session.id,
  });

  // ── Tracking : checkout_completed + ticket_acquired (acquisition: paid). ────
  // best-effort (le crédit ticket — métier — a déjà réussi ; un log raté n'a pas
  // à le faire échouer ni rejouer). On réutilise le client service_role déjà
  // ouvert. montant en euros (amount_total Stripe = centimes) pour LTV/CA.
  const montant =
    typeof session.amount_total === "number" ? session.amount_total / 100 : null;

  await logEvent(
    userId,
    "checkout_completed",
    {
      stripe_session_id: session.id,
      type,
      quantite,
      nb_tickets: quantite,
      montant,
    },
    { source: "webhook:stripe", service: supabase },
  );

  await logEvent(
    userId,
    "ticket_acquired",
    {
      type,
      quantite,
      acquisition_source: "paid",
      stripe_session_id: session.id,
    },
    { source: "webhook:stripe", service: supabase },
  );
}

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  // Sans secret configuré, on refuse de traiter : un webhook non vérifié est
  // une porte d'entrée non authentifiée. Fail-safe.
  if (!secret) {
    log.error("STRIPE_WEBHOOK_SECRET manquant — webhook rejeté");
    return NextResponse.json(
      { error: "Webhook non configuré." },
      { status: 500 },
    );
  }

  // Corps BRUT (string) : le HMAC se calcule sur les octets exacts reçus, pas
  // sur un JSON re-sérialisé (qui changerait l'ordre/les espaces).
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");

  const valid = await verifyStripeSignature(rawBody, signature, secret);
  if (!valid) {
    log.warn("Signature invalide ou expirée — requête rejetée (400)");
    return NextResponse.json({ error: "Signature invalide." }, { status: 400 });
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody) as StripeEvent;
  } catch {
    return NextResponse.json(
      { error: "Payload JSON invalide." },
      { status: 400 },
    );
  }

  // ── Routage par type d'événement. ──────────────────────────────────────────
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;

      // On ne crédite que si Stripe confirme le paiement. (`payment_status` est
      // `paid` pour un paiement réussi en mode=payment.)
      if (session.payment_status && session.payment_status !== "paid") {
        log.info("checkout.session.completed non payé — ignoré", {
          payment_status: session.payment_status,
          session_id: session.id,
        });
        break;
      }

      try {
        await crediterTickets(session);
      } catch (err) {
        // Erreur DB : on répond 500 pour que Stripe re-tente (idempotent).
        log.error("Crédit des tickets échoué", {
          session_id: session.id,
          err: serializeError(err),
        });
        return NextResponse.json(
          { error: "Traitement échoué, réessayer." },
          { status: 500 },
        );
      }
      break;
    }

    default:
      // Événement non géré : on ACK quand même (200) pour éviter que Stripe ne
      // re-tente en boucle. On log pour visibilité.
      log.info("Événement non géré", { event_type: event.type });
      break;
  }

  // ACK 200 rapide : Stripe considère tout non-2xx comme un échec et re-tente.
  return NextResponse.json({ received: true });
}

// Stripe n'appelle ce endpoint qu'en POST. Un GET (ex: test navigateur) renvoie
// 405 explicite plutôt qu'une 404 trompeuse.
export function GET() {
  return NextResponse.json(
    { error: "Méthode non autorisée. Ce endpoint n'accepte que POST." },
    { status: 405 },
  );
}
