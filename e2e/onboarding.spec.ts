import { test, expect } from "./helpers/fixtures";

/**
 * E2E — ONBOARDING. Parcours des premières étapes + REPRISE du draft :
 * on répond à l'étape 1, on quitte/recharge, et on doit reprendre à l'étape 2
 * (l'avancement est persisté en DB — feat onboarding-reprise).
 */

test("onboarding : avance d'une étape puis reprend le draft après rechargement", async ({
  page,
  testUser,
  loginAs,
}) => {
  await loginAs(testUser);
  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/onboarding/);

  // Étape 1/6 : on choisit le premier objectif proposé.
  await expect(page.getByText(/ÉTAPE 1 \/ 6/i)).toBeVisible();
  // Le premier bouton-option de l'étape (hors « Retour »).
  const firstOption = page
    .getByRole("button")
    .filter({ hasNotText: /Retour|Déconnexion|navigation/i })
    .first();
  await firstOption.click();

  // On doit avoir progressé à l'étape 2.
  await expect(page.getByText(/ÉTAPE 2 \/ 6/i)).toBeVisible();

  // REPRISE DU DRAFT : on recharge la page → l'avancement est restauré depuis la
  // DB, on ne repart PAS de l'étape 1.
  await page.reload();
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.getByText(/ÉTAPE 2 \/ 6/i)).toBeVisible();
  await expect(page.getByText(/ÉTAPE 1 \/ 6/i)).toHaveCount(0);
});
