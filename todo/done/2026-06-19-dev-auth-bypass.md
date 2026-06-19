# [P1] Bypass d'auth en DEV (env-gated) pour itérer sur l'UI sans login

**Statut** : non fait · **Qui** : agent · **Demande Robert 2026-06-19**

## Problème
Itérer sur l'UI des pages protégées (`/onboarding`, `/espace/*`, `/admin/*`) en dev (hot reload Tailscale) est pénible : à chaque session il faut un magic link valide, le flux `#access_token` sur `/login` ne se consomme pas toujours, on perd du temps sur l'auth au lieu de bosser l'UI.

## Solution (tranchée Robert) : bypass d'auth STRICTEMENT gardé par variable d'env de dev
Ajouter un mode dev qui, **et seulement si** `NEXT_PUBLIC_DEV_AUTH_BYPASS=1` (présent uniquement dans le `.env.local` du dev / dev-pub, JAMAIS en prod ni staging), injecte automatiquement une session d'un user de test → toutes les pages s'ouvrent directement, sans login.

### Exigences de sécurité (CRITIQUE — non négociable)
- Le bypass DOIT être **impossible à activer en prod/staging** :
  - Garde combinée : `process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS === "1"` **ET** `process.env.NODE_ENV !== "production"`. Idéalement aussi un check que l'app tourne en `next dev` (pas un build prod).
  - La variable n'est PAS dans `.env.example` documentée comme activable, OU documentée avec un AVERTISSEMENT explicite "DEV LOCAL UNIQUEMENT".
  - Husky/CI : ajouter un check qui FAIL si `NEXT_PUBLIC_DEV_AUTH_BYPASS=1` apparaît dans un fichier committé / dans la config de déploiement. (check-secrets ou un nouveau check léger.)
- Le user de test : un compte de dev dédié (`onboarding-dev@yoga-sculpt.fr` existe déjà, id `dc18b9cb-4e4d-4f7e-8924-eb1ced7d4ee7`) OU un user mocké. Le bypass doit pouvoir cibler ce compte (lecture de ses vraies données staging) — préférable à un mock total pour tester le vrai flux.

### Implémentation suggérée
- Dans `src/lib/supabase/proxy.ts` (`updateSession`, le middleware de protection) : au tout début, `if (DEV_BYPASS) return NextResponse.next()` → laisse passer toutes les routes sans redirection login.
- Dans les pages/Server Components qui font `getUser()` : un helper `getCurrentUser()` qui, en mode bypass, renvoie le user de test (via service client + son id) au lieu de la vraie session. Centraliser pour ne pas dupliquer la garde.
- Un toggle pratique : `NEXT_PUBLIC_DEV_AUTH_BYPASS=1` dans le `.env.local` du dev-pub → au prochain `next dev`, tout est ouvert.
- Bonus : permettre de choisir le "rôle" simulé (user normal vs admin) via une 2e var `DEV_BYPASS_ROLE=admin|user` pour tester aussi l'admin sans être dans la whitelist.

### Validation
- En dev avec la var → `/onboarding`, `/espace`, `/admin` s'ouvrent direct.
- SANS la var (défaut) → comportement normal (redirection login). Tester les 2.
- Build prod : vérifier que même avec la var forcée, `NODE_ENV=production` neutralise le bypass.
- `npm ci` 1×, tsc=0, lint=0, test du helper de garde (le bypass OFF en prod).

## Fichiers
- `src/lib/supabase/proxy.ts`, un helper `src/lib/auth.ts` (ou équivalent) pour `getCurrentUser` centralisé, `.env.example` (doc avertissement), check CI.

## Impact
Débloque tout le travail UI sur l'app à vie (onboarding, espace, admin) sans friction d'auth. Risque = 0 si la garde env+NODE_ENV est stricte et testée. C'est LA solution viable demandée par Robert pour "remettre à jour l'UI plus tard".
