import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Client Supabase « service_role » — bypass RLS, SANS session utilisateur.
 *
 * À utiliser UNIQUEMENT côté serveur dans des contextes sans session cookie,
 * typiquement les webhooks (Stripe, Cal) : on reçoit un appel machine-to-machine
 * authentifié par signature, pas par un cookie de session. On a donc besoin
 * d'écrire en base au nom du système (créditer un ticket pour un user donné),
 * ce que la clé `anon` (soumise aux policies RLS) ne permet pas.
 *
 * ⚠️ SECRET ABSOLU :
 *   - `SUPABASE_SERVICE_ROLE_KEY` contourne TOUTES les policies RLS.
 *   - Ne JAMAIS l'exposer côté client, ne JAMAIS l'importer dans un composant
 *     rendu navigateur. Ce module ne doit être importé que par du code serveur
 *     (route handlers `/api/...`). En prod : `wrangler secret put`.
 *
 * RUNTIME — Cloudflare Workers (edge, via OpenNext) :
 *   `@supabase/supabase-js` n'utilise que `fetch` sous le capot pour l'API
 *   PostgREST → compatible edge. On désactive la persistance de session
 *   (`persistSession: false`) : pas de localStorage / cookie côté serveur.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    // Fail-fast explicite : sans ces deux variables, toute écriture serveur
    // échouerait silencieusement. On préfère lever une erreur lisible.
    throw new Error(
      "Supabase service client indisponible : NEXT_PUBLIC_SUPABASE_URL ou " +
        "SUPABASE_SERVICE_ROLE_KEY manquant.",
    );
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
