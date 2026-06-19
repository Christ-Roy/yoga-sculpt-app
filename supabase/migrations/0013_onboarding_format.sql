-- Onboarding : remplace la question "fréquence" par "format de cours préféré".
-- Additif : on ajoute la colonne `format` (particulier / collectif / les_deux).
-- La colonne `frequency` est conservée (données historiques) mais n'est plus alimentée.

alter table public.onboarding_responses
  add column if not exists format text; -- particulier / collectif / les_deux

comment on column public.onboarding_responses.format is
  'Format de cours préféré (onboarding) : particulier / collectif / les_deux';
