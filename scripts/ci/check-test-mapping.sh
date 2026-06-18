#!/usr/bin/env bash
# check-test-mapping.sh — Yoga Sculpt espace client
#
# Standard CI Veridian (adapté du hub) — règle 1-pour-1 sur les routes API.
# Bloque tout push qui modifie/ajoute une route API critique SANS test associé.
#
# Adaptation à cette app (Next 16 App Router AVEC `src/`, pas de Prisma) :
#   - Scope NUCLEAR (test obligatoire, aucune dette tolérée) :
#       src/app/api/**/route.ts
#   - Convention de chemin canonique :
#       src/app/api/<rel>/route.ts  →  __tests__/api/<rel>.test.ts
#     où <rel> est le chemin après `app/api/` sans `/route.ts`.
#     Pour une route imbriquée (ex. webhooks/stripe), on accepte AUSSI le nom
#     aplati en tirets (`__tests__/api/webhooks-stripe.test.ts`) : c'est la
#     convention de nommage retenue pour cette app (un seul niveau de dossier
#     __tests__/api/, plus lisible). Les deux formes satisfont le check.
#   - Allowlist de dette : `tests-pending.txt` (un chemin source par ligne).
#     Un fichier listé est laissé passer (warning, non bloquant).
#
# Comptage 1-pour-1 (comme le hub) :
#   - chaque nouveau HTTP verb (GET/POST/...) ajouté dans un route.ts doit avoir
#     au moins un nouveau describe() dans son test.
#
# Usage :
#   ./scripts/ci/check-test-mapping.sh
#   BASE_REF=origin/main ./scripts/ci/check-test-mapping.sh   # CI
#   BASE_REF=HEAD ./scripts/ci/check-test-mapping.sh          # working tree
#
set -euo pipefail

BASE_REF="${BASE_REF:-origin/main}"
APP_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$APP_ROOT"

RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[1;33m'
NC=$'\033[0m'

PENDING_FILE="tests-pending.txt"

# ─── Diff Git ────────────────────────────────────────────────────────────────
MODE="committed"
if [ "$BASE_REF" = "HEAD" ]; then
  CHANGED=$( { git diff --name-only HEAD; git diff --cached --name-only; } | sort -u | grep -v '^$' || true)
  MODE="working-tree"
else
  if ! git rev-parse --verify --quiet "$BASE_REF" >/dev/null 2>&1; then
    echo "${YELLOW}⚠ $BASE_REF inaccessible, fallback sur HEAD~1${NC}"
    BASE_REF="HEAD~1"
  fi
  CHANGED=$(git diff --name-only "$BASE_REF"...HEAD 2>/dev/null || true)
fi

if [ -z "$CHANGED" ]; then
  echo "${GREEN}✓ Aucun fichier modifié${NC}"
  exit 0
fi

# ─── Helpers ─────────────────────────────────────────────────────────────────

# Scope NUCLEAR (test obligatoire) : uniquement les routes API.
is_route() {
  case "$1" in
    src/app/api/*/route.ts) return 0 ;;
    *) return 1 ;;
  esac
}

# Test canonique (avec sous-dossiers) attendu pour une route.
expected_test_for() {
  local f="$1"
  local rel="${f#src/app/api/}"
  rel="${rel%/route.ts}"
  echo "__tests__/api/${rel}.test.ts"
}

# Variante aplatie en tirets (slash → tiret) acceptée pour les routes imbriquées.
expected_test_flat_for() {
  local f="$1"
  local rel="${f#src/app/api/}"
  rel="${rel%/route.ts}"
  echo "__tests__/api/${rel//\//-}.test.ts"
}

in_pending() {
  local f="$1"
  [ -f "$PENDING_FILE" ] || return 1
  grep -v '^[[:space:]]*#' "$PENDING_FILE" | grep -v '^[[:space:]]*$' | grep -Fxq "$f"
}

diff_for() {
  local f="$1"
  if [ "$MODE" = "working-tree" ]; then
    git diff HEAD -- "$f" 2>/dev/null
  else
    git diff "$BASE_REF"...HEAD -- "$f" 2>/dev/null
  fi
}

count_new_http_verbs() {
  diff_for "$1" \
    | grep -E '^\+[^+]' \
    | grep -cE '^\+\s*export\s+(async\s+)?(function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b' || true
}

count_new_describes() {
  [ -f "$1" ] || { echo 0; return; }
  diff_for "$1" \
    | grep -E '^\+[^+]' \
    | grep -cE '^\+\s*describe\s*\(' || true
}

# ─── Boucle principale ───────────────────────────────────────────────────────
FAILED=0
WARNINGS=0

for f in $CHANGED; do
  is_route "$f" || continue   # hors scope critique

  # Fichier supprimé → on ne le force pas (le test peut rester ou partir à part).
  [ -f "$f" ] || continue

  if in_pending "$f"; then
    echo "${YELLOW}⏸  $f en dette (tests-pending.txt) — laissé passer${NC}"
    WARNINGS=$((WARNINGS + 1))
    continue
  fi

  canonical="$(expected_test_for "$f")"
  flat="$(expected_test_flat_for "$f")"

  test_file=""
  if [ -f "$canonical" ]; then
    test_file="$canonical"
  elif [ -f "$flat" ]; then
    test_file="$flat"
  fi

  if [ -z "$test_file" ]; then
    echo "${RED}✗ $f modifié sans test correspondant${NC}"
    echo "  Test attendu : $canonical"
    [ "$flat" != "$canonical" ] && echo "  (ou variante aplatie : $flat)"
    echo "  ${RED}🔥 Scope NUCLEAR — aucune dette tolérée sur les routes API.${NC}"
    echo "  Crée le test, ou ajoute le chemin source à tests-pending.txt si dette assumée."
    FAILED=$((FAILED + 1))
    continue
  fi

  # Comptage HTTP verbs vs describe() (seulement utile sur un diff committed).
  if [ "$MODE" != "working-tree" ]; then
    new_verbs=$(count_new_http_verbs "$f")
    new_describes=$(count_new_describes "$test_file")
    if [ "$new_verbs" -gt "$new_describes" ]; then
      echo "${RED}✗ $f : $new_verbs nouveaux HTTP verbs vs $new_describes nouveaux describe()${NC}"
      echo "  Règle : chaque nouveau verb (GET/POST/...) doit avoir son bloc describe('METHOD ...')."
      FAILED=$((FAILED + 1))
      continue
    fi
  fi

  echo "${GREEN}✓ $f → $test_file${NC}"
done

echo
if [ "$FAILED" -gt 0 ]; then
  echo "${RED}╔════════════════════════════════════════════════════════════╗${NC}"
  echo "${RED}║ PUSH REFUSÉ — $FAILED route(s) sans test (règle 1-pour-1)     ║${NC}"
  echo "${RED}╚════════════════════════════════════════════════════════════╝${NC}"
  echo "Fix puis re-tente. JAMAIS --no-verify en usage normal."
  exit 1
fi

if [ "$WARNINGS" -gt 0 ]; then
  echo "${YELLOW}⚠ $WARNINGS fichier(s) en dette tests-pending.txt — à résorber.${NC}"
fi

echo "${GREEN}✓ Mapping route↔test OK${NC}"
exit 0
