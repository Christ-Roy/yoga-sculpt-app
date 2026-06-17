import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Création d'une session de paiement pour un "ticket séance".
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ PHASE 1 (actuel) : STUB. Renvoie { ready: false }. Le front redirige vers │
 * │ /espace/reserver ("Paiement bientôt disponible").                         │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ PHASE 2 : Stripe. Brancher ici la création d'une Checkout Session.        │
 * │                                                                           │
 * │ ⚠️ Cible de déploiement = Cloudflare Workers (edge, via OpenNext).        │
 * │   → NE PAS importer le SDK Stripe Node lourd tel quel. Deux options       │
 * │     edge-compatibles :                                                    │
 * │     1) Stripe REST API directement en `fetch` (recommandé sur Workers) :  │
 * │        POST https://api.stripe.com/v1/checkout/sessions                    │
 * │        Authorization: Bearer ${STRIPE_SECRET_KEY}                          │
 * │        Content-Type: application/x-www-form-urlencoded                     │
 * │     2) SDK stripe avec `Stripe(secret, { httpClient:                       │
 * │        Stripe.createFetchHttpClient() })` (mode fetch, compatible edge).   │
 * │                                                                           │
 * │   Variables déjà prévues dans .env.local :                                │
 * │     STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_PRICE_SEANCE,        │
 * │     STRIPE_WEBHOOK_SECRET.                                                 │
 * │                                                                           │
 * │   Pseudo-code phase 2 :                                                    │
 * │     const body = new URLSearchParams({                                     │
 * │       mode: "payment",                                                     │
 * │       "line_items[0][price]": process.env.STRIPE_PRICE_SEANCE!,            │
 * │       "line_items[0][quantity]": "1",                                      │
 * │       success_url: `${origin}/espace/reserver?status=success`,             │
 * │       cancel_url: `${origin}/espace/reserver?status=cancel`,               │
 * │       client_reference_id: user.id,                                        │
 * │       customer_email: user.email ?? "",                                    │
 * │     });                                                                    │
 * │     const r = await fetch("https://api.stripe.com/v1/checkout/sessions", { │
 * │       method: "POST",                                                      │
 * │       headers: {                                                           │
 * │         Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,          │
 * │         "Content-Type": "application/x-www-form-urlencoded",               │
 * │       },                                                                   │
 * │       body,                                                                │
 * │     });                                                                    │
 * │     const session = await r.json();                                        │
 * │     return NextResponse.json({ url: session.url });                        │
 * │                                                                           │
 * │   + ajouter un webhook /api/webhooks/stripe (vérif signature via           │
 * │     STRIPE_WEBHOOK_SECRET) pour créditer le ticket en base.                │
 * └─────────────────────────────────────────────────────────────────────────┘
 */
export async function POST() {
  // Auth requise pour acheter un ticket.
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

  // PHASE 2: créer la Stripe Checkout Session et renvoyer { url }.
  const stripeConfigured = Boolean(process.env.STRIPE_SECRET_KEY);

  if (!stripeConfigured) {
    // PHASE 1: paiement non disponible.
    return NextResponse.json({ ready: false });
  }

  // Placeholder de garde : tant que l'implémentation Stripe n'est pas écrite,
  // on ne prétend pas être prêt même si une clé est présente.
  return NextResponse.json({ ready: false });
}
