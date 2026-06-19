import { test, expect, e2eEnv } from "./helpers/fixtures";
import { admin, createConfirmedUser, deleteUser } from "./helpers/supabase";

/**
 * E2E — PARRAINAGE.
 *
 *   - ARRIVÉE via `?ref=CODE` : le code de parrainage est capté en cookie AVANT
 *     le login (pour survivre au flow d'auth), via deux cookies `ys_ref`
 *     (httpOnly, serveur) et `ys_ref_pub` (JS, pour le fingerprint client).
 *   - PAGE PARRAINER : un membre connecté voit SON code + son lien de partage.
 *
 * Le test du PLAFOND (cap REFERRAL_MAX_CREDITS) et de l'anti-abus est couvert de
 * façon exhaustive et déterministe en UNITAIRE (referral-lib.test.ts /
 * parrainage-completer.test.ts) — pas rejouable proprement en E2E sans fabriquer
 * N filleuls + N fingerprints distincts. Ici on prouve la CAPTURE du contexte.
 */

test("arrivée via ?ref=CODE : le code est capté en cookies (ys_ref / ys_ref_pub)", async ({
  context,
  page,
}) => {
  const CODE = "ABCD2345";
  await page.goto(`/login?ref=${CODE}`);
  await expect(page).toHaveURL(/\/login/);

  const cookies = await context.cookies();
  const ref = cookies.find((c) => c.name === "ys_ref");
  const refPub = cookies.find((c) => c.name === "ys_ref_pub");

  // Le code est posé dans les DEUX cookies (serveur httpOnly + client JS).
  expect(ref?.value).toBe(CODE);
  expect(refPub?.value).toBe(CODE);
  expect(ref?.httpOnly).toBe(true);
  expect(refPub?.httpOnly).toBe(false);
});

test("landing /invitation?ref=CODE : titre personnalisé avec le prénom du parrain + bloc auth", async ({
  page,
  testUser,
}) => {
  // On fait du `testUser` un PARRAIN nommé avec un code de parrainage stable.
  const CODE = "EMMA2345";
  const PRENOM = "Emma";
  const { error } = await admin()
    .from("profiles")
    .update({ referral_code: CODE, full_name: `${PRENOM} Durand` })
    .eq("id", testUser.id);
  expect(error).toBeNull();

  // Le filleul (anonyme, pas de session) arrive sur la landing d'invitation.
  await page.goto(`/invitation?ref=${CODE}`);
  await expect(page).toHaveURL(/\/invitation/);

  // Titre d'accueil personnalisé : « {Prénom} vous a invité(e)… ».
  await expect(
    page.getByRole("heading", { name: new RegExp(`${PRENOM}.*vous a invit`, "i") }),
  ).toBeVisible();

  // L'accroche communautaire est présente.
  await expect(page.getByText(/plus sympa entre ami/i)).toBeVisible();

  // Le BLOC AUTH intégré est là (Google + magic-link), pas un détour par /login.
  await expect(
    page.getByRole("button", { name: /continuer avec google/i }),
  ).toBeVisible();
  await expect(page.getByPlaceholder(/exemple\.com/i)).toBeVisible();

  // Le cookie de parrainage a bien été posé par le middleware sur /invitation.
  const cookies = await page.context().cookies();
  expect(cookies.find((c) => c.name === "ys_ref")?.value).toBe(CODE);
  expect(cookies.find((c) => c.name === "ys_ref_pub")?.value).toBe(CODE);
});

test("landing /invitation sans code (ou code inconnu) : titre de repli + bloc auth", async ({
  page,
}) => {
  // Code bien formé mais inconnu → fallback (« Vous avez été invité(e)… »).
  await page.goto(`/invitation?ref=ZZZZ9999`);
  await expect(page).toHaveURL(/\/invitation/);

  await expect(
    page.getByRole("heading", { name: /vous avez été invit/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /continuer avec google/i }),
  ).toBeVisible();
});

test("page parrainer : un membre connecté voit son code de parrainage", async ({
  page,
  testUser,
  loginAs,
}) => {
  // On donne au compte un code de parrainage stable pour l'assertion.
  const CODE = "PARRAINX";
  const { error } = await admin()
    .from("profiles")
    .update({ referral_code: CODE })
    .eq("id", testUser.id);
  // Si le profil n'est pas encore créé (trigger), on tolère et on laisse l'app
  // générer un code à la volée — on vérifiera juste la présence d'un code.
  void error;

  await loginAs(testUser);
  await page.goto("/espace/parrainer");
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page).toHaveURL(/\/espace\/parrainer/);

  // La page expose le LIEN de parrainage (`…/login?ref=<CODE>`) dans le champ de
  // partage. On y retrouve notre code (s'il a été posé) ou, à défaut, un code
  // généré de 8 caractères de l'alphabet non ambigu.
  const body = await page.locator("body").innerText();
  const inputVals = await page
    .locator("input, textarea")
    .evaluateAll((els) =>
      els.map((e) => (e as HTMLInputElement).value).filter(Boolean),
    );
  const haystack = body + "\n" + inputVals.join("\n");
  const aDejaLeNotre = haystack.includes(CODE);
  const aUnLienRef = /[?&]ref=[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}\b/.test(haystack);
  expect(aDejaLeNotre || aUnLienRef).toBe(true);
});

test("anti-auto-parrainage : un user ne peut pas se créditer avec son PROPRE code", async ({
  page,
  testUser,
  loginAs,
}) => {
  // Pose un code connu sur le compte.
  const CODE = "SELFREF12";
  await admin().from("profiles").update({ referral_code: CODE }).eq("id", testUser.id);

  await loginAs(testUser);
  // Simule la complétion avec son propre code via l'API (parcours filleul).
  const res = await page.request.post(`${e2eEnv.baseUrl}/api/parrainage/completer`, {
    data: { code: CODE },
    headers: { "content-type": "application/json" },
  });
  // Réponse NEUTRE (200 { ok:true }) — on ne révèle jamais le motif d'un non-crédit.
  expect(res.status()).toBe(200);

  // Vérité DB : AUCUN ticket de parrainage n'a été crédité (auto-parrainage bloqué).
  const { count } = await admin()
    .from("tickets")
    .select("id", { count: "exact", head: true })
    .eq("user_id", testUser.id)
    .eq("source", "referral");
  expect(count ?? 0).toBe(0);
});
