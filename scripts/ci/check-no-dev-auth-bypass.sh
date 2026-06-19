#!/usr/bin/env bash
# check-no-dev-auth-bypass.sh — Yoga Sculpt espace client
#
# Filet de sécurité CRITIQUE : le bypass d'auth de DEV (cf src/lib/dev-auth.ts)
# ne doit JAMAIS pouvoir s'activer ailleurs qu'en local. Il est gardé au runtime
# par une garde combinée (NEXT_PUBLIC_DEV_AUTH_BYPASS=1 ET NODE_ENV!=production),
# mais on ajoute ce filet statique anti-déploiement-accidentel : AUCUN fichier
# tracké ne doit contenir l'activation `NEXT_PUBLIC_DEV_AUTH_BYPASS=1`.
#
# Pourquoi : la var ne vit QUE dans le `.env.local` du dev (gitignored). Si elle
# se retrouvait committée dans .env.example, wrangler.jsonc, un workflow CI, un
# compose, etc., un build/déploiement risquerait d'embarquer l'intention "=1".
# (La garde NODE_ENV neutralise quand même le bypass en prod — mais on ne se
#  repose pas dessus seul : défense en profondeur.)
#
# On vise une VRAIE activation (assignation de config/env), pas une simple
# mention en prose. Le motif n'accepte donc la var QU'EN DÉBUT DE LIGNE (après
# d'éventuels espaces d'indentation, ou un guillemet de clé JSON) — ce qui exclut
# les commentaires (`# ...`, `* ...`, `// ...`) et les mentions inline en prose.
# Formes couvertes :
#   - `.env`     : `NEXT_PUBLIC_DEV_AUTH_BYPASS=1`
#   - JSON/yaml  : `"NEXT_PUBLIC_DEV_AUTH_BYPASS": "1"`  (wrangler.jsonc, workflows)
#
# Périmètre : fichiers trackés, SAUF :
#   - ce script (le motif figure dans sa doc),
#   - `__tests__/**` : les tests de la garde utilisent légitimement la chaîne "1"
#     comme valeur d'objet — ce n'est PAS de la config déployée,
#   - les lockfiles binaires.
#
# Usage : ./scripts/ci/check-no-dev-auth-bypass.sh
# Exit 1 si une activation du bypass est trouvée dans un fichier tracké.
set -euo pipefail

APP_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$APP_ROOT"

RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
NC=$'\033[0m'

# Var ancrée en début de ligne (indent ou guillemet de clé JSON tolérés), puis
# séparateur =/:, espaces/guillemets optionnels, puis la valeur 1.
BYPASS_PATTERN='^[[:space:]]*"?NEXT_PUBLIC_DEV_AUTH_BYPASS"?[[:space:]]*[=:][[:space:]]*"?1"?'

SELF="scripts/ci/check-no-dev-auth-bypass.sh"

HITS=""
while IFS= read -r file; do
  [ -f "$file" ] || continue
  case "$file" in
    "$SELF"|__tests__/*|package-lock.json|pnpm-lock.yaml|yarn.lock) continue ;;
  esac
  if MATCH=$(grep -EnI "$BYPASS_PATTERN" "$file" 2>/dev/null); then
    HITS="${HITS}${file}:\n${MATCH}\n"
  fi
done < <(git ls-files)

if [ -n "$HITS" ]; then
  echo "${RED}✗ Activation du bypass d'auth DEV détectée dans un fichier tracké${NC}"
  echo
  printf '%b' "$HITS" | sed 's/^/    /'
  echo
  echo "  NEXT_PUBLIC_DEV_AUTH_BYPASS=1 ne doit JAMAIS être committé."
  echo "  C'est un toggle DEV LOCAL — il vit uniquement dans .env.local (gitignored)."
  echo "  Le committer risque d'embarquer le bypass dans un build/déploiement."
  echo
  echo "  ${RED}╔════════════════════════════════════════════════════════════╗${NC}"
  echo "  ${RED}║ PUSH REFUSÉ — bypass d'auth DEV activé dans le repo        ║${NC}"
  echo "  ${RED}╚════════════════════════════════════════════════════════════╝${NC}"
  exit 1
fi

echo "${GREEN}✓ Aucune activation du bypass d'auth DEV committée — safe${NC}"
exit 0
