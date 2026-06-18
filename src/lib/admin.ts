/**
 * Contrôle d'accès au dashboard d'Alice (`/admin`).
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ DÉFENSE EN PROFONDEUR — on NE se repose PAS sur le seul middleware edge.  │
 * │ Chaque page admin appelle `requireAdmin()` CÔTÉ SERVEUR (Server           │
 * │ Component / route handler) en TÊTE de rendu. Même si le middleware était  │
 * │ contourné (mauvais matcher, bug Next, CVE type CVE-2025-29927), la garde  │
 * │ serveur bloque l'accès aux données : c'est la vérification qui fait foi.  │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Modèle d'autorisation V1 — liste blanche d'emails depuis l'env `ADMIN_EMAILS`
 * (CSV). Pas de rôle/claim custom Supabase (sur-ingénierie pour 1 admin). Le
 * jour où il faut un vrai RBAC, on remplace l'implémentation ici sans toucher
 * aux pages (elles n'appellent que `requireAdmin()` / `getAdminEmails()`).
 *
 * ⚠️ `ADMIN_EMAILS` doit être présent :
 *   - en dev   → `.env.local` (cf `.env.example`),
 *   - en prod  → `wrangler secret put ADMIN_EMAILS` (ou var d'env du Worker).
 * Exemple : `ADMIN_EMAILS=gdry.alice@gmail.com,brunon5robert@gmail.com`
 *
 * RUNTIME — Cloudflare Workers (edge) via OpenNext : uniquement `getUser()`
 * (fetch-based Supabase) + `process.env`. Aucune API Node-only. OK en edge.
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  DEV_AUTH_BYPASS,
  DEV_BYPASS_IS_ADMIN,
  loadDevBypassUser,
} from "@/lib/dev-auth";

/**
 * Parse la liste blanche d'emails admin depuis `ADMIN_EMAILS` (CSV).
 * Normalise (trim + minuscules), ignore les entrées vides. Renvoie un `Set`
 * pour un lookup O(1) insensible à la casse.
 *
 * Fail-safe : si la variable est absente/vide, on renvoie un set VIDE →
 * personne n'est admin (on bloque par défaut plutôt que d'ouvrir). Une faute
 * de config ne doit jamais ouvrir le dashboard à tout le monde.
 */
export function getAdminEmails(): Set<string> {
  const brut = process.env.ADMIN_EMAILS ?? "";
  return new Set(
    brut
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0),
  );
}

/** Indique si un email donné figure dans la liste blanche admin. */
export function estAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return getAdminEmails().has(email.trim().toLowerCase());
}

/** Profil minimal de l'admin courant, renvoyé par `requireAdmin()`. */
export interface AdminContext {
  /** Id Supabase (auth.users.id) de l'utilisateur authentifié. */
  userId: string;
  /** Email vérifié de l'utilisateur (déjà confirmé présent dans la liste blanche). */
  email: string;
}

/**
 * Garde serveur du dashboard. À appeler EN TÊTE de chaque page/route `/admin`.
 *
 * Comportement :
 *   1. récupère l'utilisateur via la session cookie (`getUser()` — appel
 *      authentifié au serveur Supabase, pas une simple lecture de cookie) ;
 *   2. si pas de session → `redirect('/login')` ;
 *   3. si connecté mais email hors liste blanche → `redirect('/espace')`
 *      (on ne révèle pas l'existence d'une zone admin à un client lambda :
 *      on le renvoie sur SON espace, pas un 403 bavard).
 *
 * `redirect()` lève une exception de contrôle de flux Next : le code qui suit
 * l'appel ne s'exécute donc jamais quand l'accès est refusé.
 *
 * @returns le contexte admin (userId + email) si — et seulement si — l'accès
 *          est autorisé.
 */
export async function requireAdmin(): Promise<AdminContext> {
  // ⚠️ BYPASS DEV (cf `src/lib/dev-auth.ts`, garde env + NODE_ENV, DEV LOCAL
  // UNIQUEMENT). Si `DEV_BYPASS_ROLE=admin` → on laisse passer avec le user de
  // test, sans exiger qu'il figure dans `ADMIN_EMAILS`. Sinon (bypass user
  // normal) → comportement admin standard : redirige vers /espace.
  if (DEV_AUTH_BYPASS) {
    const devUser = await loadDevBypassUser();
    if (!devUser) {
      redirect("/login");
    }
    if (!DEV_BYPASS_IS_ADMIN && !estAdmin(devUser.email)) {
      redirect("/espace");
    }
    return { userId: devUser.id, email: devUser.email ?? "dev-admin@local" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  if (!estAdmin(user.email)) {
    redirect("/espace");
  }

  // `user.email` est garanti non-null ici (estAdmin l'a vérifié non-vide).
  return { userId: user.id, email: user.email! };
}
