# [P2] Google One Tap sur /login + /invitation (dans le composant auth partagé)

**Statut** : à faire · **Qui** : agent · **Source** : demande Robert 2026-06-19 (pas faite ce sprint)

## Besoin
`/login` n'a qu'un bouton « Continuer avec Google » (OAuth redirect classique). Robert veut
le **Google One Tap** (le popup d'auth qui apparaît automatiquement, sans clic). Le vitrine
l'a déjà (`site/src/components/GoogleOneTap.tsx`, ancré `prompt_parent_id`). Le porter sur l'app.

## Pourquoi maintenant c'est propre
Le composant auth est désormais PARTAGÉ (`src/components/AuthMethods.tsx`, utilisé par /login
ET /invitation, livré ce sprint). En branchant le One Tap dans AuthMethods, il apparaît d'un
coup sur les DEUX pages, sans duplication.

## Technique
- Sur l'app, l'auth vit en local (cookies app) → contrairement au vitrine (cross-domain), on
  peut faire `supabase.auth.signInWithIdToken({ provider: "google", token: credential })`
  DIRECTEMENT dans le callback One Tap (pas de relais `/auth/onetap`).
- Charger le SDK GSI (`accounts.google.com/gsi/client`) en différé, armer le prompt après
  première interaction (RGPD/perf, cf le pattern du vitrine). client_id =
  NEXT_PUBLIC_GOOGLE_CLIENT_ID (projet yoga-sculpt-auth).
- Le `redirectTo` après One Tap doit passer par `safeInternalRedirect` (anti open-redirect).
- Sur /invitation : le One Tap doit préserver le cookie ys_ref (le crédit parrain suit).
- Vérifier que ça ne casse pas le magic-link ni le bouton Google classique (coexistence).

## Référence
Composant vitrine : `site/src/components/GoogleOneTap.tsx` (repo alice-gaudry). Migration
notes : Google OAuth actif en prod app, pas sur staging Supabase (cf
[[2026-06-18-oauth-google-staging]]) → One Tap testable surtout en prod / à gater en staging.
