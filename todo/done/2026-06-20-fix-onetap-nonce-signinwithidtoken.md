# [P0] RÉSOLU — One Tap "Connexion Google impossible" : nonce check Supabase

**Statut** : ✅ RÉSOLU en prod 2026-06-20 · **Qui** : Claude + Robert (test live) · **Source** : Robert "le One Tap marche pas sur les 2 domaines, erreur Connexion Google impossible"

## Symptôme
Le Google One Tap s'affichait (la bulle), l'utilisateur cliquait son compte → redirection vers
`/login?error=Connexion+Google+impossible.+Réessayez.` **sur les DEUX surfaces** :
- vitrine `yoga-sculpt.fr` (One Tap → relai `/auth/onetap` → `signInWithIdToken`)
- app `app.yoga-sculpt.fr` (One Tap interne `AuthMethods.tsx` → `signInWithIdToken` direct)

Ce message est le **fail-safe** de la route `/auth/onetap` (et du callback `AuthMethods`) :
il masque l'échec réel de `supabase.auth.signInWithIdToken({provider:"google"})`.

## Cause racine (le PIÈGE, à retenir)
Google One Tap émet un `id_token` qui **contient un `nonce`** (généré par Google).
Les deux composants One Tap (vitrine `GoogleOneTap.tsx` ET app `AuthMethods.tsx`) appellent
`initialize()` + `prompt()` **SANS gérer de nonce**, puis passent le token brut à
`signInWithIdToken`. Or Supabase Auth avait **`external_google_skip_nonce_check = false`** :
il exigeait que le nonce du token corresponde à un nonce fourni côté client → on n'en fournit
aucun → **REJET systématique**. D'où l'échec sur les 2 domaines (même mécanique sous-jacente).

C'est le piège classique et documenté de **Google One Tap + `signInWithIdToken`** : soit on
propage le nonce de bout en bout (hashé à l'init, brut à signInWithIdToken — lourd, surtout en
cross-domain), soit on **désactive le nonce check** côté Supabase. Supabase recommande la 2e
voie pour le flux One Tap.

## Fix appliqué (prod)
Via Supabase Management API, sur le projet prod `esearpxflfgreejjxlfg` :
```
PATCH /v1/projects/<ref>/config/auth  { "external_google_skip_nonce_check": true }
```
Vérifié persisté (`skip_nonce_check = True`). Robert a re-testé le One Tap en live → **ça marche**
(connexion + arrivée dans l'espace/onboarding).

Sécurité : le nonce protège contre le replay d'id_token. Le désactiver est le compromis standard
et accepté pour One Tap — Google signe déjà le token pour NOTRE client_id et l'exp est courte
(~1h). Risque faible, c'est la façon recommandée de faire marcher One Tap + Supabase.

## ⚠️ À RÉPLIQUER SUR STAGING (sinon One Tap KO en staging quand le provider Google y sera activé)
Le Supabase STAGING (`htgbtckgkulwuyzfsvjq`) n'a pas le provider Google configuré aujourd'hui
(cf `todo/2026-06-18-oauth-google-staging.md`). Le jour où on l'active : **penser à poser aussi
`external_google_skip_nonce_check = true`** sinon le One Tap y cassera pareil.

## Chaîne complète des 3 maillons réparés ce sprint pour le One Tap (récap)
1. Route `/auth/onetap` créée côté app (relai cross-domain) — déployée prod (commit `b671d19`).
   Avant : 404 au clic One Tap vitrine. Cf `done/2026-06-19-bug-onetap-vitrine-route-...md`.
2. Origine `https://app.yoga-sculpt.fr` ajoutée aux "Authorized JavaScript origins" du client
   OAuth GCP `yoga-sculpt-auth` (corrige `origin_mismatch` côté app). Console GCP, pas d'API.
3. **`skip_nonce_check=true`** côté Supabase Auth (CE ticket) — corrige le rejet `signInWithIdToken`.

Les 3 sont nécessaires. Diagnostic final établi en lisant la config Supabase Auth (l'erreur était
avalée par le fail-safe → invisible dans les logs ; la cause a été trouvée côté config provider).

## Fichiers concernés (référence, RIEN à modifier — le fix est côté config Supabase)
`src/app/auth/onetap/route.ts` (relai vitrine), `src/components/AuthMethods.tsx` (One Tap app),
`site/src/components/GoogleOneTap.tsx` (repo alice-gaudry, composant vitrine).

## Amélioration possible (NON bloquante, follow-up éventuel)
Le fail-safe `signInError` de `/auth/onetap` (ligne ~82) AVALE l'erreur Supabase sans la logger.
→ Si un autre bug auth survient, on est aveugle. Améliorer : `log.warn("signInWithIdToken échoué",
{ err: serializeError(signInError) })` avant le redirect fallback. Idem côté `AuthMethods`. Petit,
safe, améliore l'observabilité. (Déposé comme reliquat — voir todo pending si créé.)
