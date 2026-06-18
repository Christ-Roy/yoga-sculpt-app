#!/usr/bin/env bash
# check-env-sync.sh — Yoga Sculpt espace client
#
# Sync des variables d'ENV entre le CODE (`process.env.X` dans src/) et le
# modèle `.env.example`. Adapté du hub (qui compare aussi aux composes Docker) :
# ici PAS de Docker — la prod tourne sur Cloudflare Workers (secrets injectés via
# `wrangler secret put`). La référence documentaire est donc `.env.example` seul.
#
# BLOQUE (exit 1) si :
#   1. Une `process.env.X` est utilisée dans src/ MAIS absente de .env.example
#      ET de l'allowlist native → un déploiement oublierait la variable
#      (crash runtime ou mode dégradé silencieux).
#
# WARNING (non bloquant) :
#   2. Une var déclarée dans .env.example n'est ni utilisée dans le code, ni dans
#      l'allowlist → dette de doc à nettoyer.
#
# Allowlists :
#   - ALLOWLIST_NATIVE   : vars injectées par Node/Next sans `process.env.X`
#     explicite dans NOTRE code.
#   - ALLOWLIST_DECLARED : vars légitimement présentes dans .env.example sans
#     `process.env.X` statique détectable, parce qu'elles sont :
#       * lues DYNAMIQUEMENT (`process.env[config.priceEnvVar]` → STRIPE_PRICE_*),
#       * consommées côté dashboard Supabase / provisioning (OAuth, mgmt token),
#       * réservées pour une phase ultérieure (STRIPE_PUBLISHABLE_KEY).
#
# Skip d'urgence : SKIP_ENV_SYNC=1 git push (à éviter).
set -euo pipefail

if [ "${SKIP_ENV_SYNC:-0}" = "1" ]; then
  echo "⚠ check-env-sync.sh skipped via SKIP_ENV_SYNC=1"
  exit 0
fi

APP_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$APP_ROOT"

RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[1;33m'
NC=$'\033[0m'

# Vars injectées par la plateforme (jamais déclarées dans .env.example).
ALLOWLIST_NATIVE="NODE_ENV PORT HOSTNAME PWD HOME PATH USER CI"

# Vars déclarées dans .env.example mais sans process.env.X statique dans src/.
ALLOWLIST_DECLARED="\
  STRIPE_PRICE_COLLECTIF STRIPE_PRICE_PARTICULIER STRIPE_PRICE_CARTE10 \
  STRIPE_PUBLISHABLE_KEY \
  GOOGLE_OAUTH_CLIENT_ID GOOGLE_OAUTH_CLIENT_SECRET \
  MICROSOFT_OAUTH_CLIENT_ID MICROSOFT_OAUTH_CLIENT_SECRET MICROSOFT_OAUTH_TENANT_ID \
  SUPABASE_MANAGEMENT_TOKEN SUPABASE_ORG_ID SUPABASE_DB_PASSWORD \
  SUPABASE_JWT_SECRET SUPABASE_PROJECT_REF \
  NEXT_PUBLIC_SITE_URL"

# ─── Vars utilisées dans le code (src/). ─────────────────────────────────────
USED_VARS=$(grep -rohE 'process\.env\.[A-Z][A-Z0-9_]+' src 2>/dev/null \
  | grep -oE '[A-Z][A-Z0-9_]+$' \
  | sort -u || true)

if [ -z "$USED_VARS" ]; then
  echo "${YELLOW}⚠ Aucune process.env.* trouvée dans src/ — check skip${NC}"
  exit 0
fi

# ─── Vars déclarées dans .env.example. ───────────────────────────────────────
DECLARED_EXAMPLE=""
if [ -f .env.example ]; then
  DECLARED_EXAMPLE=$(grep -E '^[A-Z][A-Z0-9_]+=' .env.example 2>/dev/null \
    | grep -oE '^[A-Z][A-Z0-9_]+' \
    | sort -u)
fi

DECLARED_ALL=$(printf '%s\n%s\n' "$DECLARED_EXAMPLE" "$ALLOWLIST_NATIVE" \
  | tr ' ' '\n' | grep -v '^$' | sort -u)

# ─── 1) Utilisées mais non déclarées (BLOQUANT). ─────────────────────────────
UNDOCUMENTED=$(comm -23 <(echo "$USED_VARS") <(echo "$DECLARED_ALL") | grep -v '^$' || true)

# ─── 2) Déclarées mais ni utilisées ni en allowlist (WARNING). ───────────────
UNUSED=""
if [ -n "$DECLARED_EXAMPLE" ]; then
  ALLOWED_FILTER=$(echo "$ALLOWLIST_DECLARED $ALLOWLIST_NATIVE" | tr ' ' '\n' | grep -v '^$' | sort -u)
  UNUSED=$(comm -23 <(echo "$DECLARED_EXAMPLE") <(echo "$USED_VARS") \
    | comm -23 - <(echo "$ALLOWED_FILTER") \
    | grep -v '^$' || true)
fi

# ─── Verdict. ────────────────────────────────────────────────────────────────
VIOLATIONS=0

if [ -n "$UNDOCUMENTED" ]; then
  COUNT=$(echo "$UNDOCUMENTED" | grep -c . || true)
  echo "${RED}✗ ${COUNT} var(s) ENV utilisées dans src/ MAIS absentes de .env.example :${NC}"
  echo "$UNDOCUMENTED" | sed 's/^/  - /'
  echo "${YELLOW}  Fix : ajouter à .env.example avec un commentaire explicatif.${NC}"
  VIOLATIONS=$((VIOLATIONS + COUNT))
fi

if [ -n "$UNUSED" ]; then
  COUNT=$(echo "$UNUSED" | grep -c . || true)
  echo "${YELLOW}⚠ ${COUNT} var(s) déclarées dans .env.example mais introuvables dans src/ :${NC}"
  echo "$UNUSED" | sed 's/^/  - /'
  echo "${YELLOW}  Reco : retirer de .env.example ou ajouter à ALLOWLIST_DECLARED (NON BLOQUANT).${NC}"
fi

if [ "$VIOLATIONS" -eq 0 ]; then
  echo "${GREEN}✓ ENV sync OK (code ↔ .env.example)${NC}"
  exit 0
fi

echo
echo "${RED}╔════════════════════════════════════════════════════════════╗${NC}"
echo "${RED}║ PUSH REFUSÉ — ${VIOLATIONS} var(s) ENV non documentée(s)        ║${NC}"
echo "${RED}╚════════════════════════════════════════════════════════════╝${NC}"
echo "Skip d'urgence : SKIP_ENV_SYNC=1 git push (NE PAS abuser)"
exit 1
