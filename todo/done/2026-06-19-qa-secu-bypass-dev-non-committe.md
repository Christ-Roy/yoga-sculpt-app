# [P1] QA sécu — Bypass d'auth DEV : code NON committé + tests d'invariant ABSENTS

**Statut** : à traiter avant merge · **Qui** : agent · **Source** : QA sécu 2026-06-19 (axe #1 — risque #1)

## Verdict global sur le bypass : la conception est SAINE, mais elle n'est PAS encore protégée par ce qu'elle prétend.

Le mécanisme `DEV_AUTH_BYPASS` (worktree `/tmp/wt-bypass`, branche `feat/dev-auth-bypass`) est **bien conçu** : garde combinée airtight, doc claire, `.env.example` ship `=0`, garde CI écrite et câblée à 3 niveaux. MAIS deux trous réels empêchent de le déclarer "sûr en l'état".

## Trou 1 (bloquant) — Tout le bypass est en working-tree NON COMMITTÉ
`git status` du worktree `/tmp/wt-bypass` :
```
?? src/lib/dev-auth.ts            <- LE fichier de garde : UNTRACKED
?? src/lib/auth.ts                <- getCurrentUser centralisé : UNTRACKED
?? scripts/ci/check-no-dev-auth-bypass.sh  <- la garde CI : UNTRACKED
 M src/lib/supabase/server.ts     <- createClient() renvoie service_role si bypass : non staged
 M src/lib/supabase/proxy.ts      <- updateSession() laisse TOUT passer si bypass : non staged
 M src/lib/admin.ts               <- requireAdmin() court-circuité si bypass : non staged
 M .github/workflows/ci.yml / .husky/pre-push / .env.example  : non staged
```
Le HEAD de `feat/dev-auth-bypass` = `e426f4a` = tip de staging ; il ne contient AUCUN code de bypass (`git show HEAD:src/lib/dev-auth.ts` → "n'existe pas dans HEAD"). Conséquence concrète : **la garde CI `check-no-dev-auth-bypass.sh` étant untracked, elle ne tourne pas** (ni en pre-push ni en GitHub Actions, qui font `npm ci` sur l'arbre committé). Tant que ce n'est pas committé proprement, la "défense en profondeur" annoncée n'existe pas — c'est du code sur le disque d'une machine.

→ Action : committer l'ensemble du bypass sur sa branche en UN lot cohérent (code + script CI + hook + ci.yml + .env.example + tests), puis vérifier que le pre-push exécute bien la garde.

## Trou 2 (bloquant) — Les tests d'invariant promis n'existent pas
- `src/lib/dev-auth.ts` documente : "C'est l'invariant prouvé par le test unitaire (`__tests__/lib/dev-auth.test.ts`)." → **ce fichier n'existe pas** (`__tests__/lib/` ne contient aucun `dev-auth*`).
- `check-no-dev-auth-bypass.sh` exclut de son scan `__tests__/scripts/check-no-dev-auth-bypass.test.ts` → **ce fichier n'existe pas non plus** (`__tests__/scripts/` absent).
- Donc l'affirmation centrale "`NODE_ENV=production` neutralise le bypass même si la var =1" n'est **pas testée**. C'est précisément l'invariant à ne jamais casser ; il doit être verrouillé par un test, pas par un commentaire.

→ Action : écrire `__tests__/lib/dev-auth.test.ts` couvrant `computeDevAuthBypass()` : (var=1, NODE_ENV=production) ⇒ false ; (var=1, NODE_ENV=development) ⇒ true ; (var absente) ⇒ false ; (var="0") ⇒ false ; casse/espaces. + un test de la garde CI (script exit 1 si `=1` dans un fichier tracké).

## Ce qui est DÉJÀ solide (à conserver tel quel)
- **Garde runtime airtight** : `computeDevAuthBypass()` est une fonction PURE, garde combinée `NEXT_PUBLIC_DEV_AUTH_BYPASS==="1"` ET `NODE_ENV!=="production"`. Les deux vars sont inlinées au build par Next ⇒ en prod la constante vaut `false` et le code mort est tree-shaké.
- **Centralisation parfaite** : un seul point de décision (`DEV_AUTH_BYPASS`), consommé par `proxy.ts`, `server.ts`, `admin.ts`, `auth.ts`. Toutes les pages protégées passent par `getCurrentUser()` / `requireAdmin()` (vérifié : `espace/*`, `onboarding/*` n'appellent jamais `supabase.auth.getUser()` en direct). Aucune divergence possible entre pages.
- **`.env.example` ship la valeur SÛRE** `NEXT_PUBLIC_DEV_AUTH_BYPASS=0` + avertissement triple ⚠️.
- **Garde CI bien écrite** : motif tolérant (`=`/`:`, espaces, guillemets, forme wrangler JSON), scanne `git ls-files`, exclut self + lockfiles, exit 1 explicite. Câblée dans `pre-push` (étape 6) ET `.github/workflows/ci.yml` (job "CI checks"). Il ne manque QUE de la committer.

## Note sur le compromis service_role (acceptable, DEV-only)
En mode bypass, `createClient()` renvoie le **service_role** (bypass RLS) au lieu du client anon RLS-scopé. C'est documenté et assumé pour que les pages de test affichent de vraies données. C'est sûr **uniquement** parce que le mode est impossible en prod — ce qui renforce l'exigence que les Trous 1 & 2 soient fermés avant tout merge. Ne JAMAIS relâcher la garde combinée.

## Fichiers (worktree /tmp/wt-bypass)
`src/lib/dev-auth.ts`, `src/lib/auth.ts`, `src/lib/supabase/{server,proxy}.ts`, `src/lib/admin.ts`, `scripts/ci/check-no-dev-auth-bypass.sh`, `.husky/pre-push`, `.github/workflows/ci.yml`, `.env.example` + tests à créer.
