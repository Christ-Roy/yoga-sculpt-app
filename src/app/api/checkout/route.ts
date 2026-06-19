import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { logEvent } from "@/lib/events";
import { createLogger, serializeError } from "@/lib/log";

const log = createLogger("checkout");

/**
 * Création d'une session de paiement Stripe pour un « carnet de tickets ».
 *
 * Modèle métier : l'utilisateur n'achète PAS une séance à l'acte, il achète des
 * crédits de séances (tickets). On crée donc une Checkout Session Stripe en
 * `mode=payment` sur un `price` Stripe (créé côté compte Alice par le team-lead)
 * et on relie le paiement au user via `client_reference_id` + `metadata`. Le
 * crédit réel des tickets en base se fait dans le webhook `/api/webhooks/stripe`
 * (sur `checkout.session.completed`), JAMAIS ici (le paiement n'est pas encore
 * confirmé à ce stade).
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ RUNTIME — Cloudflare Workers (edge, via OpenNext).                        │
 * │   PAS de SDK Stripe Node : on appelle l'API REST Stripe directement en    │
 * │   `fetch` (form-urlencoded), seul mode compatible edge sans dépendance.   │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

/**
 * Formules d'achat proposées dans l'espace client. Chaque formule mappe vers
 * un `price` Stripe (via env var) + des métadonnées que le webhook relit pour
 * savoir combien de tickets créditer et de quel type.
 *
 * Le front envoie de préférence une `formule` (stable, non devinable) ; on
 * tolère aussi un `priceId` explicite à condition qu'il corresponde à l'une des
 * formules connues — on ne laisse JAMAIS le client choisir un price arbitraire
 * (sinon il pourrait pointer vers un price à 0 €).
 */
type Formule = "collectif" | "particulier" | "carte10";

interface FormuleConfig {
  /** Nom de la variable d'env contenant le price id Stripe. */
  priceEnvVar: string;
  /** Type de ticket crédité (relu par le webhook via metadata.type). */
  type: "collectif" | "particulier";
  /** Nombre de séances créditées par cet achat. */
  quantite: number;
}

const FORMULES: Record<Formule, FormuleConfig> = {
  // Ticket unitaire « cours collectif ».
  collectif: {
    priceEnvVar: "STRIPE_PRICE_COLLECTIF",
    type: "collectif",
    quantite: 1,
  },
  // Ticket unitaire « cours particulier ».
  particulier: {
    priceEnvVar: "STRIPE_PRICE_PARTICULIER",
    type: "particulier",
    quantite: 1,
  },
  // Carte 10 séances (collectif), tarif dégressif.
  carte10: {
    priceEnvVar: "STRIPE_PRICE_CARTE10",
    type: "collectif",
    quantite: 10,
  },
};

/**
 * Corps attendu : soit `{ formule }`, soit `{ priceId }`.
 * On valide avec zod (refus strict de tout champ inconnu via `.strict()`).
 */
const bodySchema = z
  .object({
    formule: z.enum(["collectif", "particulier", "carte10"]).optional(),
    priceId: z.string().min(1).optional(),
  })
  .strict()
  .refine((data) => data.formule || data.priceId, {
    message: "Indiquer une `formule` ou un `priceId`.",
  });

/**
 * Résout la formule demandée vers sa config + son price id Stripe effectif.
 * Renvoie `null` si la demande ne correspond à aucune formule connue ou si le
 * price id env n'est pas configuré.
 */
function resolveFormule(input: {
  formule?: Formule;
  priceId?: string;
}): { config: FormuleConfig; priceId: string } | null {
  // 1) Cas `formule` explicite : on lit directement le price id de l'env.
  if (input.formule) {
    const config = FORMULES[input.formule];
    const priceId = process.env[config.priceEnvVar];
    if (!priceId) return null;
    return { config, priceId };
  }

  // 2) Cas `priceId` explicite : on vérifie qu'il correspond bien à l'une des
  //    formules connues (anti-tampering — pas de price arbitraire).
  if (input.priceId) {
    for (const config of Object.values(FORMULES)) {
      const envPriceId = process.env[config.priceEnvVar];
      if (envPriceId && envPriceId === input.priceId) {
        return { config, priceId: envPriceId };
      }
    }
  }

  return null;
}

/**
 * Détermine l'origin (schéma + host) de la requête de façon robuste derrière le
 * proxy Cloudflare : on privilégie `origin`, puis on reconstruit depuis les
 * headers de forwarding, et en dernier recours `NEXT_PUBLIC_APP_URL`.
 */
function getOrigin(request: Request): string {
  const originHeader = request.headers.get("origin");
  if (originHeader) return originHeader;

  const forwardedHost =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
  if (forwardedHost) return `${forwardedProto}://${forwardedHost}`;

  return process.env.NEXT_PUBLIC_APP_URL ?? "https://app.yoga-sculpt.fr";
}

export async function POST(request: Request) {
  // ── Garde-fou auth : acheter un ticket exige d'être connecté. ──────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Authentification requise." },
      { status: 401 },
    );
  }

  // ── Fail-safe : sans clé Stripe, le paiement n'est pas disponible. ─────────
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    return NextResponse.json({ ready: false });
  }

  // ── Validation du corps (zod). ────────────────────────────────────────────
  let parsed: z.infer<typeof bodySchema>;
  try {
    const json = await request.json();
    const result = bodySchema.safeParse(json);
    if (!result.success) {
      return NextResponse.json(
        { error: "Requête invalide.", details: result.error.issues },
        { status: 400 },
      );
    }
    parsed = result.data;
  } catch {
    return NextResponse.json(
      { error: "Corps JSON invalide." },
      { status: 400 },
    );
  }

  // ── Résolution de la formule → price id Stripe. ────────────────────────────
  const resolved = resolveFormule(parsed);
  if (!resolved) {
    return NextResponse.json(
      { error: "Formule inconnue ou non configurée." },
      { status: 400 },
    );
  }
  const { config, priceId } = resolved;

  // ── Construction de la Checkout Session (form-urlencoded). ─────────────────
  const origin = getOrigin(request);
  const params = new URLSearchParams({
    mode: "payment",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    success_url: `${origin}/espace/reserver?status=success`,
    cancel_url: `${origin}/espace/reserver?status=cancel`,
    // CRUCIAL : relie le paiement au user pour le webhook (crédit des tickets).
    client_reference_id: user.id,
    customer_email: user.email ?? "",
    // Métadonnées relues par le webhook pour savoir quoi créditer.
    "metadata[user_id]": user.id,
    "metadata[type]": config.type,
    "metadata[quantite]": String(config.quantite),
  });

  let stripeResponse: Response;
  try {
    stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    });
  } catch (err) {
    log.error("Appel Stripe échoué (réseau)", {
      user_id: user.id,
      err: serializeError(err),
    });
    return NextResponse.json(
      { error: "Service de paiement indisponible." },
      { status: 502 },
    );
  }

  if (!stripeResponse.ok) {
    // On log la réponse brute Stripe (utile au debug) mais on ne la renvoie pas
    // au client (peut contenir des détails internes).
    const errorText = await stripeResponse.text();
    log.error("Stripe a renvoyé un statut non-2xx", {
      user_id: user.id,
      status: stripeResponse.status,
      detail: errorText,
    });
    return NextResponse.json(
      { error: "Création de la session de paiement impossible." },
      { status: 502 },
    );
  }

  const session = (await stripeResponse.json()) as {
    url?: string;
    id?: string;
    amount_total?: number | null;
  };
  if (!session.url) {
    // On ne logge PAS l'objet `session` complet (peut contenir customer_email).
    log.error("Réponse Stripe sans `url`", {
      user_id: user.id,
      session_id: session.id ?? null,
    });
    return NextResponse.json(
      { error: "Session de paiement invalide." },
      { status: 502 },
    );
  }

  // ── Tracking : checkout_started. ───────────────────────────────────────────
  // best-effort (ne bloque jamais la redirection vers le paiement). On trace le
  // stripe_session_id pour la dérivation des abandons (vue v_user_checkout_abandons)
  // et le couple formule/type/quantité pour le pilotage. amount_total est en
  // CENTIMES côté Stripe → on convertit en euros (montant) si présent.
  void logEvent(
    user.id,
    "checkout_started",
    {
      stripe_session_id: session.id ?? null,
      formule: parsed.formule ?? null,
      type: config.type,
      quantite: config.quantite,
      montant:
        typeof session.amount_total === "number"
          ? session.amount_total / 100
          : null,
    },
    { source: "checkout" },
  );

  return NextResponse.json({ url: session.url });
}

// L'achat se fait uniquement en POST. Tout autre verbe → 405 explicite.
export function GET() {
  return NextResponse.json(
    { error: "Méthode non autorisée. Ce endpoint n'accepte que POST." },
    { status: 405 },
  );
}
