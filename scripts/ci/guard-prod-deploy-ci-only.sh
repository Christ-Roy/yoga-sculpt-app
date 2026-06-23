#!/usr/bin/env bash
# guard-prod-deploy-ci-only.sh — Yoga Sculpt espace client
#
# 🔴 CADENAS anti-régression "login Google KO" (incident 2026-06-23). Le déploiement
# PROD ne doit se faire QUE via le workflow GitHub `deploy-production.yml`, JAMAIS depuis
# une machine locale — parce qu'un build local embarque les vars `.env.local` (STAGING)
# dans le bundle prod (cf check-prod-bundle-supabase.sh).
#
# Ce garde REFUSE (exit 1) un `deploy:prod` qui ne tourne pas dans un runner CI.
# Le workflow GitHub définit CI=true (standard GitHub Actions) → il passe. Un terminal
# local n'a pas CI=true → il est bloqué, avec le bon mode d'emploi.
#
# Échappatoire d'urgence EXPLICITE et tracée : ALLOW_LOCAL_PROD_DEPLOY=1 (à n'utiliser
# qu'en connaissance de cause, ET en ayant fourni les vraies vars PROD au build —
# check-prod-bundle-supabase.sh reste le filet final qui vérifie l'artefact).
set -euo pipefail

RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[1;33m'
NC=$'\033[0m'

if [ "${ALLOW_LOCAL_PROD_DEPLOY:-0}" = "1" ]; then
  echo "${YELLOW}⚠ guard-prod-deploy : déploiement prod LOCAL autorisé via ALLOW_LOCAL_PROD_DEPLOY=1.${NC}" >&2
  echo "  Assure-toi que le build a utilisé les vars PROD (pas .env.local staging)." >&2
  exit 0
fi

# Runner CI ? GitHub Actions (et la plupart des CI) posent CI=true.
if [ "${CI:-}" = "true" ] || [ "${GITHUB_ACTIONS:-}" = "true" ]; then
  echo "${GREEN}✓ guard-prod-deploy : exécution en CI — déploiement prod autorisé.${NC}"
  exit 0
fi

echo "${RED}✗ Déploiement PROD LOCAL bloqué.${NC}" >&2
echo "" >&2
echo "  La prod yoga-sculpt-app se déploie UNIQUEMENT via le workflow GitHub," >&2
echo "  qui injecte les bons secrets Supabase PROD au build. Un build local lit" >&2
echo "  .env.local (= STAGING) et casserait le login Google en prod." >&2
echo "" >&2
echo "  ${YELLOW}→ Déploie ainsi :${NC}" >&2
echo "      gh workflow run deploy-production.yml --ref main" >&2
echo "      gh run watch \$(gh run list --workflow=deploy-production.yml -L1 --json databaseId -q '.[0].databaseId')" >&2
echo "" >&2
echo "  (Urgence seulement, en connaissance de cause : ALLOW_LOCAL_PROD_DEPLOY=1)" >&2
exit 1
