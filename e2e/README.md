# Harnais E2E Playwright — validation STAGING avant prod

Tests de bout en bout des **parcours réels** (auth, onboarding, réservation,
**paiement → ticket**, parrainage) contre l'environnement **staging déployé**.

> ⚠️ **Quand le lancer ?** À LA DEMANDE, contre le staging live, **AVANT chaque
> mise en prod**. **PAS** dans le pre-push ni la CI (trop lourd : vrai navigateur
> + vrais appels Supabase/Stripe TEST). Les garde-fous rapides & déterministes
> sont couverts par les tests **unitaires** Vitest (`__tests__/`), eux dans la CI.

## Prérequis

1. **Navigateur Playwright** (une fois) :
   ```bash
   npx playwright install chromium
   ```

2. **Secrets** — exportés depuis `~/credentials/.all-creds.env`. **Jamais**
   hardcodés dans les specs. Copie-colle ce bloc dans ton shell avant de lancer :

   ```bash
   CRED=~/credentials/.all-creds.env
   getv() { grep -E "^$1=" "$CRED" | head -1 | cut -d= -f2- | tr -d '"'; }

   export E2E_BASE_URL="https://yoga-sculpt-app-staging.brunon5robert.workers.dev"
   export E2E_SUPABASE_URL="$(getv YOGA_SCULPT_STAGING_SUPABASE_URL)"
   export E2E_SUPABASE_ANON_KEY="$(getv YOGA_SCULPT_STAGING_SUPABASE_ANON_KEY)"
   export E2E_SUPABASE_SERVICE_ROLE_KEY="$(getv YOGA_SCULPT_STAGING_SUPABASE_SERVICE_ROLE_KEY)"
   export E2E_SUPABASE_REF="$(getv YOGA_SCULPT_STAGING_SUPABASE_REF)"
   export E2E_STRIPE_SECRET_KEY="$(getv STRIPE_ALICE_GAUDRY_TEST_SECRET_KEY)"
   export E2E_STRIPE_WEBHOOK_SECRET="$(getv STRIPE_ALICE_GAUDRY_TEST_WEBHOOK_SECRET)"
   ```

   - `E2E_SUPABASE_SERVICE_ROLE_KEY` sert à **fabriquer/nettoyer** les comptes de
     test et à **vérifier la DB** (tables `tickets`, `bookings`). Bypass RLS.
   - `E2E_STRIPE_WEBHOOK_SECRET` sert au test paiement à émettre un
     `checkout.session.completed` **signé** (= ce que Stripe envoie après un
     paiement carte 4242).

## Lancer

```bash
# Toute la suite
npm run test:e2e

# Un fichier ciblé (recommandé pour valider vite avant prod)
npx playwright test e2e/payment.spec.ts
npx playwright test e2e/reservation.spec.ts

# Headed / debug
npx playwright test --headed
npx playwright test --debug e2e/auth.spec.ts
```

Rapport HTML : `playwright-report/` (`npx playwright show-report`).

## Authentification dans les tests

Pas de boîte mail : la fixture `loginAs(testUser)` génère un **magic-link via
l'Admin API Supabase** (`generateLink`), l'échange en **session** côté Node
(`verifyOtp`), puis **rejoue cette session dans `@supabase/ssr`** pour produire
les cookies EXACTS attendus par l'app (`sb-<ref>-auth-token`), injectés dans le
contexte navigateur. Aucun clic de lien e-mail, déterministe.

Chaque test crée un **compte jetable confirmé** (`testUser`, préfixe `e2e-…`),
supprimé après (cleanup auto même en cas d'échec).

## Couverture des specs

| Spec | Parcours |
|---|---|
| `auth.spec.ts` | non connecté → /login ; connecté → gating onboarding ; email visible |
| `onboarding.spec.ts` | avance d'une étape + **reprise du draft** au rechargement |
| `reservation.spec.ts` | **collectif** (dimanche 19h Parc Tête d'Or) + **particulier libre** 9h-21h → booking créé + ticket consommé (vérif DB) |
| `payment.spec.ts` | **PAIEMENT → TICKET** (cœur) : checkout réel → page Stripe payable → webhook signé → **ticket crédité** + idempotence au rejeu |
| `parrainage.spec.ts` | capture `?ref=CODE` (cookies) ; page parrainer ; **anti-auto-parrainage** |

> Le **paiement** : la Checkout HOSTÉE de Stripe ne rend pas ses champs carte de
> façon fiable en chromium headless. Le test crée la vraie session, atteint la
> page Stripe payable, puis déclenche le **même code path** que Stripe après un
> paiement carte `4242 4242 4242 4242` (un `checkout.session.completed` signé
> envoyé au Worker), et **vérifie en DB** que les tickets sont crédités. C'est la
> garantie « quand on paye, on reçoit les tickets ».

## 🔴 Bugs trouvés par ce harnais

- **Crédit ticket cassé après paiement (CRITIQUE, prod + staging)** — l'upsert
  idempotent du webhook (`onConflict: stripe_session_id`) générait
  `ON CONFLICT (stripe_session_id)` qui **ne matchait pas** l'index unique
  **partiel** (`WHERE stripe_session_id IS NOT NULL`) → Postgres `42P10` → le
  webhook répondait **500** → Stripe re-tentait en boucle → **aucun ticket jamais
  crédité après un paiement**. Corrigé par **migration `0015`** (index unique
  PLEIN au lieu de partiel). Vérifié : webhook 200 + ticket crédité + idempotent.
