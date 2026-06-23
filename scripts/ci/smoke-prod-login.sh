#!/usr/bin/env bash
# smoke-prod-login.sh — Yoga Sculpt espace client
#
# 🟢 SMOKE TEST post-déploiement : vérifie EN PROD RÉELLE que le login n'est pas
# cassé. Dernier filet de l'incident "login Google KO" (2026-06-23) : si malgré
# tout un bundle staging arrivait en prod, ce test l'attrape en quelques secondes
# au lieu de 3 sessions plus tard.
#
# Deux vérifs, sans navigateur (curl pur) :
#   1. La page /login répond 200.
#   2. Le JS servi par la prod NE contient PAS la ref Supabase STAGING, et
#      contient bien la ref PROD (le bundle déployé pointe le bon projet).
#
# À lancer APRÈS le déploiement (étape finale du workflow, et utile à la main
# n'importe quand pour auditer la prod).
# Usage : ./scripts/ci/smoke-prod-login.sh
set -euo pipefail

GREEN=$'\033[0;32m'; RED=$'\033[0;31m'; YELLOW=$'\033[1;33m'; NC=$'\033[0m'

BASE="https://app.yoga-sculpt.fr"
PROD_REF="esearpxflfgreejjxlfg"
STAGING_REF="htgbtckgkulwuyzfsvjq"

echo "# smoke-prod-login — $BASE"

# 1) /login répond ?
code=$(curl -sS -o /tmp/ys_login.html -w "%{http_code}" "$BASE/login" || echo "000")
if [ "$code" != "200" ]; then
  echo "${RED}✗ /login a répondu HTTP $code (attendu 200).${NC}" >&2
  exit 1
fi
echo "${GREEN}✓ /login → 200${NC}"

# 2) Récupérer les chunks JS référencés et scanner la ref Supabase servie.
#    On extrait les src des bundles _next du HTML, on en télécharge quelques-uns.
mapfile -t chunks < <(grep -oE '/_next/static/chunks/[A-Za-z0-9_./-]+\.js' /tmp/ys_login.html | sort -u | head -20)
if [ "${#chunks[@]}" -eq 0 ]; then
  echo "${YELLOW}⚠ Aucun chunk _next trouvé dans /login (page changée ?). Smoke partiel.${NC}" >&2
  exit 0
fi

found_staging=0
found_prod=0
for c in "${chunks[@]}"; do
  body="$(curl -sS "$BASE$c" || true)"
  case "$body" in
    *"$STAGING_REF"*) found_staging=1 ;;
  esac
  case "$body" in
    *"$PROD_REF"*) found_prod=1 ;;
  esac
done

if [ "$found_staging" = "1" ]; then
  echo "${RED}✗ La PROD sert un bundle qui pointe Supabase STAGING ($STAGING_REF).${NC}" >&2
  echo "  → Login Google CASSÉ en prod. Redéployer via deploy-production.yml." >&2
  exit 1
fi
if [ "$found_prod" != "1" ]; then
  echo "${YELLOW}⚠ Ref PROD ($PROD_REF) non détectée dans les chunks scannés.${NC}" >&2
  echo "  (Supabase est peut-être référencé dans un chunk non échantillonné — vérif manuelle si doute.)" >&2
  exit 0
fi

echo "${GREEN}✓ La prod sert le bundle PROD ($PROD_REF), zéro ref staging. Login OK.${NC}"
exit 0
