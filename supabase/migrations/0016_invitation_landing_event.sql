-- 0016_invitation_landing_event.sql — Yoga Sculpt espace client
--
-- Étend le CHECK des types d'événements (`user_events_type_check`) pour
-- journaliser l'arrivée d'un filleul sur la landing d'invitation
-- `/invitation?ref=<CODE>` (event `invitation_landing_view`, cf. union TS
-- `EventType` dans src/lib/events.ts).
--
-- Migration ADDITIVE et idempotente : on DROP puis ADD le CHECK (Postgres ne
-- sait pas modifier un check en place). On reprend la liste COMPLÈTE des valeurs
-- déjà autorisées (0006 + 0011) et on y ajoute `invitation_landing_view`.
--
-- Ce type d'event est PUREMENT du tracking d'acquisition (combien de filleuls
-- atterrissent sur la landing) : il ne crédite RIEN, ne contient aucune PII
-- (metadata = { code } sanitisé uniquement).

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
    'reactivation_sent',
    'invitation_landing_view'
  ));
