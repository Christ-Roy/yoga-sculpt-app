-- ---------------------------------------------------------------------------
-- Yoga Sculpt — Attribution Google Ads (server-side, valeur composée)
-- ---------------------------------------------------------------------------
-- Objectif (cf todo 2026-06-19-attribution-ads-server-side-valeur-composee) :
--   remonter à Google Ads la VRAIE valeur d'un user venu de l'Ads, attribuée au
--   gclid d'origine — paiement Stripe + valeur de ses filleuls + ticket gratuit
--   CONSOMMÉ (~10€). Cette migration pose 2 briques :
--     1. de quoi STOCKER le gclid sur le user (capté sur la vitrine, propagé ici).
--     2. un journal d'idempotence des conversions uploadées (jamais 2× la même).
--
-- Écritures via service_role uniquement (webhook Stripe, callback auth, crédit
-- parrainage) — comme account_signals / user_events. RLS sans policy ouverte.
-- ---------------------------------------------------------------------------

-- ── 1. gclid d'origine sur le profil (first-touch) ─────────────────────────
-- Le gclid est capté sur la vitrine (cookie ys_gclid Domain=.yoga-sculpt.fr) et
-- rangé ici à la 1re session (callback auth). first-touch : on ne l'écrase pas.
alter table public.profiles
  add column if not exists gclid              text,
  add column if not exists gbraid             text,
  add column if not exists wbraid             text,
  add column if not exists ad_landing         text,
  add column if not exists ad_clicked_at      timestamptz,
  add column if not exists gclid_captured_at  timestamptz;

comment on column public.profiles.gclid is
  'Identifiant de clic Google Ads capté sur la vitrine (first-touch). Sert à attribuer paiements + valeur parrainage côté serveur. NULL = user non venu de l''Ads.';

-- Index partiel : on ne requête que les profils QUI ont un gclid (upload conv).
create index if not exists profiles_gclid_idx
  on public.profiles (gclid)
  where gclid is not null;

-- ── 2. Journal d'idempotence des conversions uploadées à Google Ads ────────
-- Une conversion ne doit JAMAIS être uploadée 2× (rejeu webhook, re-crédit
-- parrainage, double consommation ticket). UNIQUE(kind, source_ref) = garde-fou.
do $$ begin
  create type public.ads_conversion_kind as enum (
    'purchase',         -- paiement Stripe (value = montant payé)
    'referral_value',   -- valeur générée par un filleul, attribuée au gclid du PARRAIN
    'free_ticket_used'  -- ticket gratuit (welcome/referral) CONSOMMÉ en réservation (~10€)
  );
exception when duplicate_object then null; end $$;

create table if not exists public.ads_conversions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  kind          public.ads_conversion_kind not null,
  -- réf de la source métier qui a déclenché la conversion (dédup) :
  --   purchase        → stripe_session_id
  --   referral_value  → referral_id
  --   free_ticket_used→ booking_id
  source_ref    text not null,
  gclid         text,                 -- gclid utilisé pour l'upload (du user OU du parrain)
  value_eur     numeric(10,2) not null default 0,
  -- état de l'upload vers Google Ads (l'écriture DB est synchrone, l'upload non) :
  uploaded      boolean not null default false,
  uploaded_at   timestamptz,
  upload_error  text,
  created_at    timestamptz not null default now(),
  -- idempotence : une même source métier ne crée qu'UNE conversion de ce kind.
  unique (kind, source_ref)
);

comment on table public.ads_conversions is
  'Journal des conversions de valeur uploadées à Google Ads (idempotent sur kind+source_ref). Écrit par webhook Stripe / crédit parrainage / consommation ticket. service_role only.';

create index if not exists ads_conversions_pending_idx
  on public.ads_conversions (uploaded, created_at)
  where uploaded = false;

-- RLS : table interne, AUCUNE policy → seul service_role (bypass RLS) écrit/lit.
alter table public.ads_conversions enable row level security;
