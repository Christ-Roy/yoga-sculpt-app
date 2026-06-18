/**
 * Helpers d'ADMINISTRATION AUTH (GoTrue) pour le back-office « Comptes ».
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ APPROCHE — Admin API Supabase via `@supabase/supabase-js` (edge-safe).    │
 * │                                                                           │
 * │ Les méthodes `supabase.auth.admin.*` (generateLink / updateUserById /     │
 * │ inviteUserByEmail / getUserById) ne font QUE des `fetch` HTTP vers        │
 * │ l'API GoTrue admin (`{SUPABASE_URL}/auth/v1/admin/...`), authentifiés par │
 * │ la clé `service_role`. Aucune API Node-only → 100 % compatible Cloudflare │
 * │ Workers (edge, via OpenNext). On n'a donc PAS besoin de tomber au niveau  │
 * │ `fetch` GoTrue brut : le client supabase-js suffit et reste typé.         │
 * │                                                                           │
 * │ ⚠️ Le client utilisé ici est le `service_role` (bypass RLS + droits       │
 * │ admin auth). Il ne doit JAMAIS être importé côté navigateur — ce module   │
 * │ est exclusivement consommé par des route handlers serveur                 │
 * │ (`src/app/api/admin/users/**`), tous gardés par `requireAdmin()`.         │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ ENVOI DES E-MAILS — `generateLink` GÉNÈRE le lien, il NE l'envoie PAS.    │
 * │   On renvoie donc le lien (`action_link`) à l'admin pour qu'il le copie / │
 * │   le transmette : c'est le FALLBACK SÛR (fonctionne toujours, même si le  │
 * │   SMTP Supabase n'est pas (encore) branché côté projet).                  │
 * │   `inviteUserByEmail`, en revanche, DÉCLENCHE l'envoi de l'e-mail         │
 * │   d'invitation par Supabase (via le SMTP Brevo configuré côté projet) ET  │
 * │   crée l'utilisateur — on renvoie aussi le lien en secours.               │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import { createServiceClient } from "@/lib/supabase/service";

/** Actions d'auth « lien » déclenchables depuis le back-office. */
export type AuthActionType = "recovery" | "magiclink";

/** URL de redirection par défaut après clic sur un lien d'auth admin. */
function defaultRedirectTo(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.yoga-sculpt.fr";
  return `${appUrl}/auth/callback`;
}

/** Résultat normalisé d'une action d'auth « lien ». */
export interface AuthLinkResult {
  /** Le lien d'action (à copier par l'admin). `null` si GoTrue ne l'a pas renvoyé. */
  actionLink: string | null;
  /** True si Supabase a (aussi) déclenché l'envoi de l'e-mail (cas `invite`). */
  emailSent: boolean;
}

/**
 * Génère un lien de RÉINITIALISATION de mot de passe (`type: recovery`).
 * `generateLink` ne déclenche PAS d'e-mail → on renvoie le lien à l'admin.
 *
 * @throws si l'API GoTrue répond une erreur (utilisateur introuvable, etc.).
 */
export async function genererLienRecovery(email: string): Promise<AuthLinkResult> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: defaultRedirectTo() },
  });
  if (error) throw new Error(`GoTrue generateLink(recovery) : ${error.message}`);
  return {
    actionLink: data.properties?.action_link ?? null,
    emailSent: false,
  };
}

/**
 * Génère un MAGIC-LINK de connexion (`type: magiclink`) pour un compte EXISTANT.
 * Ne déclenche pas d'e-mail → on renvoie le lien à l'admin.
 *
 * @throws si l'API GoTrue répond une erreur.
 */
export async function genererLienMagic(email: string): Promise<AuthLinkResult> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: defaultRedirectTo() },
  });
  if (error) throw new Error(`GoTrue generateLink(magiclink) : ${error.message}`);
  return {
    actionLink: data.properties?.action_link ?? null,
    emailSent: false,
  };
}

/**
 * (Ré)invite un e-mail (pré-crée un compte + ENVOIE l'e-mail d'invitation via
 * le SMTP configuré côté Supabase). On renvoie aussi le lien d'action en secours.
 *
 * @throws si l'API GoTrue répond une erreur (e-mail déjà inscrit, etc.).
 */
export async function inviterEmail(email: string): Promise<AuthLinkResult> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
    redirectTo: defaultRedirectTo(),
  });
  if (error) throw new Error(`GoTrue inviteUserByEmail : ${error.message}`);
  // `inviteUserByEmail` renvoie l'utilisateur créé ; `action_link` est posé sur
  // l'objet user quand GoTrue le fournit (selon config du projet).
  const actionLink = (data.user as { action_link?: string } | null)?.action_link ?? null;
  return { actionLink, emailSent: true };
}

/**
 * SUSPEND un compte (ban GoTrue) pour une durée donnée.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ APPROCHE — `ban_duration` natif GoTrue (PAS un flag profil maison).       │
 * │   GoTrue refuse alors l'authentification ET invalide les sessions en      │
 * │   cours côté serveur : c'est LA garde fiable (un flag `profiles.suspended`│
 * │   ne bloquerait rien tant qu'on n'ajoute pas un check au login partout). │
 * │   On suspend « pour longtemps » (`876000h` ≈ 100 ans) = suspension de fait │
 * │   réversible via `reactiverCompte()` (`ban_duration: 'none'`).            │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * @throws si l'API GoTrue répond une erreur.
 */
export async function suspendreCompte(userId: string): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase.auth.admin.updateUserById(userId, {
    // 100 ans : suspension « indéfinie » de fait, levable à tout moment.
    ban_duration: "876000h",
  });
  if (error) throw new Error(`GoTrue updateUserById(ban) : ${error.message}`);
}

/**
 * RÉACTIVE un compte précédemment suspendu (`ban_duration: 'none'`).
 *
 * @throws si l'API GoTrue répond une erreur.
 */
export async function reactiverCompte(userId: string): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase.auth.admin.updateUserById(userId, {
    ban_duration: "none",
  });
  if (error) throw new Error(`GoTrue updateUserById(unban) : ${error.message}`);
}

/**
 * Vérifie qu'un utilisateur EXISTE (par id) et renvoie son e-mail.
 * Sert de garde avant une action ciblée (crédit ticket, action auth) : on ne
 * veut pas générer un lien / créditer un id fantôme.
 *
 * @returns `{ exists, email }`. `exists=false` si GoTrue ne connaît pas l'id.
 */
export async function lireUtilisateur(
  userId: string,
): Promise<{ exists: boolean; email: string | null }> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error || !data.user) return { exists: false, email: null };
  return { exists: true, email: data.user.email ?? null };
}
