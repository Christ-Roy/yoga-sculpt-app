# Cookie de session cross-domaine — prérequis pour la détection d'auth sur la vitrine

> Créé 2026-06-19. Bloquant pour que le nouvel endpoint `/api/session-status`
> renvoie `authed:true` depuis le site vitrine (`yoga-sculpt.fr`).

## Contexte
L'endpoint `GET /api/session-status` (CORS, livré sur `feat/session-status-cors`)
permet à la vitrine STATIQUE (`https://yoga-sculpt.fr`) de savoir si le visiteur
est déjà connecté à l'espace client (`https://app.yoga-sculpt.fr`) pour adapter
ses CTA « Tarifs » (→ « Prendre mon ticket » qui pointe vers
`https://app.yoga-sculpt.fr/checkout?formule=<collectif|particulier|carte10>`).

La vitrine appellera l'endpoint en `fetch(..., { credentials: "include" })`.
L'endpoint est correct et complet (CORS avec origine reflétée + credentials,
préflight OPTIONS, `Vary: Origin`). **MAIS il répondra TOUJOURS `authed:false`
depuis la vitrine tant que le cookie de session n'est pas transmis cross-site.**

## Cause (constat technique vérifié)
`@supabase/ssr@0.12` pose le cookie de session avec, PAR DÉFAUT
(`dist/main/utils/constants.js` → `DEFAULT_COOKIE_OPTIONS`) :
- `sameSite: "lax"`
- `httpOnly: false`
- **host-only** (aucun `Domain` → cookie scopé à `app.yoga-sculpt.fr` SEUL)

Conséquence : un `fetch` lancé depuis `yoga-sculpt.fr` vers `app.yoga-sculpt.fr`
est CROSS-SITE → le cookie `SameSite=Lax` host-only n'est PAS envoyé → l'endpoint
ne voit aucune session → `authed:false`, même si l'utilisateur est connecté.

## Options
- **A — Cookie scopé `Domain=.yoga-sculpt.fr` (RECOMMANDÉ).**
  `yoga-sculpt.fr` et `app.yoga-sculpt.fr` partagent le même domaine enregistrable.
  Un cookie posé sur `Domain=.yoga-sculpt.fr` est partagé par l'apex ET le
  sous-domaine, donc ENVOYÉ aux deux — **sans avoir besoin de `SameSite=None`**
  (la requête reste « same-site » au sens de la spec, registrable domain commun).
  `@supabase/ssr` supporte ça nativement : on passe `cookieOptions: { domain: ".yoga-sculpt.fr" }`
  à `createServerClient` (dans `src/lib/supabase/server.ts` ET `src/lib/supabase/proxy.ts`).
  La lib fournit même `clearAuthCookiesAtScopes` pour la migration host-only → parent-domain.
  - Impact : changement SENSIBLE (touche l'auth des DEUX clients Supabase). À tester
    en staging d'abord. Les sessions existantes (cookie host-only) devront se
    re-loguer / être nettoyées (helper dédié dispo). Réversible.

- **B — `SameSite=None; Secure`.**
  Marche aussi en pur cross-site mais expose le cookie à TOUTES les requêtes
  cross-site (CSRF surface plus large). Strictement moins bon que A ici puisqu'on
  a un domaine parent commun. À ne retenir que si un jour la vitrine et l'app ne
  partagent plus le même domaine enregistrable.

## Reco
**A à ~90 %.** Domaine parent commun → cookie `Domain=.yoga-sculpt.fr`, on évite
`SameSite=None` et sa surface CSRF. C'est LA bonne solution.

Changement HORS périmètre de la branche `feat/session-status-cors` (touche les
fichiers auth sensibles `server.ts` + `proxy.ts`) → laissé en ticket pour décision
explicite + déploiement avec re-login forcé. L'endpoint et la page checkout sont,
eux, prêts et corrects : ils fonctionneront dès que le cookie sera scopé en A.

## Fichiers à modifier (option A)
- `src/lib/supabase/server.ts` → ajouter `cookieOptions: { domain: ".yoga-sculpt.fr" }`
  au `createServerClient` (uniquement en prod ; en dev/localhost ne PAS poser de domain).
- `src/lib/supabase/proxy.ts` → idem (le refresh middleware doit poser le cookie au même scope).
- Penser au conditionnement par env (pas de `Domain` en local/dev où le host est `localhost`).
- Après deploy : sessions host-only existantes invalidées → re-login (ou `clearAuthCookiesAtScopes`).
