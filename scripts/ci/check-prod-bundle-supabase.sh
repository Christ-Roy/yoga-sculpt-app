#!/usr/bin/env bash
# check-prod-bundle-supabase.sh — Yoga Sculpt espace client
#
# 🔴 GARDE CRITIQUE anti-régression "login Google KO" (incident 2026-06-23, 3 sessions
# perdues). Les clés Supabase sont des NEXT_PUBLIC_* → INLINÉES dans le bundle JS au
# `next build`. C'est donc l'ENVIRONNEMENT DE BUILD qui décide vers quel projet Supabase
# pointe la prod, PAS le `--env production` de wrangler (qui ne choisit que le Worker/cron).
#
# Le piège : un build LOCAL lit `.env.local` (qui pointe STAGING) → le bundle prod tape
# le Supabase STAGING (`htgbtckgkulwuyzfsvjq`), où Google OAuth est DÉSACTIVÉ →
# "provider is not enabled" → login Google mort en prod. Vécu en réel.
#
# Ce script VÉRIFIE L'ARTEFACT RÉEL (le bundle OpenNext déjà buildé) et REFUSE (exit 1)
# si la moindre ref du projet STAGING y figure, ou si la ref PROD est absente. Peu importe
# d'où vient le build : si le bundle est contaminé staging, on ne déploie pas.
#
# À lancer APRÈS `opennextjs-cloudflare build`, AVANT `wrangler deploy --env production`.
# Usage : ./scripts/ci/check-prod-bundle-supabase.sh
set -euo pipefail

APP_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$APP_ROOT"

RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[1;33m'
NC=$'\033[0m'

# Refs de projet Supabase (publiques — figurent en clair dans wrangler.jsonc/.env.example).
PROD_REF="esearpxflfgreejjxlfg"
STAGING_REF="htgbtckgkulwuyzfsvjq"

# Le bundle servi en prod = sortie OpenNext. On scanne là où le JS client atterrit.
SCAN_DIRS=()
[ -d ".open-next" ] && SCAN_DIRS+=(".open-next")
[ -d ".next" ] && SCAN_DIRS+=(".next")

if [ ${#SCAN_DIRS[@]} -eq 0 ]; then
  echo "${RED}✗ Aucun bundle à vérifier (.open-next/.next absents).${NC}" >&2
  echo "  Lance d'abord 'npm run build && npx opennextjs-cloudflare build'." >&2
  exit 1
fi

echo "# check-prod-bundle-supabase — scan: ${SCAN_DIRS[*]}"

# 1) AUCUNE ref staging ne doit figurer dans le bundle prod.
if grep -rqs "$STAGING_REF" "${SCAN_DIRS[@]}"; then
  echo "${RED}✗ BUNDLE CONTAMINÉ STAGING.${NC}" >&2
  echo "  La ref Supabase STAGING ($STAGING_REF) est présente dans le bundle." >&2
  echo "  → Le login Google sera CASSÉ en prod ('provider is not enabled')." >&2
  echo "  CAUSE typique : build LOCAL qui a lu .env.local (staging) au lieu des" >&2
  echo "  secrets PROD. NE PAS déployer ce bundle." >&2
  echo "" >&2
  echo "  ${YELLOW}FIX : ne JAMAIS déployer la prod en local. Utiliser :${NC}" >&2
  echo "    gh workflow run deploy-production.yml --ref main" >&2
  echo "  (il injecte PROD_NEXT_PUBLIC_SUPABASE_URL/ANON_KEY au build)." >&2
  exit 1
fi

# 2) La ref PROD DOIT figurer (sinon le bundle ne pointe nulle part de valide).
if ! grep -rqs "$PROD_REF" "${SCAN_DIRS[@]}"; then
  echo "${RED}✗ Ref Supabase PROD ($PROD_REF) ABSENTE du bundle.${NC}" >&2
  echo "  Le bundle ne pointe pas vers le projet Supabase de production." >&2
  echo "  Vérifier que NEXT_PUBLIC_SUPABASE_URL=https://$PROD_REF.supabase.co au build." >&2
  exit 1
fi

echo "${GREEN}✓ Bundle prod sain : pointe Supabase PROD ($PROD_REF), zéro ref staging.${NC}"
exit 0
