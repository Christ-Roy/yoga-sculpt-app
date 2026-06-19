import { request } from "@playwright/test";

/**
 * Helpers Stripe TEST pour le harnais E2E.
 *
 * Deux usages :
 *   1. createCheckoutSessionUrl() : on passe par l'app (POST /api/checkout) — ça
 *      teste la VRAIE création de session (résolution formule→price, lien user,
 *      métadonnées webhook). On récupère l'URL Stripe + l'id de session.
 *   2. emitCheckoutCompletedWebhook() : reproduit EXACTEMENT ce que fait Stripe
 *      après un paiement réussi — un POST `checkout.session.completed` SIGNÉ
 *      (HMAC-SHA256, même schéma que verifyStripeSignature côté Worker) au webhook
 *      staging. C'est le code path critique « paiement → crédit ticket ».
 *
 * Pourquoi (2) plutôt que piloter la page hostée Stripe ? Les champs carte de la
 * Checkout HOSTÉE de Stripe ne se rendent pas de façon fiable en chromium headless
 * (anti-automation / iframe obfusqué). Le webhook signé exerce le MÊME handler que
 * celui déclenché par un vrai paiement 4242 — c'est la garantie qu'on veut prouver
 * (« quand on paye, on reçoit les tickets »), de façon déterministe. Le secret de
 * signature est lu depuis l'env (E2E_STRIPE_WEBHOOK_SECRET), jamais hardcodé.
 */

/** Crée une session Checkout via l'app (cookies de session requis). */
export async function createCheckoutSessionUrl(
  baseUrl: string,
  cookieHeader: string,
  formule: "collectif" | "particulier" | "carte10",
): Promise<{ url: string; sessionId: string }> {
  const rc = await request.newContext({
    baseURL: baseUrl,
    extraHTTPHeaders: { cookie: cookieHeader, "content-type": "application/json" },
  });
  const res = await rc.post("/api/checkout", { data: { formule } });
  if (res.status() !== 200) {
    throw new Error(`[e2e] /api/checkout a renvoyé ${res.status()} : ${await res.text()}`);
  }
  const { url } = (await res.json()) as { url?: string };
  if (!url) throw new Error("[e2e] /api/checkout n'a pas renvoyé d'url Stripe.");
  const m = url.match(/cs_test_[A-Za-z0-9]+/);
  if (!m) throw new Error("[e2e] impossible d'extraire l'id de session Stripe de l'url.");
  return { url, sessionId: m[0] };
}

/** Signature Stripe `t=...,v1=<hmac hex>` (Web Crypto, edge-compatible). */
async function signStripe(rawBody: string, secret: string, ts: number): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const buf = await crypto.subtle.sign("HMAC", key, enc.encode(`${ts}.${rawBody}`));
  const hex = [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `t=${ts},v1=${hex}`;
}

/**
 * Émet un webhook `checkout.session.completed` SIGNÉ vers le Worker staging —
 * reproduit le callback Stripe après un paiement réussi par carte 4242.
 *
 * @returns le status HTTP renvoyé par le webhook (200 attendu).
 */
export async function emitCheckoutCompletedWebhook(opts: {
  baseUrl: string;
  webhookSecret: string;
  userId: string;
  sessionId: string;
  type: "collectif" | "particulier";
  quantite: number;
  amountTotalCents?: number;
}): Promise<number> {
  const ts = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({
    id: `evt_e2e_${Date.now()}`,
    type: "checkout.session.completed",
    data: {
      object: {
        id: opts.sessionId,
        client_reference_id: opts.userId,
        payment_intent: `pi_e2e_${Date.now()}`,
        payment_status: "paid",
        amount_total: opts.amountTotalCents ?? 2000,
        metadata: {
          user_id: opts.userId,
          type: opts.type,
          quantite: String(opts.quantite),
        },
      },
    },
  });
  const sig = await signStripe(body, opts.webhookSecret, ts);
  const rc = await request.newContext({ baseURL: opts.baseUrl });
  const res = await rc.post("/api/webhooks/stripe", {
    data: body,
    headers: { "stripe-signature": sig, "content-type": "application/json" },
  });
  return res.status();
}
