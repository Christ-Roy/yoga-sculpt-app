<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# 🔴🔴 DÉPLOIEMENT PROD — RÈGLE ABSOLUE (lis ça AVANT de déployer)

**Ne JAMAIS déployer la prod à la main en local.** Pas de `wrangler deploy --env production`,
pas de `npx wrangler deploy --env production`, pas de build local + deploy.

✅ **Le SEUL moyen de déployer la prod** :
```bash
gh workflow run "Deploy production" --ref main
gh run watch <id> --exit-status
```

**Pourquoi c'est non négociable** : les `NEXT_PUBLIC_*` sont inlinées **au build** dans le
bundle client. Un `npm run build` local lit `.env.local` = **STAGING**
(`htgbtckgkulwuyzfsvjq`). Déployer ce bundle en prod = le client prod parle à la base
staging → Google OAuth pas activé → **`"provider is not enabled"` au login → personne ne
s'inscrit = ARGENT PERDU**. Incident vécu **2 fois** (2026-06-23). Le workflow GitHub build
avec les secrets `PROD_*` → bundle correct.

**Staging** (OK en local) : `npm run deploy:staging`.

**Après tout deploy prod**, vérifier : `curl -s app.yoga-sculpt.fr/login` → suivre les chunks
JS → doivent contenir `esearpxflfgreejjxlfg` (prod), JAMAIS `htgbtckgkulwuyzfsvjq` (staging).

Garde-fous en place : `guard-prod-deploy-ci-only.sh` (bloque `npm run deploy:prod` hors CI),
`check-prod-bundle-supabase.sh` (refuse un bundle staging), smoke test post-deploy, +
règle `deny` dans `.claude/settings.json`. Détails complets dans `DEPLOY.md`.
