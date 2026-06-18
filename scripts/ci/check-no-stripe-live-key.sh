#!/usr/bin/env bash
# check-no-stripe-live-key.sh — Yoga Sculpt espace client
#
# Filet de sécurité CRITIQUE : aucune clé Stripe LIVE ne doit JAMAIS être
# committée en clair. L'app manipule des clés Stripe (paiement des carnets de
# tickets) ; les clés LIVE vivent UNIQUEMENT comme secrets runtime injectés via
# `wrangler secret put` côté Cloudflare Workers — jamais dans un fichier tracké.
#
# Une vraie clé LIVE a la forme `<prefix>_live_<~99 chars alphanum>`.
# Préfixes couverts :
#   - sk_live_  → secret key live (la plus sensible, accès complet API)
#   - rk_live_  → restricted key live
#   - pk_live_  → publishable key live
#
# Le seuil de 20 caractères alphanum après le préfixe distingue une VRAIE clé
# d'une simple mention (commentaire `sk_live_...`, fausse clé d'exemple courte).
#
# Usage : ./scripts/ci/check-no-stripe-live-key.sh
# Exit 1 si une clé LIVE en clair est trouvée dans un fichier tracké.
set -euo pipefail

APP_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$APP_ROOT"

RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
NC=$'\033[0m'

# Motif d'une vraie clé Stripe LIVE : préfixe + >=20 chars alphanum.
LIVE_KEY_PATTERN='(sk|rk|pk)_live_[A-Za-z0-9]{20,}'

# Périmètre : tous les fichiers trackés, SAUF :
#  - ce script lui-même (le motif figure dans sa doc) ;
#  - son fichier de test éventuel (fausses clés-exemples) ;
#  - les lockfiles (hashes binaires qui peuvent matcher par hasard).
SELF="scripts/ci/check-no-stripe-live-key.sh"
SELF_TEST="__tests__/scripts/check-no-stripe-live-key.test.ts"

HITS=""
while IFS= read -r file; do
  [ -f "$file" ] || continue
  case "$file" in
    "$SELF"|"$SELF_TEST"|package-lock.json|pnpm-lock.yaml|yarn.lock) continue ;;
  esac
  if MATCH=$(grep -EnI "$LIVE_KEY_PATTERN" "$file" 2>/dev/null); then
    HITS="${HITS}${file}:\n${MATCH}\n"
  fi
done < <(git ls-files)

if [ -n "$HITS" ]; then
  echo "${RED}✗ Clé Stripe LIVE en clair détectée dans un fichier tracké${NC}"
  echo
  printf '%b' "$HITS" | sed 's/^/    /'
  echo
  echo "  Les clés Stripe LIVE ne doivent JAMAIS être committées."
  echo "  Elles vivent uniquement comme secret runtime (wrangler secret put)."
  echo "  Référencer la variable (\${STRIPE_SECRET_KEY}), jamais la valeur."
  echo
  echo "  ${RED}╔════════════════════════════════════════════════════════════╗${NC}"
  echo "  ${RED}║ PUSH REFUSÉ — clé Stripe LIVE en clair dans le repo        ║${NC}"
  echo "  ${RED}╚════════════════════════════════════════════════════════════╝${NC}"
  exit 1
fi

echo "${GREEN}✓ Aucune clé Stripe LIVE en clair — safe${NC}"
exit 0
