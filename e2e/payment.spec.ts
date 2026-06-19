import { test, expect, e2eEnv } from "./helpers/fixtures";
import { sessionCookies, ticketBalance } from "./helpers/supabase";
import {
  createCheckoutSessionUrl,
  emitCheckoutCompletedWebhook,
} from "./helpers/stripe";

/**
 * E2E — PAIEMENT → TICKET. C'EST LE TEST CRITIQUE (demande Robert) :
 * « quand on paye, on reçoit bien les tickets ».
 *
 * Parcours :
 *   1. Création RÉELLE d'une Checkout Session via l'app (POST /api/checkout) →
 *      on obtient une vraie URL Stripe TEST (preuve que le checkout marche).
 *   2. On vérifie que la page Stripe hostée est bien atteinte et payable
 *      (titre « Alice Gaudry », bouton « Payer »).
 *   3. Paiement : la Checkout HOSTÉE de Stripe ne rend pas ses champs carte de
 *      façon fiable en chromium headless. On déclenche donc le MÊME code path que
 *      Stripe après un paiement carte 4242 : un `checkout.session.completed` SIGNÉ
 *      envoyé au webhook staging (signature HMAC vérifiée par le Worker).
 *   4. VÉRIF DB (service_role) : la table `tickets` est créditée pour ce user.
 *   5. IDEMPOTENCE : rejouer le webhook ne crédite pas une 2e fois.
 *
 * NB : ce test a mis en évidence un BUG CRITIQUE (index de dédup partiel ↔
 * ON CONFLICT) qui faisait échouer TOUT crédit après paiement — corrigé par la
 * migration 0015 (cf. e2e/README.md « Bugs trouvés »).
 */

test("paiement carte 4242 (webhook) → tickets crédités, et idempotent au rejeu", async ({
  context,
  page,
  testUser,
  loginAs,
}) => {
  await loginAs(testUser);

  const cookieHeader = (await sessionCookies(testUser, e2eEnv.baseUrl))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");

  // 1) Création réelle de la session via l'app.
  const { url, sessionId } = await createCheckoutSessionUrl(
    e2eEnv.baseUrl,
    cookieHeader,
    "collectif",
  );
  expect(url).toMatch(/^https:\/\/checkout\.stripe\.com\//);

  // 2) La page Stripe hostée est bien atteinte (URL Checkout + bouton de paiement
  //    présent). On reste tolérant sur le LIBELLÉ exact du bouton (Stripe le fait
  //    varier : « Payer », « Payer 20,00 € », état « En cours de traitement »…).
  await page.goto(url, { waitUntil: "domcontentloaded" });
  expect(page.url()).toContain("checkout.stripe.com");
  await expect(
    page.locator(".SubmitButton, button[type='submit']").first(),
  ).toBeVisible({ timeout: 20_000 });

  // 3) Solde avant paiement = 0.
  expect(await ticketBalance(testUser.id, "collectif")).toBe(0);

  // 4) Paiement → on émet le webhook signé (= callback Stripe post-paiement 4242).
  const status = await emitCheckoutCompletedWebhook({
    baseUrl: e2eEnv.baseUrl,
    webhookSecret: e2eEnv.stripeWebhookSecret(),
    userId: testUser.id,
    sessionId,
    type: "collectif",
    quantite: 1,
    amountTotalCents: 2000,
  });
  expect(status).toBe(200);

  // 5) VÉRIF DB : le ticket est bien crédité (le webhook a tourné).
  await expect
    .poll(() => ticketBalance(testUser.id, "collectif"), { timeout: 20_000 })
    .toBe(1);

  // 6) IDEMPOTENCE : rejouer le MÊME webhook (même session) ne double pas le crédit.
  const replayStatus = await emitCheckoutCompletedWebhook({
    baseUrl: e2eEnv.baseUrl,
    webhookSecret: e2eEnv.stripeWebhookSecret(),
    userId: testUser.id,
    sessionId, // même session → dédup
    type: "collectif",
    quantite: 1,
  });
  expect(replayStatus).toBe(200);

  // Le solde RESTE à 1 (pas de double crédit).
  await page.waitForTimeout(2000);
  expect(await ticketBalance(testUser.id, "collectif")).toBe(1);

  // (context utilisé par la fixture pour les cookies de session ; rien d'autre ici)
  void context;
});
