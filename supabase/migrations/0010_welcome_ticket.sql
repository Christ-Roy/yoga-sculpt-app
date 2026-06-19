-- ============================================================================
-- Yoga Sculpt — Espace client : TICKET DE BIENVENUE (« 1ère séance offerte »)
--
-- POURQUOI :
--   Depuis le pivot « Essai gratuit » (2026-06-19), le vitrine pousse les
--   visiteurs vers l'app avec la promesse implicite d'une 1ère séance gratuite.
--   On crédite donc 1 ticket `collectif` offert à la 1ère complétion d'onboarding
--   (cf src/lib/welcome-ticket.ts). Cette migration pose les garde-fous SCHÉMA.
--
--   ⚠️ Revient sur la décision du 2026-06-18 (« PAS de ticket de bienvenue
--   auto »), antérieure au pivot — re-tranchée par Robert le 2026-06-19.
--
-- ADDITIF UNIQUEMENT — aucune perte de données, aucun backward-incompat :
--   1. tickets.source              : trace l'origine d'un ticket (welcome / referral
--                                    / paid / admin). Nullable (les lignes existantes
--                                    restent NULL ; le code n'en dépend pas pour
--                                    calculer le solde — il agrège par `type`).
--   2. index unique partiel        : 1 SEUL ticket `source='welcome'` par compte,
--                                    JAMAIS deux (anti-rejeu strict au niveau DB,
--                                    même en cas de course / double appel).
--   3. profiles.welcome_ticket_granted_at : flag rapide « bienvenue déjà accordée »
--                                    (lecture cheap, sans scan de tickets).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) tickets.source — origine du ticket (traçabilité + filtrage anti-rejeu).
--    NULL toléré : les tickets historiques (Stripe / parrainage / admin) n'ont
--    pas cette colonne. Le nouveau code la renseigne ('welcome', etc.).
-- ---------------------------------------------------------------------------
alter table public.tickets
  add column if not exists source text;

comment on column public.tickets.source is
  'Origine du ticket : welcome (1ère séance offerte), referral (parrainage), paid (Stripe), admin (ajustement). NULL = historique.';

-- ---------------------------------------------------------------------------
-- 2) Anti-rejeu STRICT : un seul ticket de bienvenue par compte, garanti par la
--    base elle-même. Index UNIQUE PARTIEL (n'indexe que les lignes 'welcome') :
--    une 2e tentative d'insert 'welcome' pour le même user_id échoue (23505),
--    quelle que soit la course applicative.
-- ---------------------------------------------------------------------------
create unique index if not exists tickets_welcome_once_uidx
  on public.tickets (user_id)
  where source = 'welcome';

-- ---------------------------------------------------------------------------
-- 3) profiles.welcome_ticket_granted_at — flag rapide (ISO timestamp d'octroi).
--    Garde d'idempotence côté application (lecture cheap), doublée par l'index
--    unique ci-dessus (garde DB). NULL = pas encore accordé.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists welcome_ticket_granted_at timestamptz;

comment on column public.profiles.welcome_ticket_granted_at is
  'Horodatage de l''octroi du ticket de bienvenue (« 1ère séance offerte »). NULL = jamais accordé. Garde d''idempotence.';
