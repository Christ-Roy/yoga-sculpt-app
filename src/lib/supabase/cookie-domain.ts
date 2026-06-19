/**
 * Scope du cookie de session Supabase — partage cross-domaine vitrine ↔ app.
 *
 * PROBLÈME : `@supabase/ssr` pose le cookie de session HOST-ONLY par défaut
 * (aucun `Domain` → scopé `app.yoga-sculpt.fr` SEUL). Un `fetch` lancé depuis la
 * vitrine STATIQUE (`yoga-sculpt.fr`) vers `app.yoga-sculpt.fr/api/session-status`
 * est CROSS-SITE → le cookie `SameSite=Lax` host-only n'est PAS envoyé → l'app ne
 * voit aucune session → `authed:false` même si l'utilisateur est connecté.
 *
 * SOLUTION (Option A, cf todo/2026-06-19-cookie-cross-domain-vitrine.md) : poser
 * le cookie sur le DOMAINE PARENT commun (`Domain=.yoga-sculpt.fr`). L'apex et le
 * sous-domaine partagent le même registrable domain → le cookie est ENVOYÉ aux
 * deux, et la requête reste « same-site » au sens de la spec → PAS besoin de
 * `SameSite=None` (on évite sa surface CSRF). C'est la même convention que le
 * cookie d'attribution Ads `ys_gclid` (cf src/lib/ads-attribution.ts).
 *
 * ⚠️ PROD UNIQUEMENT. En dev local le host est `localhost` (pas de domaine
 * parent enregistrable) : poser `Domain=.yoga-sculpt.fr` CASSERAIT le cookie
 * (le navigateur le rejette, mismatch de domaine) → on ne pose AUCUN domain.
 * La garde prod réutilise la convention déjà présente dans le repo
 * (`NODE_ENV === "production"`, cf src/middleware.ts pour le flag `secure`).
 *
 * Le domaine parent est DÉRIVÉ du host de `NEXT_PUBLIC_APP_URL` (pas codé en
 * dur) : on retire le 1er label du sous-domaine (`app.yoga-sculpt.fr` →
 * `.yoga-sculpt.fr`). Fallback : `.yoga-sculpt.fr`.
 *
 * Edge-safe : `process.env` + `URL` uniquement, aucune API Node-only — utilisable
 * dans le client serveur (RSC/route handlers) ET le middleware edge (proxy.ts).
 */

/**
 * Calcule le `domain` du cookie de session à partir d'un environnement donné.
 * FONCTION PURE (testable) : on lui passe `env` plutôt que de lire `process.env`
 * en dur.
 *
 * @returns le domaine parent (`.yoga-sculpt.fr`) en prod, `undefined` sinon
 *   (dev/local → cookie host-only, comportement par défaut de la lib).
 */
export function computeAuthCookieDomain(env: {
  NODE_ENV?: string;
  NEXT_PUBLIC_APP_URL?: string;
}): string | undefined {
  // PROD UNIQUEMENT — en dev/local on ne pose JAMAIS de domain (cookie host-only).
  if (env.NODE_ENV !== "production") return undefined;

  const FALLBACK = ".yoga-sculpt.fr";

  const raw = env.NEXT_PUBLIC_APP_URL;
  if (!raw) return FALLBACK;

  let host: string;
  try {
    host = new URL(raw).hostname; // ex: "app.yoga-sculpt.fr"
  } catch {
    return FALLBACK;
  }

  // Pas de domaine parent enregistrable possible (localhost, IP, host nu) :
  // on retombe host-only plutôt que de poser un domain invalide.
  if (host === "localhost" || /^[\d.]+$/.test(host) || !host.includes(".")) {
    return undefined;
  }

  const labels = host.split(".");
  // Sous-domaine (`app.yoga-sculpt.fr`, 3+ labels) → on retire le 1er label et
  // on préfixe d'un point → `.yoga-sculpt.fr`, partagé apex + sous-domaines.
  if (labels.length >= 3) {
    return `.${labels.slice(1).join(".")}`;
  }
  // Host déjà au niveau apex (`yoga-sculpt.fr`, 2 labels) → on le scope tel quel
  // avec un point de tête (partagé avec ses sous-domaines).
  return `.${host}`;
}

/**
 * Drapeau évalué une fois depuis `process.env`. `undefined` en dev/local.
 * `NEXT_PUBLIC_*` est inliné au build par Next.
 */
export const AUTH_COOKIE_DOMAIN = computeAuthCookieDomain({
  NODE_ENV: process.env.NODE_ENV,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
});

/**
 * Bloc `cookieOptions` à étaler dans `createServerClient`. En dev/local renvoie
 * un objet VIDE (aucun `domain` → host-only, comportement par défaut de la lib,
 * indispensable pour que le cookie marche en `localhost`).
 */
export function authCookieDomainOptions(): {
  cookieOptions?: { domain: string };
} {
  return AUTH_COOKIE_DOMAIN
    ? { cookieOptions: { domain: AUTH_COOKIE_DOMAIN } }
    : {};
}
