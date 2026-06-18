-- ============================================================================
-- Yoga Sculpt — Espace client : PRESETS de créneaux (admin)
-- Table : slot_presets
--
-- POURQUOI :
--   La source de vérité des créneaux réservables reste le Google Calendar
--   d'Alice (lu par /api/creneaux). Mais poser un créneau « à la main » dans
--   Google Agenda est fastidieux et source d'erreurs (Alice doit re-saisir le
--   titre exact, le lieu, encoder le type particulier/collectif, etc.).
--
--   Un PRESET est un MODÈLE de créneau réutilisable : « Collectif vendredi
--   18h00→19h00 · Parc de la Tête d'Or · 8 places ». Depuis l'admin, Alice
--   choisit une date + un preset → on ÉCRIT l'event correspondant dans son
--   Google Agenda (insertEvent), au format que /api/creneaux sait relire.
--   Les presets persistent (réutilisables d'une semaine sur l'autre) et sont
--   éditables par l'admin → table dédiée.
--
-- MODÈLE D'ÉCRITURE (identique au reste de l'app — cf 0002/0004/0005) :
--   Toutes les écritures passent par la `service_role` côté serveur, derrière
--   le gate applicatif `requireAdmin()` (liste blanche ADMIN_EMAILS). La RLS de
--   Supabase ne peut PAS lire cette liste blanche (elle vit dans l'env du
--   Worker, pas en base) : on active donc la RLS SANS policy (deny-all pour les
--   clients `anon`/`authenticated`), exactement comme `account_signals`. Seule
--   la service_role (bypass RLS), appelée uniquement après `requireAdmin()`,
--   accède à la table. Un client lambda ne peut donc NI lire NI écrire un preset.
-- ============================================================================

create table if not exists public.slot_presets (
  id           uuid primary key default gen_random_uuid(),
  -- Libellé affiché dans l'admin (ex. « Collectif vendredi 18h · Tête d'Or »).
  label        text not null,
  -- Type de cours encodé dans l'event (cf src/lib/reservation.ts) :
  -- 'collectif' (défaut) ou 'particulier'.
  type         text not null default 'collectif',
  -- Durée de la séance en minutes (sert à calculer l'heure de fin à partir de
  -- l'heure de début quand on applique le preset à une date).
  duree_min    int  not null,
  -- Heure de début « HH:MM » (24h, fuseau Europe/Paris). On stocke en texte
  -- plutôt qu'en `time` pour rester trivialement sérialisable côté Worker edge
  -- (pas de cast type natif à gérer) ; la validation du format se fait côté app.
  heure_debut  text not null,
  -- Lieu repris tel quel dans le champ « Lieu » (location) de l'event Google.
  -- Défaut métier : « Parc de la Tête d'Or » (cf décision Robert).
  lieu         text not null default 'Parc de la Tête d''Or',
  -- Capacité indicative pour un cours collectif (informatif : la capacité réelle
  -- est gérée à la main par Alice — cf modèle V1 dans reservation.ts). NULL pour
  -- un particulier. On l'encode aussi dans la description de l'event.
  capacite     int,
  -- Récurrence par défaut du preset (optionnelle), JSON :
  --   { "frequence": "hebdomadaire", "jour": 5, "occurrences": 8 }
  -- `jour` = 0..6 (0 = dimanche) ; sert d'aide de saisie côté UI « Appliquer ».
  recurrence   jsonb,
  -- Admin (auth.users.id) qui a créé le preset (traçabilité).
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint slot_presets_type_check
    check (type in ('collectif', 'particulier')),
  constraint slot_presets_duree_check
    check (duree_min > 0 and duree_min <= 600),
  constraint slot_presets_capacite_check
    check (capacite is null or capacite > 0),
  -- Format « HH:MM » strict (00:00 → 23:59) garanti côté base en plus de l'app.
  constraint slot_presets_heure_format_check
    check (heure_debut ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);

comment on table public.slot_presets is
  'Modèles de créneaux réutilisables (admin). Appliqués à une date → event écrit dans le Google Agenda d''Alice. Écritures via service_role derrière requireAdmin().';

-- Tri d'affichage stable des presets (les plus récents en tête).
create index if not exists slot_presets_created_at_idx
  on public.slot_presets (created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- RLS activée SANS policy : aucun client (anon/authenticated) ne lit ni n'écrit
-- les presets. L'admin y accède exclusivement via la service_role côté serveur,
-- APRÈS le gate `requireAdmin()` (liste blanche ADMIN_EMAILS, hors base). Même
-- pattern que `account_signals` (0005). Fail-safe : pas de policy = deny-all.
alter table public.slot_presets enable row level security;
