import { test, expect } from "./helpers/fixtures";

/**
 * E2E — AUTH. Prouve qu'une session ouverte (magic-link échangé côté Node →
 * cookies SSR injectés) donne bien accès à l'espace protégé, et qu'un visiteur
 * NON connecté est refoulé vers /login.
 *
 * Un compte FRAÎCHEMENT confirmé (jamais onboardé) doit être renvoyé vers
 * /onboarding quand il vise /espace : c'est le gating d'onboarding.
 */

test("non authentifié : /espace redirige vers /login", async ({ page }) => {
  await page.goto("/espace");
  await expect(page).toHaveURL(/\/login/);
});

test("authentifié (compte neuf) : /espace gate vers /onboarding", async ({
  page,
  testUser,
  loginAs,
}) => {
  await loginAs(testUser);
  await page.goto("/espace");
  // Un compte neuf n'a pas complété l'onboarding → redirection.
  await expect(page).toHaveURL(/\/onboarding/);
});

test("authentifié : l'email du compte apparaît dans l'espace réservation", async ({
  page,
  testUser,
  loginAs,
}) => {
  await loginAs(testUser);
  await page.goto("/espace/reserver");
  await expect(page).toHaveURL(/\/espace\/reserver/);
  await expect(page.getByText(testUser.email)).toBeVisible();
});

/**
 * /login expose TOUJOURS une voie Google + Microsoft + magic-link. On ne peut pas
 * automatiser le clic DANS l'iframe Google (sandbox), mais on vérifie les
 * invariants qui cassent en cas de régression du bloc auth (bouton disparu,
 * SDK GSI non chargé, fallback OAuth absent). C'est ce qui manquait : un test
 * qui catche "le Google login ne s'affiche plus sur /login".
 */
test("login : une voie de connexion Google est présente (GSI ou fallback OAuth)", async ({
  page,
}) => {
  await page.goto("/login");
  await expect(page).toHaveURL(/\/login/);

  // Le SDK Google Identity doit se charger (le bouton GSI en dépend).
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            !!document.querySelector(
              'script[src="https://accounts.google.com/gsi/client"]',
            ),
        ),
      { timeout: 10_000 },
    )
    .toBe(true);

  // Une voie Google DOIT être offerte : soit l'iframe du bouton GSI personnalisé
  // (rendu par Google), soit le bouton de secours « Continuer avec Google ».
  const gsiIframe = page.locator('iframe[src*="accounts.google.com"]');
  const fallbackGoogleBtn = page.getByRole("button", {
    name: /Continuer avec Google/i,
  });
  await expect
    .poll(
      async () =>
        (await gsiIframe.count()) > 0 ||
        (await fallbackGoogleBtn.count()) > 0,
      { timeout: 10_000 },
    )
    .toBe(true);

  // Microsoft + magic-link restent disponibles (parité des méthodes).
  await expect(
    page.getByRole("button", { name: /Continuer avec Microsoft/i }),
  ).toBeVisible();
  await expect(page.getByPlaceholder(/exemple\.com/i)).toBeVisible();
});
