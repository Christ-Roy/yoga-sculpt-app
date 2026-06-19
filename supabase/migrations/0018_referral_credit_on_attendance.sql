-- ============================================================================
-- Yoga Sculpt — Parrainage : crédit DÉFÉRÉ à la 1re séance HONORÉE (anti-farming)
--
-- Migration STRICTEMENT ADDITIVE & IDEMPOTENTE (re-jouable sans risque) — aucune
-- colonne/contrainte supprimée, aucune donnée touchée.
--
-- CONTEXTE (cf. todo 2026-06-19-qa-secu-parrainage-anti-abus-farmable, levier 1 +
-- vecteur « parrainer un compte existant ») :
--   Avant, le parrain était crédité dès l'INSCRIPTION du filleul (callback auth /
--   POST /completer). Farmable : faux comptes, ou comptes EXISTANTS qu'on fait
--   (re)cliquer sur un lien ?ref=. Aucune acquisition réelle requise.
--
--   Désormais (src/lib/referral.ts) :
--     - à l'inscription, le referral est seulement LIÉ en `pending`
--       (filleul_user_id posé, ticket_credite=false, AUCUN ticket) ;
--     - le crédit (1 ticket au parrain) n'a lieu qu'au moment où le filleul a sa
--       1re séance réellement HONORÉE (bookings.attendance='attended', pointée
--       par Alice via /api/admin/bookings/attendance), avec ré-évaluation de
--       l'anti-abus (canCreditReferral) + du plafond (maxParrainagesCredites),
--       idempotent sur referrals.ticket_credite.
--
--   Effet : un faux compte / un compte existant qui ne vient JAMAIS en cours ne
--   sera jamais pointé présent → le parrain n'est jamais crédité. C'est le levier
--   qui tue le farming, et qui ferme aussi le vecteur « compte existant ».
--
-- ⚠️ Le schéma EXISTANT suffit déjà (referrals.ticket_credite / status /
--    filleul_user_id ; bookings.attendance posé en 0008). Cette migration
--    n'AJOUTE qu'un INDEX de lookup pour le déclencheur de crédit (et documente
--    la nouvelle sémantique). Rien d'autre n'est requis côté base.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Index de lookup du déclencheur « séance honorée » :
--   crediterParrainsApresSeanceHonoree(filleulUserId) cherche les referrals
--   `pending` NON crédités liant ce filleul, à chaque pointage 'attended'. Index
--   PARTIEL (where ticket_credite=false) → ne couvre que les referrals encore en
--   attente de crédit (les crédités, masse croissante, ne sont jamais requêtés
--   par ce chemin). Lookup O(index) au lieu d'un scan par filleul.
-- ---------------------------------------------------------------------------
create index if not exists referrals_filleul_pending_idx
  on public.referrals (filleul_user_id)
  where ticket_credite = false;

comment on index public.referrals_filleul_pending_idx is
  'Lookup des referrals en attente de crédit par filleul (déclencheur crédit à la 1re séance honorée). Partiel : ticket_credite=false uniquement.';

comment on column public.referrals.ticket_credite is
  'True dès qu''un ticket a été crédité au parrain pour CE referral (idempotence : jamais 2x). ANTI-FARMING (2026-06-19) : passe à true au moment de la 1re séance HONORÉE du filleul (bookings.attendance=''attended''), PLUS à l''inscription.';
