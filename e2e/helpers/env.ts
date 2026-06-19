/**
 * Lecture STRICTE de la config E2E depuis l'environnement.
 *
 * Aucune valeur sensible n'est hardcodée : on EXIGE les variables d'env (exportées
 * depuis ~/credentials/.all-creds.env, cf e2e/README.md). Si une variable requise
 * manque, on jette un message clair qui dit quoi exporter — un secret oublié doit
 * faire échouer vite et lisiblement, pas produire un faux négatif silencieux.
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(
      `[e2e] Variable d'env manquante : ${name}. ` +
        `Exporte les secrets staging depuis ~/credentials/.all-creds.env ` +
        `(voir e2e/README.md, section « Prérequis »).`,
    );
  }
  return v.trim();
}

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : fallback;
}

const STAGING_URL =
  "https://yoga-sculpt-app-staging.brunon5robert.workers.dev";

export const e2eEnv = {
  /** URL de l'app testée (Worker staging par défaut). */
  baseUrl: optional("E2E_BASE_URL", STAGING_URL),

  /** Supabase staging — URL du projet + clés (service_role pour vérifier la DB). */
  supabaseUrl: () => required("E2E_SUPABASE_URL"),
  supabaseAnonKey: () => required("E2E_SUPABASE_ANON_KEY"),
  supabaseServiceKey: () => required("E2E_SUPABASE_SERVICE_ROLE_KEY"),

  /** ref du projet Supabase staging (sert au nom du cookie `sb-<ref>-auth-token`). */
  supabaseRef: () => required("E2E_SUPABASE_REF"),

  /** Stripe TEST (pour le test paiement → ticket). Optionnel selon les specs. */
  stripeSecretKey: () => required("E2E_STRIPE_SECRET_KEY"),

  /**
   * Secret de signature du webhook Stripe STAGING (whsec_…). Sert au test
   * paiement à émettre un `checkout.session.completed` signé (= ce que Stripe
   * envoie après un paiement réussi). Lu depuis l'env, jamais hardcodé.
   */
  stripeWebhookSecret: () => required("E2E_STRIPE_WEBHOOK_SECRET"),
};
