-- 0015_fix_tickets_session_dedup_index.sql
--
-- 🔴 FIX CRITIQUE (chemin paiement) — l'idempotence du webhook Stripe était CASSÉE.
--
-- CONTEXTE
--   Le webhook `/api/webhooks/stripe` crédite les tickets via un upsert idempotent :
--       .upsert({...}, { onConflict: "stripe_session_id", ignoreDuplicates: true })
--   ce qui génère côté Postgres `INSERT ... ON CONFLICT (stripe_session_id) ...`.
--
-- BUG
--   L'index de dédup posé en 0002 était PARTIEL :
--       create unique index tickets_stripe_session_id_uidx
--         on public.tickets (stripe_session_id) where stripe_session_id is not null;
--   Or `ON CONFLICT (stripe_session_id)` SANS prédicat ne « matche » PAS un index
--   partiel : Postgres répond `42P10 there is no unique or exclusion constraint
--   matching the ON CONFLICT specification`. Le client supabase-js ne sait pas
--   émettre le prédicat `WHERE stripe_session_id IS NOT NULL` dans le `onConflict`.
--
-- CONSÉQUENCE (prod ET staging)
--   CHAQUE `checkout.session.completed` faisait planter l'upsert → le handler
--   répondait 500 → Stripe re-tentait en boucle → AUCUN ticket n'était jamais
--   crédité après un paiement. « Quand on paye on reçoit ses tickets » était FAUX.
--   Découvert par le harnais E2E Playwright (test paiement → vérif DB) sur staging.
--
-- FIX
--   On remplace l'index PARTIEL par un index UNIQUE PLEIN sur (stripe_session_id).
--   En Postgres, l'unicité par défaut est `NULLS DISTINCT` : plusieurs lignes à
--   `stripe_session_id = NULL` (tickets offerts welcome/referral/admin) restent
--   autorisées — aucun changement de comportement pour ces lignes. En revanche
--   un `ON CONFLICT (stripe_session_id)` SANS prédicat matche désormais l'index
--   → l'upsert idempotent fonctionne et un même paiement ne crédite jamais 2×.
--
-- Idempotent (drop if exists / create if not exists), sûr et réversible.

-- 1) Retire l'ancien index PARTIEL (incompatible avec ON CONFLICT sans prédicat).
drop index if exists public.tickets_stripe_session_id_uidx;

-- 2) Pose un index UNIQUE PLEIN. NULLS DISTINCT (défaut) → les multiples NULL
--    (tickets offerts) restent permis ; les session_id réels sont dédupliqués.
create unique index if not exists tickets_stripe_session_id_uidx
  on public.tickets (stripe_session_id);

comment on index public.tickets_stripe_session_id_uidx is
  'Dédup idempotence webhook Stripe. PLEIN (pas partiel) pour matcher '
  'ON CONFLICT (stripe_session_id) émis par supabase-js. NULLS DISTINCT '
  '(défaut) → tickets offerts (session_id NULL) non contraints.';
