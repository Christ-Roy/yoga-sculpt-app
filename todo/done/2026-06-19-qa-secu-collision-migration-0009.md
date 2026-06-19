# [P2] QA sécu — Collision de numérotation des migrations (deux 0009 + saut à 0011)

**Statut** : à corriger avant merge · **Qui** : agent · **Source** : QA sécu 2026-06-19 (intégrité déploiement)

## Problème
Deux fichiers `0009` DIFFÉRENTS existent sur deux branches non mergées :
- `/tmp/wt-ticket-bienvenue/supabase/migrations/0009_welcome_ticket.sql`
- `/tmp/wt-resa-libre/supabase/migrations/0009_booking_particulier_libre.sql`

Et la branche relance saute à `0011` (`/tmp/wt-relance-inactifs/.../0011_relance_inactifs.sql`) — pas de `0010` vu.

## Risque
Selon l'outil de migration (ordre lexicographique du nom de fichier), au merge des deux branches **une seule des deux `0009` pourrait être appliquée**, ou l'ordre devenir ambigu → une feature part en prod **sans son schéma** (ticket bienvenue OU anti-chevauchement particulier libre). Pas une perte de données (les deux fichiers sont strictement additifs + idempotents `if not exists`), mais une feature cassée silencieusement.

Note : les deux fichiers signalent eux-mêmes le risque en commentaire ("si un autre 0009 était déjà posé, renuméroter").

## Correctif
Au merge : renuméroter en séquence stricte sans trou, p.ex.
- `0009_welcome_ticket.sql` → garder 0009
- `0009_booking_particulier_libre.sql` → `0010_...`
- `0011_relance_inactifs.sql` → `0011_...` (ou 0012 selon l'ordre retenu, sans trou)

Vérifier que `scripts/ci/check-migration-safety.sh` (présent sur la branche bypass) ou un nouveau check rejette deux migrations au même préfixe numérique. C'est un garde-fou CI naturel à ajouter.

## Fichiers
`/tmp/wt-ticket-bienvenue/supabase/migrations/0009_welcome_ticket.sql`, `/tmp/wt-resa-libre/supabase/migrations/0009_booking_particulier_libre.sql`, `/tmp/wt-relance-inactifs/supabase/migrations/0011_relance_inactifs.sql`.
