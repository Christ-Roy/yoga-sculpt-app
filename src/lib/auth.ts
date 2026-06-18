/**
 * Récupération CENTRALISÉE de l'utilisateur courant côté serveur.
 *
 * En usage normal : délègue à `supabase.auth.getUser()` (appel authentifié au
 * serveur Supabase via la session cookie — pas une simple lecture de cookie).
 *
 * En mode BYPASS DEV (cf `src/lib/dev-auth.ts`, garde env + NODE_ENV) : renvoie
 * le user de test chargé via le service client, SANS session réelle. La garde
 * du bypass étant centralisée dans `DEV_AUTH_BYPASS`, ce helper est le SEUL
 * point où les pages/layouts protégés lisent le user → un seul endroit à
 * auditer, aucune divergence possible entre pages.
 *
 * Toutes les pages/layouts/actions protégés appellent `getCurrentUser(supabase)`
 * au lieu de `supabase.auth.getUser()` directement.
 *
 * RUNTIME — edge (Cloudflare Workers) : fetch uniquement. OK.
 */

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { DEV_AUTH_BYPASS, loadDevBypassUser } from "@/lib/dev-auth";

/**
 * @param supabase client serveur RLS-scopé (issu de `createClient()`).
 * @returns le `User` courant, ou `null` si non authentifié.
 */
export async function getCurrentUser(
  supabase: SupabaseClient,
): Promise<User | null> {
  if (DEV_AUTH_BYPASS) {
    return loadDevBypassUser();
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
