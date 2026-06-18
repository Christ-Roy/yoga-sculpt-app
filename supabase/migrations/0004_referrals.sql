-- ============================================================================
-- Yoga Sculpt — Espace client : système de PARRAINAGE (V2b)
-- Table : referrals
--
-- MÉCANIQUE (décision Robert) :
--   Le SEUL levier gratuit est le parrainage. Un membre (le PARRAIN) dispose
--   d'un code unique. Quand un nouvel inscrit (le FILLEUL) crée son compte en
--   ayant suivi ce code, et que les contrôles anti-abus passent (cf 0005 +
--   src/lib/anti-abuse.ts), on crédite 1 ticket au PARRAIN.
--
--   ⚠️ Le crédit est SILENCIEUX en cas d'abus : si l'anti-abus refuse, le
--   referral reste 'pending', aucun ticket n'est créé, et AUCUN message ne
--   révèle la raison (ni au parrain ni au filleul). Voir canCreditReferral().
--
-- MODÈLE D'ÉCRITURE :
--   Les ÉCRITURES (création d'un referral pending, passage en 'completed',
--   crédit du ticket) passent par la `service_role` côté serveur (bypass RLS).
--   Le parrain a seulement le droit de LIRE ses propres referrals (suivi des
--   filleuls dans /espace/parrainer).
-- ============================================================================

create table if not exists public.referrals (
  id              uuid primary key default gen_random_uuid(),
  -- Le parrain (membre existant) à qui revient le crédit.
  parrain_user_id uuid not null references auth.users(id) on delete cascade,
  -- E-mail du filleul invité (renseigné dès l'invitation, normalisé en minuscules).
  filleul_email   text not null,
  -- Renseigné quand le filleul a effectivement créé son compte (sinon NULL).
  filleul_user_id uuid references auth.users(id) on delete set null,
  -- Code de parrainage utilisé = le code unique du PARRAIN (dénormalisé ici
  -- pour la traçabilité même si le parrain régénère un jour son code).
  code            text not null,
  -- 'pending'   : invitation envoyée / filleul pas encore (validé) crédité.
  -- 'completed' : filleul inscrit ET ticket crédité au parrain.
  status          text not null default 'pending',
  -- True dès qu'un ticket a été crédité au parrain pour CE referral (garde-fou
  -- d'idempotence : on ne crédite jamais deux fois le même referral).
  ticket_credite  boolean not null default false,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz,
  constraint referrals_status_check
    check (status in ('pending', 'completed'))
);

comment on table public.referrals is
  'Parrainages Yoga Sculpt. 1 ticket crédité au parrain quand un filleul s''inscrit (sous réserve anti-abus). Écritures via service_role.';

-- Lookup par code (résolution du parrain à l'inscription du filleul).
create index if not exists referrals_code_idx
  on public.referrals (code);

-- Liste des filleuls d'un parrain (page /espace/parrainer).
create index if not exists referrals_parrain_idx
  on public.referrals (parrain_user_id);

-- Recherche d'un referral pending par e-mail filleul (matching à l'inscription).
create index if not exists referrals_filleul_email_idx
  on public.referrals (filleul_email);

-- Anti-doublon d'invitation : un parrain n'invite pas 2× le même e-mail (tant
-- que le referral n'est pas annulé). On garde une unicité par (parrain, email).
create unique index if not exists referrals_parrain_email_uidx
  on public.referrals (parrain_user_id, filleul_email);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.referrals enable row level security;

-- Le parrain LIT uniquement SES referrals (suivi de ses filleuls).
-- Aucune policy insert/update/delete côté user : tout est écrit par le serveur
-- via la service_role (le parrain ne peut pas se créditer lui-même un ticket).
drop policy if exists "referrals_select_own" on public.referrals;
create policy "referrals_select_own"
  on public.referrals for select
  using (auth.uid() = parrain_user_id);

-- ---------------------------------------------------------------------------
-- Code de parrainage du parrain
-- ---------------------------------------------------------------------------
-- Le code unique d'un user est stocké sur son profil (colonne additive) : il
-- est généré paresseusement par GET /api/parrainage la 1re fois qu'il en a
-- besoin, puis stable. On garantit l'unicité au niveau base.
alter table public.profiles
  add column if not exists referral_code text;

comment on column public.profiles.referral_code is
  'Code de parrainage unique du membre (généré à la 1re visite de /espace/parrainer). Sert de `referrals.code`.';

create unique index if not exists profiles_referral_code_uidx
  on public.profiles (referral_code)
  where referral_code is not null;
