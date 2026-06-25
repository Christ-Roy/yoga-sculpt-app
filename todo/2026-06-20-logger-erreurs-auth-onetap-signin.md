# [P2] Logger les erreurs réelles de signInWithIdToken (auth/onetap + AuthMethods)

**Statut** : à faire · **Qui** : agent · **Source** : debug One Tap 2026-06-20 (on a été AVEUGLES)

## Pourquoi (vécu)
Le 2026-06-20, le One Tap échouait en prod ("Connexion Google impossible"). Le diagnostic a pris
trop de temps parce que **l'erreur Supabase réelle était AVALÉE** : la route `/auth/onetap`
(et le callback `AuthMethods`) attrape `signInError` et redirige vers `/login?error=générique`
**sans jamais logger l'erreur Supabase sous-jacente**. Résultat : `wrangler tail` ne montrait rien
d'exploitable, la cause (nonce check) a dû être trouvée en lisant la config Supabase à la main.

C'est le genre de fail-safe qui cache la panne au lieu de l'exposer. Le fail-safe (redirect propre,
pas de 500) est BON pour l'UX — mais il doit **logger l'erreur réelle** pour l'observabilité.

## À faire
- `src/app/auth/onetap/route.ts` (~ligne 82, le `if (signInError)`) : avant le redirect fallback,
  `log.warn("signInWithIdToken (one tap relai) échoué", { err: serializeError(signInError) })`.
  `log` et `serializeError` sont DÉJÀ importés dans ce fichier — c'est une ligne à ajouter.
- `src/components/AuthMethods.tsx` (le callback One Tap interne, ~ligne 151 `signInWithIdToken`) :
  logger l'erreur côté client aussi (console.error structuré ou via le logger si dispo côté client).
- Garder le message UTILISATEUR générique ("Connexion Google impossible") — on ne change QUE
  l'observabilité serveur, pas l'UX ni la sécurité (ne pas fuiter le détail à l'utilisateur).

## Bénéfice
La prochaine panne auth (token expiré, provider mal configuré, nonce, client_id...) sera
diagnosticable en 30s via `wrangler tail` au lieu de devoir auditer la config Supabase à l'aveugle.

## Fichiers
`src/app/auth/onetap/route.ts`, `src/components/AuthMethods.tsx`. Périmètre minuscule, safe.
