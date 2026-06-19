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

---

## ✅ LIVRÉ — staging (Option A) — 2026-06-19

Commit `2f7bc49` sur `staging`. Implémentation :
- `src/lib/supabase/cookie-domain.ts` (NOUVEAU) — source de vérité unique du
  scope cookie. `computeAuthCookieDomain(env)` PURE + testée. **PROD UNIQUEMENT**
  (`NODE_ENV === "production"`, même convention que `src/middleware.ts` pour le
  flag `secure`). Dev/local → AUCUN `domain` (host-only), sinon le cookie casse
  en `localhost`. Domaine dérivé du host de `NEXT_PUBLIC_APP_URL` (pas codé en
  dur), fallback `.yoga-sculpt.fr`. Edge-safe (`process.env` + `URL`).
- `src/lib/supabase/server.ts` + `src/lib/supabase/proxy.ts` — spread
  `...authCookieDomainOptions()` dans `createServerClient` (les DEUX clients au
  MÊME scope : sinon le refresh middleware ré-écrirait un cookie host-only qui
  écraserait le cookie parent-domain).
- `__tests__/lib/cookie-domain.test.ts` — prod/dev, apex vs sous-domaine,
  localhost/IP, URL absente/malformée.

### ⚠️ PLAN DE TRANSITION RE-LOGIN (au déploiement prod)
Au passage en prod, les sessions EXISTANTES portent un cookie **host-only**
(sans `Domain`). Le nouveau code lit/écrit un cookie **parent-domain**
(`Domain=.yoga-sculpt.fr`). Conséquences + conduite à tenir :
1. Le client parent-domain ne « voit » pas le cookie host-only → l'utilisateur
   est considéré déconnecté → **re-login forcé une fois**. Aucune perte de
   données (juste une ré-authentification).
2. Risque de DOUBLON transitoire : un cookie host-only `sb-…-auth-token` ET un
   cookie parent-domain du même nom peuvent coexister un court instant (le
   navigateur enverrait les deux, host-only prioritaire selon la spécificité).
   En pratique le re-login ré-émet le cookie au scope parent et la session
   repart proprement ; le host-only expire seul.
3. `@supabase/ssr` fournit `clearAuthCookiesAtScopes` pour nettoyer
   explicitement les cookies host-only résiduels lors de la transition. **Non
   câblé ici** (le re-login naturel suffit et le ticket l'acceptait). À ajouter
   au `/login` ou `/auth/callback` SI on observe des doublons collants en prod
   après deploy → ticket follow-up si besoin (pas bloquant).
4. Communication : aucun message user nécessaire (re-login transparent), juste
   surveiller le taux d'auth post-deploy.

→ Reste : valider CI staging verte, puis promo prod (workflow déploiement habituel).
