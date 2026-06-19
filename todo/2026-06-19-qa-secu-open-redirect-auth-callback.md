# [P2] QA sécu — Open-redirect protocol-relative (`//evil.com`) sur /auth/callback (+ /auth/confirm)

**Statut** : à corriger · **Qui** : agent · **Source** : QA sécu 2026-06-19 (axe #6 open-redirect)

## Problème
`src/app/auth/callback/route.ts` (~l.124-127) valide le `redirectTo` uniquement par `startsWith("/")` :
```js
if (redirectTo && redirectTo.startsWith("/")) {
  destination = redirectTo;
}
```
`startsWith("/")` **laisse passer `//evil.com`** (URL protocol-relative). `NextResponse.redirect(new URL("//evil.com", origin))` résout vers `https://evil.com`.

## Exploit
Lien forgé envoyé à la victime :
```
https://app.yoga-sculpt.fr/auth/callback?code=<code_attaquant>&redirectTo=//evil.com
```
→ après échange de session, la victime est redirigée vers `evil.com` (phishing / redirect-chain). Impact **limité** (la session est dans les cookies, pas dans l'URL → pas d'exfil de token ; il faut un `code` OAuth valide dans le lien), mais c'est un open-redirect réel.

## Même angle mort ailleurs (P3 dans la même passe)
- `src/app/auth/confirm/page.tsx` (~l.34-35) : même check `startsWith("/")` → même faiblesse `//` (valeur moins exploitable).
- `src/app/checkout/page.tsx` et `src/lib/supabase/proxy.ts` : le `redirectTo` de proxy est dérivé du `pathname` (pas de l'input client) → safe. checkout fait le bon check mais partage l'angle mort `//`.

## Correctif
Le repo a DÉJÀ le bon helper : `safeInternalRedirect` dans `src/lib/auth-redirect.ts` (sur la branche `feat/auth-onetap`, qui gère explicitement `//` et `/\`). Au merge du one-tap :
1. Brancher `/auth/callback`, `/auth/confirm`, `/checkout` sur `safeInternalRedirect(redirectTo, "/espace")`.
2. Supprimer les 3 checks `startsWith("/")` copiés-collés divergents au profit d'un seul guard testé.

Si le one-tap n'est pas mergé d'abord : un check minimal `redirectTo.startsWith("/") && !redirectTo.startsWith("//") && !redirectTo.startsWith("/\\")`.

## Ce qui est DÉJÀ solide
- CORS `/api/session-status` : allow-list stricte (lookup exact, pas de `endsWith`), jamais `*`+credentials, `Vary: Origin`, fuite minimale (`{authed, prenom?}`). Verdict : SÛR.
- One-tap : `signInWithIdToken` délègue la vérif JWT/aud à Supabase (usage correct), `redirectTo` déjà passé par `safeInternalRedirect`.

## Fichiers
`src/app/auth/callback/route.ts`, `src/app/auth/confirm/page.tsx`, `src/app/checkout/page.tsx`, `src/lib/auth-redirect.ts` (branche feat/auth-onetap).
