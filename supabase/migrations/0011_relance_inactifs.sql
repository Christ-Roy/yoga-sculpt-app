-- ============================================================================
-- Yoga Sculpt — Espace client : RELANCE AUTOMATIQUE DES INACTIFS (rétention)
--
-- POURQUOI :
--   Pour une prof solo, réactiver un inscrit/client dormant coûte ~0 € et
--   rapporte plus que d'acquérir un froid. Ce cron (réutilise le Cloudflare Cron
--   Trigger + Brevo déjà en place) relance par email 3 segments d'inactifs :
--     1. inscrit jamais réservé        (compte créé > X j, 0 booking)
--     2. dormant                       (avait des résas, aucune depuis > Y j,
--                                        aucune à venir)
--     3. ticket dormant                (séances en solde, aucune résa à venir)
--   ⚠️ Ne recoupe PAS les rappels J-1/H-2 (ceux-ci = AVANT un cours réservé).
--      Ici c'est l'inverse : relancer ceux qui n'ont RIEN de prévu.
--
-- IDEMPOTENCE / ANTI-SPAM :
--   3 colonnes d'horodatage sur `profiles` (une par segment). Le scan ne relance
--   un user pour un segment QUE si sa colonne est NULL ou antérieure à la fenêtre
--   d'anti-rejeu (cf. constante RELANCE_COOLDOWN_MS dans src/lib/relance.ts).
--   Une fois l'email parti, la colonne est horodatée → pas de re-spam au prochain
--   tick. Garde-fou volume : privilégier la pertinence à la fréquence.
--
-- TRACKING :
--   Nouvel event `reactivation_sent` dans le journal user_events (segment +
--   contexte en metadata). Ajouté au CHECK extensible (migration additive).
--
-- Migration ADDITIVE et idempotente (`if not exists`, recréation du CHECK) :
--   pas de réécriture, pas de perte de données, rejouable sans risque.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Colonnes d'anti-rejeu sur profiles (une par segment de relance).
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists relance_jamais_reserve_sent_at  timestamptz,
  add column if not exists relance_dormant_sent_at         timestamptz,
  add column if not exists relance_ticket_dormant_sent_at  timestamptz;

comment on column public.profiles.relance_jamais_reserve_sent_at is
  'Horodatage de la dernière relance "inscrit jamais réservé". NULL = jamais relancé. Anti-spam : 1 relance / fenêtre / segment (cf. src/lib/relance.ts).';
comment on column public.profiles.relance_dormant_sent_at is
  'Horodatage de la dernière relance "client dormant" (avait des résas, plus aucune). NULL = jamais relancé.';
comment on column public.profiles.relance_ticket_dormant_sent_at is
  'Horodatage de la dernière relance "ticket/carte dormant" (séances en solde, aucune résa à venir). NULL = jamais relancé.';

-- ---------------------------------------------------------------------------
-- Étendre le CHECK des types d'événements pour journaliser les relances.
-- On DROP/ADD le CHECK (Postgres ne sait pas "modifier" un check en place).
-- Idempotent : on droppe le contrainte par son nom puis on la recrée.
-- ---------------------------------------------------------------------------
alter table public.user_events
  drop constraint if exists user_events_type_check;

alter table public.user_events
  add constraint user_events_type_check check (event_type in (
    'signup',
    'onboarding_completed',
    'checkout_started',
    'checkout_completed',
    'checkout_abandoned',
    'ticket_acquired',
    'referral_invited',
    'referral_signup',
    'referral_credited',
    'referral_blocked',
    'booking_created',
    'booking_cancelled',
    'booking_attended',
    'reactivation_sent'
  ));
