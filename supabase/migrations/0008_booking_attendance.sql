-- ============================================================================
-- Yoga Sculpt — Espace client : présence (présent / absent) sur les bookings.
--
-- Back-office « Gestion des réservations » (Alice) : après une séance, Alice
-- marque chaque inscrit présent ou absent (no-show). Migration STRICTEMENT
-- ADDITIVE — aucune perte de données, aucune colonne/contrainte supprimée.
--
-- ⚠️ Réconciliation multi-agents : ce numéro 0008 a été pris en accord avec la
--    répartition team-lead (tracking ≈ 0006, calendrier ≈ 0007, réservations =
--    0008). Si un autre numéro était déjà posé, renuméroter ce seul fichier
--    (additif → re-jouable sans risque).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Colonne `attendance` sur bookings.
--   NULL        → présence non encore renseignée (état par défaut / à venir).
--   'attended'  → la cliente est venue (présente).
--   'no_show'   → la cliente ne s'est pas présentée (absente).
--
-- On modélise la présence comme un état NULLABLE (pas de DEFAULT 'pending') :
-- l'absence d'info doit rester distincte d'une décision explicite d'Alice. Une
-- séance future, ou passée non encore pointée, a `attendance = NULL`.
--
-- `add column if not exists` → ré-exécution idempotente sans erreur.
-- ---------------------------------------------------------------------------
alter table public.bookings
  add column if not exists attendance text;

-- Horodatage du pointage (qui sert d'audit : quand la présence a été marquée).
-- NULL tant qu'aucun pointage n'a eu lieu.
alter table public.bookings
  add column if not exists attendance_marked_at timestamptz;

-- Contrainte de domaine sur les valeurs autorisées. Tolère NULL (présence non
-- renseignée). `if not exists` côté `add constraint` n'existe pas en PG → on
-- garde un nom stable et on l'ajoute via un bloc conditionnel idempotent.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bookings_attendance_check'
  ) then
    alter table public.bookings
      add constraint bookings_attendance_check
      check (attendance is null or attendance in ('attended', 'no_show'));
  end if;
end$$;

comment on column public.bookings.attendance is
  'Présence à la séance : NULL (non renseigné) | attended (présent) | no_show (absent). Pointé par Alice depuis le back-office, via la service_role.';

comment on column public.bookings.attendance_marked_at is
  'Horodatage du dernier pointage de présence (audit). NULL si jamais pointé.';

-- Index partiel sur les bookings pointés (lookup des stats présence/no-show).
-- Partiel (where not null) : on n'indexe pas la masse des bookings non pointés.
create index if not exists bookings_attendance_idx
  on public.bookings (attendance)
  where attendance is not null;
