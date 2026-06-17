import { NextResponse } from "next/server";

/**
 * Webhook Cal.com — réception des événements de réservation.
 *
 * Cal.com appelle cette route en POST à chaque événement abonné
 * (réservation créée / annulée / déplacée, etc.). Voir WEBHOOKS.md pour la
 * configuration côté Cal.com (URL, événements à cocher, secret de signature).
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ SÉCURITÉ — vérification de signature (OBLIGATOIRE)                         │
 * │                                                                           │
 * │ Cal.com signe chaque payload avec un HMAC-SHA256 du corps brut, en        │
 * │ utilisant le "Secret" configuré côté Cal. La signature (hex) arrive dans  │
 * │ le header `X-Cal-Signature-256`. On la recalcule avec                     │
 * │ `CALCOM_WEBHOOK_SECRET` et on rejette (401) si elle ne correspond pas.    │
 * │                                                                           │
 * │ ⚠️ CALCOM_WEBHOOK_SECRET ≠ CALCOM_API_KEY :                               │
 * │   - CALCOM_API_KEY  : clé API pour APPELER l'API Cal.com (sortant).        │
 * │   - CALCOM_WEBHOOK_SECRET : secret de SIGNATURE des webhooks (entrant),    │
 * │     une chaîne qu'on génère et qu'on colle dans Cal → Settings → Webhooks. │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ RUNTIME — Cloudflare Workers (edge, via OpenNext).                        │
 * │   On utilise UNIQUEMENT Web Crypto (`crypto.subtle`) pour le HMAC, JAMAIS │
 * │   le module `crypto` de Node (indisponible sur Workers).                  │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

/** Événements Cal.com qu'on sait traiter. Cf. docs Cal "triggerEvent". */
type CalTriggerEvent =
  | "BOOKING_CREATED"
  | "BOOKING_CANCELLED"
  | "BOOKING_RESCHEDULED"
  | "BOOKING_REQUESTED"
  | "BOOKING_REJECTED"
  | "BOOKING_PAYMENT_INITIATED"
  | "BOOKING_PAID"
  | "MEETING_ENDED"
  | "MEETING_STARTED";

interface CalWebhookPayload {
  triggerEvent: CalTriggerEvent | string;
  createdAt?: string;
  // Le contenu exact de `payload` varie selon l'événement. On le garde large
  // pour l'instant ; on typera finement quand on implémentera chaque cas.
  payload?: {
    uid?: string;
    title?: string;
    startTime?: string;
    endTime?: string;
    attendees?: Array<{ name?: string; email?: string; timeZone?: string }>;
    organizer?: { name?: string; email?: string };
    [key: string]: unknown;
  };
  [key: string]: unknown;
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

/**
 * Vérifie la signature HMAC-SHA256 du corps brut (edge-compatible, Web Crypto).
 * @returns true si la signature fournie correspond au HMAC du body.
 */
async function verifyCalSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): Promise<boolean> {
  if (!signatureHeader) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuffer = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  const expected = toHex(sigBuffer);

  // Cal.com envoie la signature en hex. On normalise en minuscules et on
  // tolère un éventuel préfixe "sha256=".
  const provided = signatureHeader.replace(/^sha256=/i, "").trim().toLowerCase();

  return timingSafeEqualHex(expected, provided);
}

export async function POST(request: Request) {
  const secret = process.env.CALCOM_WEBHOOK_SECRET;

  // Sans secret configuré, on refuse de traiter quoi que ce soit : un webhook
  // non vérifié est une porte d'entrée non authentifiée. Fail-safe.
  if (!secret) {
    console.error(
      "[webhook:cal] CALCOM_WEBHOOK_SECRET manquant — webhook rejeté.",
    );
    return NextResponse.json(
      { error: "Webhook non configuré." },
      { status: 500 },
    );
  }

  // On lit le corps BRUT (string) : le HMAC se calcule sur les octets exacts
  // reçus, pas sur un JSON re-sérialisé (qui changerait l'ordre/les espaces).
  const rawBody = await request.text();
  const signature = request.headers.get("x-cal-signature-256");

  const valid = await verifyCalSignature(rawBody, signature, secret);
  if (!valid) {
    console.warn("[webhook:cal] Signature invalide — requête rejetée (401).");
    return NextResponse.json({ error: "Signature invalide." }, { status: 401 });
  }

  let event: CalWebhookPayload;
  try {
    event = JSON.parse(rawBody) as CalWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Payload JSON invalide." }, { status: 400 });
  }

  const trigger = event.triggerEvent;
  const bookingUid = event.payload?.uid ?? "(uid inconnu)";

  // ──────────────────────────────────────────────────────────────────────
  // Routage par type d'événement.
  // Pour l'instant : log structuré + TODO métier par cas. La logique réelle
  // (DB, email, etc.) sera implémentée ici, cas par cas.
  // ──────────────────────────────────────────────────────────────────────
  switch (trigger) {
    case "BOOKING_CREATED":
      // TODO: enregistrer la réservation en DB (lier au profil via l'email de
      // l'attendee) + notifier (mail de confirmation / alerte Alice).
      console.info(`[webhook:cal] BOOKING_CREATED — uid=${bookingUid}`);
      break;

    case "BOOKING_CANCELLED":
      // TODO: marquer la réservation comme annulée en DB + notifier.
      console.info(`[webhook:cal] BOOKING_CANCELLED — uid=${bookingUid}`);
      break;

    case "BOOKING_RESCHEDULED":
      // TODO: mettre à jour les dates de la réservation en DB + notifier.
      console.info(`[webhook:cal] BOOKING_RESCHEDULED — uid=${bookingUid}`);
      break;

    case "BOOKING_REQUESTED":
      // TODO: réservation en attente de confirmation (si l'event Cal exige une
      // approbation). Enregistrer l'état "pending".
      console.info(`[webhook:cal] BOOKING_REQUESTED — uid=${bookingUid}`);
      break;

    case "BOOKING_REJECTED":
      // TODO: demande refusée — nettoyer l'état "pending" + notifier.
      console.info(`[webhook:cal] BOOKING_REJECTED — uid=${bookingUid}`);
      break;

    case "BOOKING_PAID":
    case "BOOKING_PAYMENT_INITIATED":
      // TODO (lié à la phase 2 Stripe) : rapprocher le paiement de la séance.
      console.info(`[webhook:cal] ${trigger} — uid=${bookingUid}`);
      break;

    case "MEETING_STARTED":
    case "MEETING_ENDED":
      // TODO: éventuel suivi de présence / relance post-séance.
      console.info(`[webhook:cal] ${trigger} — uid=${bookingUid}`);
      break;

    default:
      // Événement non géré : on ACK quand même (200) pour éviter que Cal.com
      // ne re-tente en boucle. On log pour visibilité.
      console.info(`[webhook:cal] Événement non géré: ${trigger}`);
      break;
  }

  // Répondre 200 rapidement : Cal.com considère tout non-2xx comme un échec et
  // re-tente. La logique métier lourde devra être asynchrone / idempotente.
  return NextResponse.json({ received: true });
}

// Cal.com n'appelle ce endpoint qu'en POST. Un GET (ex: test navigateur)
// renvoie 405 explicite plutôt qu'une 404 trompeuse.
export function GET() {
  return NextResponse.json(
    { error: "Méthode non autorisée. Ce endpoint n'accepte que POST." },
    { status: 405 },
  );
}
