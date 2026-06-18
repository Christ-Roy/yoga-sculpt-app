#!/usr/bin/env bash
# check-migration-safety.sh — Yoga Sculpt espace client (migrations Supabase SQL)
#
# Garde-fou CI pour migrations destructives. Adapté du hub (Prisma) au layout
# Supabase : on scanne les fichiers `supabase/migrations/*.sql` AJOUTÉS ou
# MODIFIÉS dans le diff.
#
# Bloque (exit 1) si une migration contient un pattern DESTRUCTIF / backward-incompat :
#   1. DROP TABLE              — perte de données irréversible
#   2. DROP COLUMN             — perte de données irréversible
#   3. TRUNCATE                — vide une table
#   4. ALTER TABLE ... DROP …  — drop de contrainte/colonne (ALTER ... DROP)
#   5. ALTER COLUMN ... SET NOT NULL  — échoue si des lignes existantes sont NULL
#   6. ALTER COLUMN ... TYPE          — risque de truncation / cast fail
#   7. RENAME COLUMN / RENAME TO      — backward-incompat (l'ancien code lit l'ancien nom)
#
# NON bloquant (additif ou idempotent, sans perte de données) :
#   - CREATE TABLE / CREATE INDEX / ADD COLUMN / ADD CONSTRAINT
#   - DROP POLICY / DROP INDEX / DROP TRIGGER ... IF EXISTS
#     → pattern courant Supabase : on `drop policy if exists` puis on recrée la
#       policy (réécriture idempotente d'objets de contrôle, AUCUNE donnée perdue).
#       Ce check ne doit donc PAS les bloquer (sinon toute migration RLS casse).
#
# Exception explicite : une ligne destructive précédée d'un commentaire
#   `-- @safe: <raison>` est autorisée (acknowledgement + audit trail).
#
# Usage : ./scripts/ci/check-migration-safety.sh
# Exit 0 si OK ou aucune migration touchée, 1 si pattern destructif non acquitté.
set -euo pipefail

APP_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$APP_ROOT"

RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[1;33m'
BOLD=$'\033[1m'
RESET=$'\033[0m'

BASE_REF="${BASE_REF:-origin/main}"

# Migrations Supabase ajoutées/modifiées dans le diff.
# Mode HEAD → working tree + staged (test local / 1er commit de branche) ;
# sinon → diff vs la base (pre-push / CI). Fallback HEAD~1 si BASE_REF absent.
if [ "$BASE_REF" = "HEAD" ]; then
  mapfile -t CHANGED_MIGRATIONS < <(
    {
      git diff --name-only --diff-filter=AM HEAD -- 'supabase/migrations/*.sql'
      git diff --name-only --cached --diff-filter=AM -- 'supabase/migrations/*.sql'
    } 2>/dev/null | sort -u | grep -v '^$' || true
  )
else
  if ! git rev-parse --verify --quiet "$BASE_REF" >/dev/null 2>&1; then
    BASE_REF="HEAD~1"
  fi
  mapfile -t CHANGED_MIGRATIONS < <(
    git diff --name-only --diff-filter=AM "$BASE_REF"...HEAD -- 'supabase/migrations/*.sql' 2>/dev/null || true
  )
fi

if [ ${#CHANGED_MIGRATIONS[@]} -eq 0 ]; then
  echo "${GREEN}✓ Aucune migration Supabase modifiée — skip migration safety check${RESET}"
  exit 0
fi

echo "${BOLD}Migrations à analyser :${RESET}"
for m in "${CHANGED_MIGRATIONS[@]}"; do
  echo "  - $m"
done
echo

FAIL=0

# Vérifie si la ligne précédant $lineno dans $file est un `-- @safe:`.
is_acknowledged() {
  local file="$1" lineno="$2"
  [ "$lineno" -gt 1 ] || return 1
  local prev
  prev=$(sed -n "$((lineno - 1))p" "$file" 2>/dev/null || echo "")
  echo "$prev" | grep -qE '^[[:space:]]*--[[:space:]]*@safe:'
}

scan_pattern() {
  local pattern="$1" desc="$2" file="$3"
  local matches
  matches=$(grep -inE "$pattern" "$file" 2>/dev/null || true)
  [ -z "$matches" ] && return 0
  while IFS= read -r line; do
    local lineno content
    lineno=$(echo "$line" | cut -d: -f1)
    content=$(echo "$line" | cut -d: -f2-)
    if is_acknowledged "$file" "$lineno"; then
      echo "${YELLOW}⚠ $file:$lineno — $desc (acknowledged via @safe)${RESET}"
      continue
    fi
    FAIL=1
    echo "${RED}✗ $file:$lineno — $desc${RESET}"
    echo "    → $(echo "$content" | sed 's/^[[:space:]]*//')"
  done <<< "$matches"
}

for migration in "${CHANGED_MIGRATIONS[@]}"; do
  [ -f "$migration" ] || continue

  scan_pattern '\bDROP[[:space:]]+TABLE\b'  'DROP TABLE (perte de données irréversible)' "$migration"
  scan_pattern '\bDROP[[:space:]]+COLUMN\b' 'DROP COLUMN (perte de données irréversible)' "$migration"
  scan_pattern '\bTRUNCATE\b'               'TRUNCATE (vide la table)' "$migration"
  scan_pattern '\bRENAME[[:space:]]+COLUMN\b' 'RENAME COLUMN (backward-incompat)' "$migration"
  scan_pattern '\bALTER[[:space:]]+TABLE[[:space:]]+.*[[:space:]]RENAME[[:space:]]+TO\b' 'RENAME TABLE (backward-incompat)' "$migration"
  scan_pattern '\bALTER[[:space:]]+COLUMN[[:space:]]+.*[[:space:]]SET[[:space:]]+NOT[[:space:]]+NULL\b' 'ALTER COLUMN SET NOT NULL (échoue si rows NULL existantes)' "$migration"
  scan_pattern '\bALTER[[:space:]]+COLUMN[[:space:]]+.*[[:space:]]TYPE\b' 'ALTER COLUMN TYPE (risque truncation/cast)' "$migration"

  # ALTER TABLE ... DROP (contrainte/colonne), MAIS pas "DROP" d'autres ALTER
  # additifs. On cible "ALTER TABLE <x> ... DROP " hors "IF EXISTS" sur objet de
  # contrôle. Couvre `ALTER TABLE t DROP CONSTRAINT c`.
  scan_pattern '\bALTER[[:space:]]+TABLE[[:space:]]+.*[[:space:]]DROP[[:space:]]+(CONSTRAINT|COLUMN)\b' 'ALTER TABLE ... DROP (suppression de contrainte/colonne)' "$migration"
done

echo
if [ "$FAIL" -eq 1 ]; then
  echo "${RED}${BOLD}❌ Migration safety check FAILED${RESET}"
  echo
  echo "Patterns ADDITIFS autorisés : CREATE TABLE/INDEX, ADD COLUMN/CONSTRAINT,"
  echo "DROP POLICY/INDEX/TRIGGER ... IF EXISTS (recréation idempotente, 0 perte)."
  echo
  echo "Pour acquitter un pattern destructif (avec justification écrite) :"
  echo "  ${BOLD}-- @safe: <raison du choix>${RESET}"
  echo "  <ligne destructive>"
  echo
  echo "Ex :"
  echo "  -- @safe: colonne 'legacy_field' vide en prod, validé par audit 2026-06-18"
  echo "  ALTER TABLE bookings DROP COLUMN legacy_field;"
  echo
  exit 1
fi

echo "${GREEN}✓ Migration safety check OK${RESET}"
exit 0
