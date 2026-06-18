# Déploiement — Yoga Sculpt espace client (Cloudflare Workers / OpenNext)

App Next 16 → Cloudflare Workers via OpenNext. Deux environnements isolés,
auto-deploy staging par CI, deploy prod manuel. Tout en plan **freemium**.

---

## 1. Flux (modèle Veridian)

```
branche staging   ──push──►  CI: deploy-staging.yml   ──►  Worker yoga-sculpt-app-staging
                                                            (Supabase staging, PAS de cron)

merge staging → main   ──►  main à jour
main  ──Run workflow──►  CI: deploy-production.yml (MANUEL)  ──►  Worker yoga-sculpt-app
                                                                  (Supabase prod, cron actif)
```

- **Staging = automatique** : chaque `git push origin staging` redéploie le Worker de staging.
- **Prod = manuel** : `workflow_dispatch` (bouton **Run workflow** sur la branche `main`,
  onglet Actions). Choix délibéré pour qu'aucun merge sur `main` ne parte en prod par accident.
- La CI qualité (`ci.yml` : lint/build/test/trivy/audit) tourne sur les PR et push `main`,
  inchangée. Elle ne déploie rien.

### Workflow type
```bash
# 1) bosser sur une branche feature, PR vers main (CI qualité tourne)
# 2) tester en conditions réelles : merger / pousser sur staging
git push origin staging              # → déploie staging automatiquement
# 3) valider sur l'URL staging, puis :
git checkout main && git merge staging && git push origin main
# 4) déclencher la prod à la main : Actions → "Deploy production" → Run workflow (branch main)
```

---

## 2. Environnements wrangler (`wrangler.jsonc`)

| Env | `name` du Worker | Supabase | Cron | URL app (runtime) |
|---|---|---|---|---|
| `production` | `yoga-sculpt-app` | prod `esearpxflfgreejjxlfg` | `*/15 * * * *` actif | `https://app.yoga-sculpt.fr` |
| `staging` | `yoga-sculpt-app-staging` | staging `htgbtckgkulwuyzfsvjq` | **aucun** | `…workers.dev` (à caler) |

Déploiement : `wrangler deploy --env staging` / `wrangler deploy --env production`.
Scripts npm : `npm run deploy:staging`, `npm run deploy:prod`.

> ⚠️ **`NEXT_PUBLIC_APP_URL` staging** : l'URL workers.dev par défaut est
> `https://yoga-sculpt-app-staging.<sous-domaine-de-compte>.workers.dev`. Le
> sous-domaine dépend du compte CF. Au 1er déploiement, wrangler affiche l'URL
> réelle → la reporter dans `wrangler.jsonc` (vars staging) **et** dans le
> GitHub Secret `STAGING_NEXT_PUBLIC_APP_URL`. (Ou brancher un sous-domaine
> `staging.app.yoga-sculpt.fr` via une route custom domain — non fait ici.)

---

## 3. GitHub Secrets à configurer (une fois)

`Settings → Secrets and variables → Actions → New repository secret`.

### Cloudflare (communs staging + prod)
Le `CF_API_TOKEN` n'a **pas** les droits Workers → on utilise la **Global API Key**.
Wrangler s'authentifie via ces variables d'environnement :

| Secret | Valeur |
|---|---|
| `CLOUDFLARE_EMAIL` | email du compte Cloudflare (`CF_EMAIL` dans `.all-creds.env`) |
| `CLOUDFLARE_API_KEY` | Global API Key (`CF_GLOBAL_API_KEY`) |
| `CLOUDFLARE_ACCOUNT_ID` | id du compte (`CF_ACCOUNT_ID`) |

> Ne PAS définir `CLOUDFLARE_API_TOKEN` : sa présence ferait prendre le pas sur
> la Global Key (token sans droits Workers → échec).

### Supabase publiques — STAGING (injectées au build)
| Secret | Valeur |
|---|---|
| `STAGING_NEXT_PUBLIC_SUPABASE_URL` | `https://htgbtckgkulwuyzfsvjq.supabase.co` |
| `STAGING_NEXT_PUBLIC_SUPABASE_ANON_KEY` | clé anon du projet staging |
| `STAGING_NEXT_PUBLIC_APP_URL` | URL du Worker staging (workers.dev) |

### Supabase publiques — PROD (injectées au build)
| Secret | Valeur |
|---|---|
| `PROD_NEXT_PUBLIC_SUPABASE_URL` | `https://esearpxflfgreejjxlfg.supabase.co` |
| `PROD_NEXT_PUBLIC_SUPABASE_ANON_KEY` | clé anon du projet prod |
| `PROD_NEXT_PUBLIC_APP_URL` | `https://app.yoga-sculpt.fr` |

> Les `NEXT_PUBLIC_*` sont **inlinées dans le bundle au `next build`** : elles
> doivent donc être présentes au build (d'où ces secrets), pas seulement au
> runtime (`vars` de wrangler.jsonc).

### (Optionnel) Approbation humaine prod
`Settings → Environments → New environment "production"` → cocher
**Required reviewers**. Le job prod référence déjà `environment: production` :
ajouter les reviewers suffit à exiger une validation manuelle avant chaque deploy prod.

---

## 4. Secrets serveur — `wrangler secret put` (une fois par env)

Les secrets sensibles ne passent **ni par wrangler.jsonc ni par la CI**. Ils
sont poussés directement sur chaque Worker. À faire en local (auth Global Key,
cf. la procédure d'export d'env dans le `CLAUDE.md` maître), une fois par env.

```bash
# --- STAGING (Worker yoga-sculpt-app-staging) ---
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY  --env staging
npx wrangler secret put SUPABASE_JWT_SECRET        --env staging
npx wrangler secret put ADMIN_EMAILS               --env staging
npx wrangler secret put GOOGLE_CALENDAR_SA_KEY     --env staging
npx wrangler secret put GOOGLE_CALENDAR_ID         --env staging
npx wrangler secret put BREVO_API_KEY              --env staging   # voir note ci-dessous
npx wrangler secret put STRIPE_SECRET_KEY          --env staging   # clé TEST sk_test_… (phase 2)
npx wrangler secret put STRIPE_WEBHOOK_SECRET      --env staging
npx wrangler secret put STRIPE_PRICE_COLLECTIF     --env staging
npx wrangler secret put STRIPE_PRICE_PARTICULIER   --env staging
npx wrangler secret put STRIPE_PRICE_CARTE10       --env staging
# PAS de CRON_SECRET en staging : aucun cron n'y tourne (anti-mails-fantômes).

# --- PRODUCTION (Worker yoga-sculpt-app) ---
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY  --env production
npx wrangler secret put SUPABASE_JWT_SECRET        --env production
npx wrangler secret put ADMIN_EMAILS               --env production
npx wrangler secret put CRON_SECRET                --env production   # cron actif → requis
npx wrangler secret put GOOGLE_CALENDAR_SA_KEY     --env production
npx wrangler secret put GOOGLE_CALENDAR_ID         --env production
npx wrangler secret put BREVO_API_KEY              --env production
npx wrangler secret put STRIPE_SECRET_KEY          --env production   # clé LIVE sk_live_… (phase 2)
npx wrangler secret put STRIPE_WEBHOOK_SECRET      --env production
npx wrangler secret put STRIPE_PRICE_COLLECTIF     --env production
npx wrangler secret put STRIPE_PRICE_PARTICULIER   --env production
npx wrangler secret put STRIPE_PRICE_CARTE10       --env production
```

> **Brevo en staging** : si on ne veut envoyer **aucun** mail de test depuis
> staging, ne PAS pousser `BREVO_API_KEY --env staging` (l'app loggue alors les
> envois en no-op au lieu de les expédier — comportement fail-safe documenté
> dans `.env.example`). Avec pas de cron + pas de clé Brevo, staging n'envoie
> structurellement aucun mail.

La liste de référence des variables est dans `.env.example`.

---

## 5. Gestion du cron en staging

Le cron (`triggers.crons` toutes les 15 min) déclenche `GET /api/cron` qui envoie
les rappels J-1 / H-2 par mail. Il est **volontairement absent de `env.staging`** :

- aucun `triggers.crons` dans `env.staging` → Cloudflare n'enregistre aucun
  Cron Trigger sur le Worker de staging ;
- combiné à l'absence de `BREVO_API_KEY` en staging (recommandé), staging ne peut
  **pas** envoyer de vrais mails ;
- pas besoin de `CRON_SECRET` en staging.

Pour tester le cron en staging si besoin un jour : ajouter `triggers.crons` à
`env.staging`, pousser `CRON_SECRET --env staging` (valeur différente de la prod)
et une clé Brevo de test. À éviter par défaut.

---

## 6. Freemium / notes

- **Supabase staging (free tier)** se met en **pause après 7 jours d'inactivité** :
  s'il est "paused", le réactiver depuis le dashboard Supabase avant de tester.
- Cloudflare Workers : 2 Workers (prod + staging) sur le plan gratuit, OK.
- Aucun coût ajouté par cet environnement de staging.
