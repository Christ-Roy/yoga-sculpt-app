-- ============================================================================
-- Yoga Sculpt — Espace client : anti-chevauchement du COURS PARTICULIER LIBRE.
--
-- Décision Robert 2026-06-19 : le cours particulier devient un créneau LIBRE
-- (le client choisit n'importe quelle heure pleine 9h-21h, hors indisponibilités
-- d'Alice). On CRÉE alors un event dédié dans l'agenda d'Alice. Deux clients ne
-- doivent JAMAIS réserver le même horaire (Alice = ressource unique).
--
-- L'index unique partiel existant (0002) protège le COLLECTIF :
--   bookings_no_double_creneau_uidx (user_id, google_calendar_creneau_id)
--   where status='confirmed' and google_calendar_creneau_id is not null
-- → ne couvre PAS le particulier libre (google_calendar_creneau_id IS NULL).
--
-- On ajoute donc un verrou DB sur l'HORAIRE du particulier : un seul booking
-- particulier confirmé par `starts_at`. C'est l'INSERT du booking qui pose le
-- verrou (avant toute écriture Google) : un 2e client sur le même horaire tombe
-- sur une violation d'unicité (23505) → la route renvoie 409 proprement.
--
-- Migration STRICTEMENT ADDITIVE — aucune perte de données, aucune colonne ni
-- contrainte supprimée. `create index if not exists` → ré-exécution idempotente.
--
-- ⚠️ Numérotation : 0009 (suite de 0008_booking_attendance). Si un autre 0009
--    était déjà posé en parallèle, renuméroter ce seul fichier (additif →
--    re-jouable sans risque).
-- ============================================================================

-- Anti-chevauchement PARTICULIER LIBRE : au plus 1 résa particulière confirmée
-- par horaire de début. Partiel (type='particulier' & confirmed) pour ne PAS
-- gêner le collectif (plusieurs inscrits possibles sur le même starts_at) ni les
-- résas annulées (status='cancelled' → l'horaire redevient réservable).
create unique index if not exists bookings_particulier_starts_at_uidx
  on public.bookings (starts_at)
  where status = 'confirmed' and type = 'particulier';

comment on index public.bookings_particulier_starts_at_uidx is
  'Anti-chevauchement du cours particulier en créneau libre : 1 seule résa particulière confirmée par horaire (Alice = ressource unique). Voir /api/reserver mode B.';
