-- ============================================================================
-- Yoga Sculpt — Espace client : moteur de réservation maison (remplace Cal.com)
-- Tables : tickets (carnets de séances achetés via Stripe), bookings (résas)
-- RLS activée (chaque user ne voit/insère QUE ses lignes)
--
-- IMPORTANT — modèle d'écriture :
--   Les ÉCRITURES réelles (décrément de ticket, création/annulation de booking,
--   recrédit à l'annulation) passent par le MOTEUR DE RÉSA CÔTÉ SERVEUR, qui
--   utilise la `service_role` Supabase et BYPASS donc la RLS. Les policies user
--   ci-dessous sont volontairement minimales : elles servent la lecture par le
--   client (l'utilisateur voit SES tickets / SES résas) et un garde-fou en
--   insert, mais ce n'est pas le client qui décrémente les crédits.
--
--   Dashboard ALICE : Alice doit voir TOUTES les réservations. On ne crée PAS
--   de policy spéciale fragile (rôle/claim custom) pour ça — le dashboard lit la
--   table via la `service_role` côté serveur (bypass RLS). C'est le pattern propre.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Table : tickets
-- Crédits achetés par l'utilisateur via Stripe (carnet de séances).
-- On décrémente `quantite_restante` à chaque réservation (côté serveur).
-- ---------------------------------------------------------------------------
create table if not exists public.tickets (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  type                text not null,        -- 'collectif' | 'particulier'
  quantite_initiale   int not null,         -- nb de séances dans le carnet acheté
  quantite_restante   int not null,         -- décrémenté à chaque résa
  stripe_payment_id   text,                 -- Checkout Session / PaymentIntent (traçabilité), nullable
  stripe_session_id   text,                 -- pour matcher le webhook Stripe (idempotence), nullable
  expires_at          timestamptz,          -- NULL = pas d'expiration (ex. carte 10 séances valable 4 mois)
  created_at          timestamptz not null default now(),
  constraint tickets_type_check
    check (type in ('collectif', 'particulier')),
  constraint tickets_quantite_restante_check
    check (quantite_restante >= 0),
  constraint tickets_quantite_initiale_check
    check (quantite_initiale > 0),
  constraint tickets_quantite_restante_lte_initiale_check
    check (quantite_restante <= quantite_initiale)
);

comment on table public.tickets is
  'Carnets de séances achetés via Stripe. quantite_restante est décrémentée à la résa (par le serveur / service_role).';

create index if not exists tickets_user_id_idx
  on public.tickets (user_id);

-- Idempotence du webhook Stripe : une même session ne crée jamais 2 tickets.
-- Index UNIQUE PARTIEL (only where not null) car stripe_session_id est nullable.
create unique index if not exists tickets_stripe_session_id_uidx
  on public.tickets (stripe_session_id)
  where stripe_session_id is not null;

-- ---------------------------------------------------------------------------
-- Table : bookings
-- Réservations effectives, liées à un event Google Calendar.
-- ---------------------------------------------------------------------------
create table if not exists public.bookings (
  id                          uuid primary key default gen_random_uuid(),
  user_id                     uuid not null references auth.users(id) on delete cascade,
  type                        text not null,                 -- 'collectif' | 'particulier'
  google_event_id             text not null,                 -- id de l'event créé dans Google Calendar
  google_calendar_creneau_id  text,                          -- id du créneau source réservé (posé par Alice) ; null pour le particulier
  starts_at                   timestamptz not null,
  ends_at                     timestamptz not null,
  status                      text not null default 'confirmed',  -- 'confirmed' | 'cancelled'
  ticket_id                   uuid references public.tickets(id), -- ticket consommé (recrédit à l'annulation), nullable
  created_at                  timestamptz not null default now(),
  cancelled_at                timestamptz,
  constraint bookings_type_check
    check (type in ('collectif', 'particulier')),
  constraint bookings_status_check
    check (status in ('confirmed', 'cancelled'))
);

comment on table public.bookings is
  'Réservations effectives (1 event Google Calendar chacune). Écritures via le serveur / service_role.';

create index if not exists bookings_user_id_idx
  on public.bookings (user_id);

create index if not exists bookings_starts_at_idx
  on public.bookings (starts_at);

-- Index sur la FK ticket_id (lookup pour recrédit à l'annulation).
create index if not exists bookings_ticket_id_idx
  on public.bookings (ticket_id);

-- Anti-double-booking : un même user ne réserve pas 2× le même créneau collectif.
-- UNIQUE PARTIEL : ne s'applique qu'aux résas confirmées ayant un créneau source.
-- Une résa annulée (status='cancelled') ne bloque plus le créneau (re-réservation OK).
create unique index if not exists bookings_no_double_creneau_uidx
  on public.bookings (user_id, google_calendar_creneau_id)
  where status = 'confirmed' and google_calendar_creneau_id is not null;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.tickets  enable row level security;
alter table public.bookings enable row level security;

-- tickets : un user voit/insère uniquement SES tickets (user_id = auth.uid()).
-- PAS de policy update/delete côté user : le décrément de quantite_restante se
-- fait via la service_role (moteur de résa serveur, bypass RLS), JAMAIS par le
-- client — sinon un user pourrait recréditer son propre carnet.
drop policy if exists "tickets_select_own" on public.tickets;
create policy "tickets_select_own"
  on public.tickets for select
  using (auth.uid() = user_id);

drop policy if exists "tickets_insert_own" on public.tickets;
create policy "tickets_insert_own"
  on public.tickets for insert
  with check (auth.uid() = user_id);

-- bookings : un user voit/insère uniquement SES résas. Update (annulation)
-- limité aux siennes. NB : en pratique les écritures passent par la service_role
-- (création de l'event Google Calendar + décrément du ticket dans la même
-- transaction serveur) ; ces policies sont le garde-fou côté client.
drop policy if exists "bookings_select_own" on public.bookings;
create policy "bookings_select_own"
  on public.bookings for select
  using (auth.uid() = user_id);

drop policy if exists "bookings_insert_own" on public.bookings;
create policy "bookings_insert_own"
  on public.bookings for insert
  with check (auth.uid() = user_id);

drop policy if exists "bookings_update_own" on public.bookings;
create policy "bookings_update_own"
  on public.bookings for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
