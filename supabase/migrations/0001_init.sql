-- ============================================================================
-- Yoga Sculpt — Espace client : schéma initial (Phase 1)
-- Tables : profiles, onboarding_responses
-- RLS activée (chaque user ne voit/modifie QUE ses lignes)
-- Trigger handle_new_user : crée la ligne profiles à l'inscription
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Table : profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id                   uuid primary key references auth.users(id) on delete cascade,
  email                text,
  full_name            text,
  phone                text,
  onboarding_completed boolean not null default false,
  created_at           timestamptz not null default now()
);

comment on table public.profiles is 'Profil utilisateur étendu (1:1 avec auth.users).';

-- ---------------------------------------------------------------------------
-- Table : onboarding_responses
-- ---------------------------------------------------------------------------
create table if not exists public.onboarding_responses (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  goal         text,         -- objectif (renforcement / souplesse / détente / remise en forme)
  level        text,         -- niveau (débutant / intermédiaire / confirmé)
  frequency    text,         -- fréquence souhaitée (1x/sem / 2-3x/sem / plus)
  availability text,         -- disponibilités (matin / midi / soir / week-end / flexible)
  created_at   timestamptz not null default now()
);

comment on table public.onboarding_responses is 'Réponses au questionnaire d''onboarding.';

create index if not exists onboarding_responses_user_id_idx
  on public.onboarding_responses (user_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles             enable row level security;
alter table public.onboarding_responses enable row level security;

-- profiles : un user gère uniquement SA ligne (id = auth.uid())
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- onboarding_responses : un user gère uniquement SES lignes (user_id = auth.uid())
drop policy if exists "onboarding_select_own" on public.onboarding_responses;
create policy "onboarding_select_own"
  on public.onboarding_responses for select
  using (auth.uid() = user_id);

drop policy if exists "onboarding_insert_own" on public.onboarding_responses;
create policy "onboarding_insert_own"
  on public.onboarding_responses for insert
  with check (auth.uid() = user_id);

drop policy if exists "onboarding_update_own" on public.onboarding_responses;
create policy "onboarding_update_own"
  on public.onboarding_responses for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Trigger : crée automatiquement la ligne profiles à l'inscription d'un user
-- SECURITY DEFINER pour pouvoir insérer malgré la RLS.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      null
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
