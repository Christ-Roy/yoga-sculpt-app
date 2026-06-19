import { defineConfig, devices } from "@playwright/test";

/**
 * Config Playwright — harnais E2E « validation STAGING avant prod ».
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ QUAND lancer ? À LA DEMANDE, contre le STAGING déjà déployé, AVANT chaque │
 * │ mise en prod. PAS dans le pre-push ni la CI (trop lourd : vrai navigateur │
 * │ + vrais appels Supabase/Stripe TEST). Cf. e2e/README.md.                  │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * - testDir scoping STRICT sur `e2e/` (les tests unitaires Vitest vivent dans
 *   `__tests__/` en `.test.ts` ; ici on ne ramasse QUE les `.spec.ts` de `e2e/`) ;
 * - baseURL = `E2E_BASE_URL` (défaut = l'URL du Worker staging live) ;
 * - headless, 1 worker (machine qui sature facilement : on ne lance pas 50
 *   navigateurs en parallèle) ;
 * - retries 1 (un flake réseau ne doit pas faire échouer une validation) ;
 * - reporters list (console) + html (rapport navigable dans `playwright-report/`).
 *
 * Les SECRETS de test (service_role staging pour vérifier la DB, clés Stripe
 * TEST) sont lus depuis des VARIABLES D'ENV — JAMAIS hardcodés dans les specs.
 * Voir e2e/README.md pour les exporter depuis ~/credentials/.all-creds.env.
 */

const STAGING_URL = "https://yoga-sculpt-app-staging.brunon5robert.workers.dev";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  // Un test E2E qui touche Stripe Checkout + webhook peut prendre du temps
  // (redirection externe + propagation du webhook). On laisse de la marge.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 1,
  forbidOnly: !!process.env.CI,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? STAGING_URL,
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
