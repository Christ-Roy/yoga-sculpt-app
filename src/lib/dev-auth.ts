/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  BYPASS D'AUTH — DEV LOCAL UNIQUEMENT                                       ║
 * ║  ⚠️  NE JAMAIS ACTIVER EN PROD NI EN STAGING  ⚠️                            ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Permet d'ouvrir les pages protégées (`/onboarding`, `/espace/*`, `/admin/*`)
 * SANS login, pour itérer sur l'UI en dev (hot reload) sans dépendre d'un
 * magic-link valide à chaque session.
 *
 * SÉCURITÉ — la garde est COMBINÉE et NON NÉGOCIABLE :
 *   1. `NEXT_PUBLIC_DEV_AUTH_BYPASS === "1"`   (intention explicite du dev)
 *   2. `NODE_ENV !== "production"`               (jamais dans un build prod)
 * Les DEUX conditions sont requises. Un build de production force
 * `NODE_ENV=production` → la garde est FALSE même si la var =1 traînait dans
 * l'environnement de build. C'est l'invariant prouvé par le test unitaire
 * (`__tests__/lib/dev-auth.test.ts`).
 *
 * Défense en profondeur supplémentaire (hors de ce fichier) :
 *   - `scripts/ci/check-no-dev-auth-bypass.sh` FAIL si `NEXT_PUBLIC_DEV_AUTH_BYPASS=1`
 *     apparaît dans un fichier tracké (branché au pre-push + CI) → filet
 *     anti-déploiement-accidentel.
 *
 * Toute la garde est CENTRALISÉE ici : aucun check `process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS`
 * dupliqué ailleurs. Les consommateurs importent `DEV_AUTH_BYPASS`.
 *
 * RUNTIME — Cloudflare Workers (edge) via OpenNext : uniquement `process.env`
 * + fetch (service client Supabase). Aucune API Node-only.
 */

import type { User } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Calcule l'état du bypass à partir d'un environnement donné. FONCTION PURE
 * (testable) : on lui passe un objet `env` plutôt que de lire `process.env`
 * en dur, pour pouvoir prouver en test que `NODE_ENV=production` neutralise le
 * bypass même quand la var vaut "1".
 *
 * @returns `true` SI ET SEULEMENT SI les deux conditions sont réunies.
 */
export function computeDevAuthBypass(env: {
  NEXT_PUBLIC_DEV_AUTH_BYPASS?: string;
  NODE_ENV?: string;
}): boolean {
  return (
    env.NEXT_PUBLIC_DEV_AUTH_BYPASS === "1" && env.NODE_ENV !== "production"
  );
}

/**
 * Drapeau global évalué une fois à partir de `process.env`. C'est CE drapeau
 * que tout le code applicatif consomme (jamais le check brut des deux vars).
 *
 * NB : `NEXT_PUBLIC_*` est inliné au build par Next ; `NODE_ENV` aussi. En prod
 * `NODE_ENV` vaut "production" → la valeur inlinée est `false`, et tout le code
 * mort de bypass est éliminé par le tree-shaking du build prod.
 */
export const DEV_AUTH_BYPASS = computeDevAuthBypass({
  NEXT_PUBLIC_DEV_AUTH_BYPASS: process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS,
  NODE_ENV: process.env.NODE_ENV,
});

/**
 * Id du compte de test ciblé par le bypass. Compte de dev dédié déjà existant
 * en staging : `onboarding-dev@yoga-sculpt.fr`. Surchargeable via env
 * `DEV_BYPASS_USER_ID` (utile si on veut se mettre dans la peau d'un autre user
 * de test), avec ce compte comme valeur par défaut.
 */
export const DEV_BYPASS_USER_ID =
  process.env.DEV_BYPASS_USER_ID ?? "dc18b9cb-4e4d-4f7e-8924-eb1ced7d4ee7";

/**
 * Rôle simulé par le bypass : `"admin"` fait passer `requireAdmin()`, sinon
 * user normal. Lu depuis `DEV_BYPASS_ROLE` (défaut : `"user"`). Permet de
 * tester l'UI admin sans figurer dans la whitelist `ADMIN_EMAILS`.
 */
export const DEV_BYPASS_ROLE: "user" | "admin" =
  process.env.DEV_BYPASS_ROLE === "admin" ? "admin" : "user";

/** Vrai si le bypass est actif ET simule un rôle admin. */
export const DEV_BYPASS_IS_ADMIN = DEV_AUTH_BYPASS && DEV_BYPASS_ROLE === "admin";

/**
 * Charge le user de test (via service client, par son id) sous une forme
 * compatible `User` Supabase. Best-effort : si le compte n'existe pas / clé
 * service absente, renvoie `null` (le consommateur retombera sur le flux normal
 * ou une redirection login). Mémorisé le temps du process (dev seulement).
 */
let cachedBypassUser: User | null | undefined;

export async function loadDevBypassUser(): Promise<User | null> {
  if (cachedBypassUser !== undefined) return cachedBypassUser;

  try {
    const service = createServiceClient();
    const { data, error } = await service.auth.admin.getUserById(
      DEV_BYPASS_USER_ID,
    );
    if (error || !data?.user) {
      console.warn(
        `[dev-auth] bypass actif mais user de test introuvable (${DEV_BYPASS_USER_ID}). ` +
          `Vérifie DEV_BYPASS_USER_ID / le compte onboarding-dev en staging.`,
      );
      cachedBypassUser = null;
      return null;
    }
    cachedBypassUser = data.user;
    return cachedBypassUser;
  } catch (e) {
    console.warn("[dev-auth] échec chargement du user de test :", e);
    cachedBypassUser = null;
    return null;
  }
}
