-- Onboarding : reprise d'avancement (brouillon).
-- Additif : stocke l'état partiel de l'onboarding pour qu'un user interrompu
-- (refresh / quitte en plein milieu) reprenne exactement où il s'était arrêté.
--
-- Forme du JSON : { goal?, level?, availability?, format?, phase?, stepIndex? }
--   - goal/level/availability/format : réponses partielles déjà sélectionnées
--   - phase     : "questions" | "invite" | "final"  (où en est le flow)
--   - stepIndex : 0..3 (index de la question courante quand phase = "questions")
--
-- `null` = pas de brouillon (état initial, ou nettoyé après complétion).
-- RLS : déjà en place sur `profiles` (chacun ne lit/écrit que sa ligne), aucune
-- policy à ajouter. Colonne additive nullable → 0 perte, 0 risque sur l'existant.

alter table public.profiles
  add column if not exists onboarding_draft jsonb;

comment on column public.profiles.onboarding_draft is
  'Brouillon d''onboarding (reprise) : { goal?, level?, availability?, format?, phase?, stepIndex? }. null = aucun brouillon.';
