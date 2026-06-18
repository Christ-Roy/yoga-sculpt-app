-- ============================================================================
-- Yoga Sculpt — Espace client : rappels mail automatiques (J-1 / H-2)
--
-- Ajoute deux colonnes d'horodatage sur `bookings` pour rendre l'envoi des
-- rappels IDEMPOTENT : une fois un rappel envoyé, sa colonne est renseignée et
-- le scan (Cloudflare Cron Trigger toutes les 15 min) ne le renverra jamais.
--
-- Migration ADDITIVE et idempotente (`if not exists`) : pas de réécriture, pas
-- de perte de données, rejouable sans risque.
-- ============================================================================

alter table public.bookings
  add column if not exists reminder_j1_sent_at timestamptz,
  add column if not exists reminder_h2_sent_at timestamptz;

comment on column public.bookings.reminder_j1_sent_at is
  'Horodatage d''envoi du rappel J-1 (24h avant). NULL = pas encore envoyé. Garantit l''idempotence du cron de rappels.';

comment on column public.bookings.reminder_h2_sent_at is
  'Horodatage d''envoi du rappel H-2 (2h avant). NULL = pas encore envoyé. Garantit l''idempotence du cron de rappels.';
