-- ============================================================================
-- Yoga Sculpt — Espace client : SIGNAUX ANTI-ABUS du parrainage (V2b)
-- Table : account_signals
--
-- POURQUOI :
--   L'anti-abus parrainage (src/lib/anti-abuse.ts → canCreditReferral) doit
--   pouvoir détecter qu'un « filleul » est en réalité un faux compte créé par
--   le parrain pour s'auto-créditer. On enregistre donc, à l'inscription, des
--   signaux de provenance :
--     - ip_creation       : IP du client lors de la création du compte
--                           (CF-Connecting-IP, captée dans /auth/callback).
--     - device_fingerprint : empreinte d'appareil hashée (SHA-256) ; les
--                           composantes (canvas/fonts/UA…) sont collectées
--                           CÔTÉ CLIENT par l'agent UI, puis hashées côté
--                           serveur (src/lib/fingerprint.ts). Renseignée via
--                           POST /api/parrainage/completer (le callback OAuth
--                           est un redirect serveur, sans JS client).
--   Si un AUTRE compte partage la même ip_creation OU le même
--   device_fingerprint → on refuse SILENCIEUSEMENT le crédit de parrainage.
--
--   ⚠️ Pas de MAC (techniquement impossible côté web). IP + email + fingerprint
--   uniquement.
--
-- MODÈLE :
--   Table dédiée (1 ligne par user, PK = user_id) plutôt que des colonnes sur
--   `profiles` : isole les données de provenance (sensibles) et garde profiles
--   propre. Écritures via la service_role uniquement.
-- ============================================================================

create table if not exists public.account_signals (
  -- 1:1 avec auth.users ; un seul jeu de signaux par compte (celui de la
  -- création). PK = user_id rend l'upsert trivial et empêche les doublons.
  user_id            uuid primary key references auth.users(id) on delete cascade,
  -- IP de création (type natif `inet`). Anti-abus : doublon d'IP = suspect.
  ip_creation        inet,
  -- Empreinte d'appareil SHA-256 (hex). Anti-abus : doublon = suspect.
  device_fingerprint text,
  signup_at          timestamptz not null default now()
);

comment on table public.account_signals is
  'Signaux de provenance (IP + fingerprint) captés à l''inscription, pour l''anti-abus du parrainage. Écritures via service_role.';

-- Détection des doublons d'IP entre comptes (cœur de l'anti-abus).
create index if not exists account_signals_ip_idx
  on public.account_signals (ip_creation);

-- Détection des doublons de fingerprint entre comptes.
create index if not exists account_signals_fingerprint_idx
  on public.account_signals (device_fingerprint);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- RLS activée SANS aucune policy : ces signaux ne doivent JAMAIS être lisibles
-- ni modifiables par un client (un attaquant ne doit pas pouvoir sonder « est-ce
-- que mon IP est déjà connue ? »). Seule la service_role (bypass RLS) y accède.
alter table public.account_signals enable row level security;
