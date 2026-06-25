# [P1] BUG prod — One Tap du VITRINE casse : la route `/auth/onetap` n'existe pas côté app

**Statut** : à faire · **Qui** : agent · **Source** : repro Claude 2026-06-19 (Robert : « le one tap depuis la LP renvoie une erreur quand on clique »)

## Symptôme (confirmé en prod)
Depuis le **vitrine** `yoga-sculpt.fr`, le Google One Tap s'affiche, l'utilisateur clique son
compte Google → **erreur** (page introuvable). Reproduit : `curl -s -o /dev/null -w "%{http_code}"
https://app.yoga-sculpt.fr/auth/onetap?credential=test` → **404** (vs `/auth/callback` → 307).

## Cause racine (établie par lecture code, sans deviner)
Le composant vitrine `site/src/components/GoogleOneTap.tsx` (repo `alice-gaudry`) est cross-domain :
la session Supabase vit sur `app.`, pas sur le vitrine. Au callback One Tap il **relaie** le
credential vers :
```
https://app.yoga-sculpt.fr/auth/onetap?credential=<JWT_GOOGLE>
```
(cf. le commentaire de contrat dans ce fichier, lignes 15-23). **Cette route n'a jamais été
créée côté app** : `src/app/auth/` ne contient que `callback/` et `confirm/`. → 404 au clic.

⚠️ NE PAS confondre avec le ticket `2026-06-19-one-tap-google-login-invitation.md` : celui-là
concerne le One Tap INTERNE à l'app (`/login` + `/invitation` via `AuthMethods.tsx`,
`signInWithIdToken` direct, livré). Ici c'est le relais CROSS-DOMAIN du vitrine, distinct et absent.

## À faire (côté app `yoga-sculpt-app`)
Créer la route **`src/app/auth/onetap/route.ts`** (ou `page.tsx` client si besoin du SDK) qui :
1. Lit `?credential=<JWT>` (valider : présent, format JWT, sinon redirect `/login?error=...` propre).
2. Fait `supabase.auth.signInWithIdToken({ provider: "google", token: credential })` (Web Crypto /
   edge — modèle dans `AuthMethods.tsx` ligne ~151 + `auth/callback/route.ts`).
3. Redirige vers `/` (qui route ensuite vers `/onboarding` ou `/espace` selon le profil) — via
   `safeInternalRedirect` (anti open-redirect, déjà utilisé au callback).
4. Préserver le cookie `ys_ref` si présent (crédit parrain suit, comme les autres entrées auth).
5. Fail-safe : credential invalide / signInWithIdToken en erreur → redirect `/login` avec message,
   jamais un 500 nu (le vitrine compte sur ce fallback « au pire login Google normal »).

## Vérif de non-régression
- `signInWithIdToken` exige que le `client_id` Google soit déclaré côté Supabase Auth (Google
  provider) — c'est le cas en prod (OAuth Google actif). À gater/documenter en staging (provider
  Google absent sur Supabase staging, cf `2026-06-18-oauth-google-staging.md`).
- Re-tester depuis le vitrine prod après déploiement : clic One Tap → arrive loggé dans l'espace.

## Fichiers
`src/app/auth/onetap/route.ts` (nouveau). Référence : `src/components/AuthMethods.tsx`
(`signInWithIdToken`), `src/app/auth/callback/route.ts` (pattern redirect + `safeInternalRedirect`).
Côté vitrine (repo alice-gaudry, NE PAS toucher ici) : `site/src/components/GoogleOneTap.tsx`.
