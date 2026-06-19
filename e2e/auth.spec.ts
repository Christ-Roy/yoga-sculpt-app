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
