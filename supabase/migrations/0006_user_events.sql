-- ============================================================================
-- Yoga Sculpt — Espace client : JOURNAL D'ÉVÉNEMENTS UTILISATEUR (tracking V1)
-- Table : user_events  +  vues agrégées (par user + funnel global)
--
-- POURQUOI (demande Robert 2026-06-19) :
--   « Avoir en DB des signaux de tracking propres et complets sur les users pour
--     TOUT savoir » — acquisition, rétention, abandons de paiement, parrainage,
--     séances passées/à venir, LTV. Socle de pilotage de l'activité d'Alice.
--
-- MODÈLE — journal d'events horodatés (PAS de simples compteurs) :
--   Chaque action métier émet une LIGNE immuable (append-only) `user_events`.
--   Les compteurs/funnels du dashboard sont des VUES SQL agrégées au-dessus de ce
--   journal (+ des tables métier `tickets`/`bookings`/`referrals` qui restent la
--   source de vérité pour les montants/quantités). On ne dénormalise PAS de
--   compteur sur `profiles` : un journal + des vues = pas de désynchronisation
--   possible, et on garde l'historique temporel (qui a fait quoi, quand).
--
-- MODÈLE D'ÉCRITURE :
--   INSERT via la `service_role` UNIQUEMENT (côté serveur : routes API, webhooks,
--   helper src/lib/events.ts). Un client navigateur ne doit JAMAIS pouvoir
--   écrire/falsifier un event (ni s'auto-attribuer un `ticket_acquired`). La RLS
--   ci-dessous l'interdit (aucune policy insert/update/delete côté user).
--
-- LECTURE :
--   Réservée à l'admin, via la `service_role` côté serveur (pages /admin/insights,
--   src/lib/insights-data.ts). RLS activée SANS policy select user → un client ne
--   lit jamais le journal (pas même le sien : ces signaux sont du pilotage
--   interne, et la lecture croisée révélerait l'activité d'autrui).
--
-- ADDITIF & IDEMPOTENT : `if not exists` partout, `create or replace view`.
--   Rejouable sans risque, aucune perte de données, aucune réécriture destructive.
--
-- RUNTIME : table+vues pures PostgreSQL. Le helper d'écriture (events.ts) tourne
--   en edge (Cloudflare Workers) via PostgREST/fetch — aucune dépendance Node.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- bookings : marqueur d'idempotence pour l'émission de l'event booking_attended.
-- Le COMPTEUR de séances passées est dérivé directement de bookings (vue
-- v_user_signals) et ne dépend PAS de ce marqueur. Cette colonne sert UNIQUEMENT
-- à ce que le cron n'émette qu'UNE FOIS l'event `booking_attended` par séance
-- réellement passée (timeline du journal). NULL = pas encore émis.
-- Migration additive (`if not exists`) — aucune perte de données.
-- ---------------------------------------------------------------------------
alter table public.bookings
  add column if not exists attended_event_at timestamptz;

comment on column public.bookings.attended_event_at is
  'Horodatage d''émission de l''event user_events booking_attended pour cette résa (idempotence du cron). NULL = pas encore émis. Le compteur de séances passées NE dépend PAS de cette colonne (dérivé de bookings).';

-- ---------------------------------------------------------------------------
-- Table : user_events  (journal append-only)
-- ---------------------------------------------------------------------------
create table if not exists public.user_events (
  id          uuid primary key default gen_random_uuid(),
  -- NULLABLE : certains events précèdent (ou n'ont pas) de compte rattaché
  -- (ex. un checkout anonyme via session, un referral_blocked sans user). On ne
  -- met PAS de FK stricte vers auth.users pour ne JAMAIS bloquer un log
  -- best-effort (un log raté ne doit pas casser le flux métier) ET pour tolérer
  -- la suppression d'un compte sans perdre la trace historique. On garde donc
  -- l'uuid « libre » ; les vues joignent au besoin sur profiles/auth.users.
  user_id     uuid,
  -- Type d'événement (cf. union TS dans src/lib/events.ts). Texte + CHECK
  -- extensible : ajouter un type = ajouter une valeur au CHECK (migration
  -- additive). Pas un enum PG (un enum est plus pénible à étendre).
  event_type  text not null,
  -- Charge utile structurée (montant, formule, stripe_session_id, provider,
  -- acquisition_source, parrain_user_id, raison d'un blocage, etc.). JSONB pour
  -- requêter/indexer au besoin. Défaut = objet vide (jamais NULL → simplifie le
  -- requêtage `metadata->>'x'`).
  metadata    jsonb not null default '{}'::jsonb,
  -- IP de l'événement (type natif inet). Optionnel : utile pour l'anti-abus /
  -- géoloc grossière. Best-effort (souvent null en webhook machine-to-machine).
  ip          inet,
  -- Origine de l'event (route/contexte émetteur : 'checkout', 'webhook:stripe',
  -- 'reserver', 'onboarding', 'cron', 'trigger', …). Aide au debug et au filtrage.
  source      text,
  created_at  timestamptz not null default now(),

  -- Garde-fou : on borne les valeurs connues du journal. Étendre cette liste
  -- (migration additive) à mesure que de nouveaux signaux sont câblés. On reste
  -- volontairement permissif sur le contenu de `metadata` (extensible sans DDL).
  constraint user_events_type_check check (event_type in (
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
    'booking_attended'
  ))
);

comment on table public.user_events is
  'Journal append-only des signaux de tracking utilisateur (acquisition, paiement, résa, parrainage). Écritures via service_role uniquement. Source des vues d''agrégation /admin/insights.';

-- ---------------------------------------------------------------------------
-- Index (lecture du dashboard : par user, par type, par date)
-- ---------------------------------------------------------------------------
-- Timeline / agrégats d'un user donné (vue par-user du dashboard).
create index if not exists user_events_user_id_idx
  on public.user_events (user_id);

-- Funnel global / comptage par type d'événement.
create index if not exists user_events_event_type_idx
  on public.user_events (event_type);

-- Tri chronologique (dernière activité, fenêtres temporelles, ordre du funnel).
create index if not exists user_events_created_at_idx
  on public.user_events (created_at);

-- Lookup combiné « tous les events d'un type pour un user » (chemin chaud des
-- agrégats par-user) : index composite ordonné dans le temps.
create index if not exists user_events_user_type_created_idx
  on public.user_events (user_id, event_type, created_at);

-- Réconciliation checkout (matching started ↔ completed sur la session Stripe).
-- Index fonctionnel sur metadata->>'stripe_session_id' (partiel : seulement les
-- events qui en portent un), pour la vue d'abandon de checkout.
create index if not exists user_events_stripe_session_idx
  on public.user_events ((metadata->>'stripe_session_id'))
  where metadata ? 'stripe_session_id';

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- RLS activée SANS aucune policy : ni lecture ni écriture côté client. Seule la
-- service_role (bypass RLS) écrit (helper serveur) et lit (pages /admin via
-- service_role). Un client ne falsifie pas un event et ne sonde pas le journal.
alter table public.user_events enable row level security;

-- ===========================================================================
-- VUES AGRÉGÉES
--
-- Sécurité des vues : déclarées en `security_invoker = true` → la vue s'exécute
-- avec les droits de l'APPELANT (et non du créateur). Comme la table sous-jacente
-- est RLS sans policy, seule la service_role (qui bypass la RLS) peut lire ces
-- vues. Un client anon/authenticated qui tenterait `select * from v_*` obtiendrait
-- 0 ligne (RLS de user_events/bookings/tickets appliquée). Fail-safe.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Vue : v_user_checkout_abandons
-- checkout_abandoned DÉRIVÉ (pas d'event écrit) : une session de paiement
-- `checkout_started` dont AUCUN `checkout_completed` ne porte le même
-- stripe_session_id. On dérive l'abandon plutôt que de l'écrire : c'est l'absence
-- d'un completed qui définit l'abandon, donc une vue LEFT JOIN est la source de
-- vérité exacte et auto-corrigée (si le completed arrive plus tard, la ligne
-- sort automatiquement de la vue). Aucun cron requis pour CETTE métrique.
-- ---------------------------------------------------------------------------
create or replace view public.v_user_checkout_abandons
with (security_invoker = true) as
select
  s.user_id,
  s.metadata->>'stripe_session_id'             as stripe_session_id,
  s.metadata->>'formule'                        as formule,
  (s.metadata->>'montant')::numeric             as montant,
  s.created_at                                   as started_at
from public.user_events s
where s.event_type = 'checkout_started'
  and s.metadata ? 'stripe_session_id'
  and not exists (
    select 1
    from public.user_events c
    where c.event_type = 'checkout_completed'
      and c.metadata->>'stripe_session_id' = s.metadata->>'stripe_session_id'
  );

comment on view public.v_user_checkout_abandons is
  'Sessions de paiement démarrées (checkout_started) jamais complétées (pas de checkout_completed même stripe_session_id). checkout_abandoned est DÉRIVÉ ici, pas écrit en table.';

-- ---------------------------------------------------------------------------
-- Vue : v_user_signals  (UNE ligne par utilisateur — cœur du dashboard)
--
-- Croise le journal d'events ET les tables métier (source de vérité pour les
-- quantités/montants) :
--   - nb_seances_passees   : bookings confirmés dont starts_at est passé
--                            (= booking_attended DÉRIVÉ ; voir note plus bas).
--   - nb_seances_a_venir   : bookings confirmés à venir.
--   - nb_tickets_payes     : Σ quantite_initiale des tickets ISSUS d'un paiement
--                            (stripe_session_id non null) — séances ACHETÉES.
--   - nb_tickets_total     : Σ quantite_initiale de TOUS les tickets (achat +
--                            offerts parrainage).
--   - acquisition_source   : 'referral' si le user a été parrainé (existe comme
--                            filleul crédité), sinon 'direct'.
--   - parrain_user_id      : qui a parrainé ce user (referral crédité), sinon null.
--   - nb_filleuls_credites : nb de filleuls que CE user a parrainés et fait créditer.
--   - checkout_abandonnes  : nb de sessions de paiement abandonnées (vue ci-dessus).
--   - ltv_eur              : Σ des montants RÉELLEMENT payés tracés dans le journal
--                            (checkout_completed.metadata.montant). Fiable dès que
--                            Stripe pousse le montant ; 0 tant qu'aucun paiement.
--   - derniere_activite    : max(created_at) du journal pour ce user.
--
-- ⚠️ booking_attended : `nb_seances_passees` est calculé DIRECTEMENT depuis
--    bookings (confirmed + starts_at < now) — c'est le nombre FIABLE que Robert
--    veut, indépendant de l'émission d'un event. Un event `booking_attended` peut
--    en plus être émis par le cron (marquage temporel) pour la timeline, mais le
--    COMPTEUR ne dépend pas de lui (pas de risque de sous-comptage si le cron
--    n'a pas tourné).
-- ---------------------------------------------------------------------------
create or replace view public.v_user_signals
with (security_invoker = true) as
with
  -- Séances (bookings confirmés) passées / à venir, par user.
  seances as (
    select
      b.user_id,
      count(*) filter (where b.status = 'confirmed' and b.starts_at <  now()) as nb_seances_passees,
      count(*) filter (where b.status = 'confirmed' and b.starts_at >= now()) as nb_seances_a_venir
    from public.bookings b
    group by b.user_id
  ),
  -- Tickets : payés (issus d'un paiement Stripe) vs total (achat + offerts).
  tk as (
    select
      t.user_id,
      coalesce(sum(t.quantite_initiale) filter (where t.stripe_session_id is not null), 0) as nb_tickets_payes,
      coalesce(sum(t.quantite_initiale), 0)                                                as nb_tickets_total
    from public.tickets t
    group by t.user_id
  ),
  -- Parrain de CE user (referral crédité où il est filleul). Un seul attendu.
  parrain as (
    select distinct on (r.filleul_user_id)
      r.filleul_user_id as user_id,
      r.parrain_user_id
    from public.referrals r
    where r.filleul_user_id is not null
      and r.ticket_credite = true
    order by r.filleul_user_id, r.completed_at asc nulls last
  ),
  -- Nb de filleuls que CE user a parrainés et fait créditer.
  filleuls as (
    select
      r.parrain_user_id as user_id,
      count(*) as nb_filleuls_credites
    from public.referrals r
    where r.ticket_credite = true
    group by r.parrain_user_id
  ),
  -- Abandons de checkout agrégés par user.
  abandons as (
    select a.user_id, count(*) as checkout_abandonnes
    from public.v_user_checkout_abandons a
    where a.user_id is not null
    group by a.user_id
  ),
  -- LTV = somme des montants réellement payés tracés dans le journal.
  ltv as (
    select
      e.user_id,
      coalesce(sum((e.metadata->>'montant')::numeric), 0) as ltv_eur
    from public.user_events e
    where e.event_type = 'checkout_completed'
      and e.user_id is not null
      and (e.metadata->>'montant') is not null
    group by e.user_id
  ),
  -- Dernière activité = dernier event journalisé pour ce user.
  derniere as (
    select e.user_id, max(e.created_at) as derniere_activite
    from public.user_events e
    where e.user_id is not null
    group by e.user_id
  )
select
  p.id                                            as user_id,
  p.email,
  p.full_name,
  p.created_at                                    as signup_at,
  p.onboarding_completed,
  coalesce(seances.nb_seances_passees, 0)         as nb_seances_passees,
  coalesce(seances.nb_seances_a_venir, 0)         as nb_seances_a_venir,
  coalesce(tk.nb_tickets_payes, 0)                as nb_tickets_payes,
  coalesce(tk.nb_tickets_total, 0)                as nb_tickets_total,
  case when parrain.parrain_user_id is not null then 'referral' else 'direct' end
                                                  as acquisition_source,
  parrain.parrain_user_id,
  coalesce(filleuls.nb_filleuls_credites, 0)      as nb_filleuls_credites,
  coalesce(abandons.checkout_abandonnes, 0)       as checkout_abandonnes,
  coalesce(ltv.ltv_eur, 0)                        as ltv_eur,
  coalesce(derniere.derniere_activite, p.created_at) as derniere_activite
from public.profiles p
left join seances   on seances.user_id   = p.id
left join tk        on tk.user_id        = p.id
left join parrain   on parrain.user_id   = p.id
left join filleuls  on filleuls.user_id  = p.id
left join abandons  on abandons.user_id  = p.id
left join ltv       on ltv.user_id       = p.id
left join derniere  on derniere.user_id  = p.id;

comment on view public.v_user_signals is
  'UNE ligne par utilisateur : séances passées/à venir, tickets payés/total, source d''acquisition, parrain, filleuls crédités, checkouts abandonnés, LTV, dernière activité. Lecture admin via service_role.';

-- ---------------------------------------------------------------------------
-- Vue : v_funnel_global  (UNE seule ligne — KPIs globaux du funnel)
-- visiteurs → signup → onboarding → 1er achat → 1ère résa → 1ère séance.
--
-- « visiteurs » n'est pas tracé en DB (pas d'event anonyme de page-view ici ;
-- ça relève de l'analytics web, hors périmètre). Le funnel commence donc à
-- l'inscription. Chaque palier compte les USERS DISTINCTS ayant atteint l'étape,
-- pour pouvoir afficher des taux de conversion étape→étape.
-- ---------------------------------------------------------------------------
create or replace view public.v_funnel_global
with (security_invoker = true) as
select
  (select count(*) from public.profiles)                                   as nb_inscrits,
  (select count(*) from public.profiles where onboarding_completed)        as nb_onboardes,
  (select count(distinct user_id) from public.tickets
     where stripe_session_id is not null)                                  as nb_acheteurs,
  (select count(distinct user_id) from public.bookings)                    as nb_avec_resa,
  (select count(distinct user_id) from public.bookings
     where status = 'confirmed' and starts_at < now())                     as nb_avec_seance_passee,
  -- Acquisition gratuite (parrainage) : filleuls effectivement crédités.
  (select count(distinct filleul_user_id) from public.referrals
     where ticket_credite = true and filleul_user_id is not null)          as nb_parraines,
  -- Tickets offerts via parrainage (referrals crédités).
  (select count(*) from public.referrals where ticket_credite = true)      as nb_tickets_parrainage,
  -- Abandons de paiement (sessions started sans completed).
  (select count(*) from public.v_user_checkout_abandons)                   as nb_checkouts_abandonnes,
  -- Conversions de paiement réussies (sessions completed distinctes).
  (select count(distinct metadata->>'stripe_session_id') from public.user_events
     where event_type = 'checkout_completed'
       and metadata ? 'stripe_session_id')                                 as nb_checkouts_completes,
  -- CA réel tracé (Σ montants des checkout_completed du journal).
  (select coalesce(sum((metadata->>'montant')::numeric), 0)
     from public.user_events
     where event_type = 'checkout_completed'
       and (metadata->>'montant') is not null)                             as ca_reel_eur;

comment on view public.v_funnel_global is
  'KPIs globaux du funnel d''acquisition (inscrits → onboardés → acheteurs → résa → séance), parrainage, abandons/conversions de paiement, CA réel tracé. UNE ligne. Lecture admin via service_role.';

-- ---------------------------------------------------------------------------
-- Vue : v_funnel_events_30j  (volume d'events par type sur 30 jours glissants)
-- Pour un graphe/tableau « ce qui se passe en ce moment » côté dashboard.
-- ---------------------------------------------------------------------------
create or replace view public.v_funnel_events_30j
with (security_invoker = true) as
select
  e.event_type,
  count(*)                       as nb_total,
  count(distinct e.user_id)      as nb_users,
  max(e.created_at)              as dernier
from public.user_events e
where e.created_at >= now() - interval '30 days'
group by e.event_type;

comment on view public.v_funnel_events_30j is
  'Volume d''events par type sur 30 jours glissants (nb total + users distincts + dernier horodatage). Lecture admin via service_role.';

-- ---------------------------------------------------------------------------
-- signup : émis par le TRIGGER d'inscription (le plus fiable — fire pour TOUTES
-- les méthodes d'auth : Google, Microsoft, magic-link). On RÉÉCRIT
-- handle_new_user() (défini en 0001) pour, en plus de créer le profil, insérer
-- un event `signup`. SECURITY DEFINER → bypass RLS (peut écrire dans user_events
-- malgré l'absence de policy). provider relu depuis raw_app_meta_data.provider.
--
-- POURQUOI le trigger et pas la route /auth/callback : le callback est le
-- périmètre d'un autre chantier (parrainage) ; le trigger est de toute façon plus
-- robuste (il ne peut pas être contourné par un chemin d'inscription alternatif).
-- Idempotent : `create or replace`, et l'insert profil garde son `on conflict
-- do nothing`. L'event signup, lui, est émis une fois par insert auth.users (un
-- même user n'est inséré qu'une fois dans auth.users → pas de doublon).
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

  -- Tracking : event signup (best-effort ; une erreur d'insert ne doit pas
  -- empêcher la création du compte → on avale toute exception).
  begin
    insert into public.user_events (user_id, event_type, metadata, source)
    values (
      new.id,
      'signup',
      jsonb_build_object(
        'provider', coalesce(new.raw_app_meta_data->>'provider', 'unknown'),
        'email',    new.email
      ),
      'trigger'
    );
  exception when others then
    -- On ne propage pas : l'inscription prime sur le tracking.
    raise warning '[user_events] signup non journalisé pour %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

-- Le trigger on_auth_user_created (créé en 0001) pointe déjà sur cette fonction ;
-- le `create or replace` ci-dessus suffit (pas besoin de recréer le trigger).
