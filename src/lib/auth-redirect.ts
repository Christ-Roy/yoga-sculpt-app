/**
 * Validation d'un `redirectTo` interne — anti open-redirect.
 *
 * On accepte UNIQUEMENT un chemin interne (relatif à notre origine). Un
 * `startsWith("/")` naïf NE SUFFIT PAS : il laisse passer les URLs
 * « protocol-relative » `//evil.com` que les navigateurs (et `new URL`) résolvent
 * vers `https://evil.com`, ainsi que `/\evil.com` (certains navigateurs traitent
 * le backslash comme un slash → équivalent `//`). Les deux sont des open-redirects.
 *
 * Règle retenue (liste blanche stricte) : le redirect est accepté SEULEMENT s'il
 *   - commence par `/`            (chemin absolu interne) ;
 *   - ET PAS par `//`             (protocol-relative → host externe) ;
 *   - ET PAS par `/\`             (backslash assimilé à `/` par les navigateurs).
 * Sinon on retombe sur le `fallback` (un chemin interne sûr, ex. `/espace`).
 *
 * RUNTIME — edge-safe : logique pure (aucune dépendance, aucun I/O).
 */

/**
 * Renvoie un chemin interne SÛR : `redirectTo` s'il est un chemin interne
 * légitime, sinon `fallback`.
 *
 * @param redirectTo valeur brute (issue d'un query param / cookie, donc CONTRÔLÉE
 *                   par le client → non fiable).
 * @param fallback   destination interne par défaut (doit elle-même être un chemin
 *                   interne sûr, p.ex. `/espace`).
 */
export function safeInternalRedirect(
  redirectTo: string | null | undefined,
  fallback: string,
): string {
  if (!redirectTo) return fallback;

  // Doit être un chemin absolu interne, mais PAS protocol-relative (`//host`)
  // ni `/\host` (backslash traité comme `/` par certains navigateurs).
  if (
    redirectTo.startsWith("/") &&
    !redirectTo.startsWith("//") &&
    !redirectTo.startsWith("/\\")
  ) {
    return redirectTo;
  }

  return fallback;
}
