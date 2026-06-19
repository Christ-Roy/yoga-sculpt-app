-- ============================================================================
-- Yoga Sculpt — Espace client : CORRECTIF SÉCU RLS (faille monétisation P1)
--
-- Source : QA sécu 2026-06-19
--   (todo/2026-06-19-qa-secu-rls-tickets-bookings-insert-libre.md)
--
-- PROBLÈME
--   La clé Supabase `anon` est publique (bundle navigateur). Les policies RLS
--   write de la migration 0002_booking.sql autorisaient un utilisateur connecté
--   à INSÉRER/UPDATER directement ses propres lignes `tickets`/`bookings` via
--   cette clé anon (console navigateur), sans aucun contrôle d'origine ni de
--   paiement Stripe. Exploit : s'auto-créditer 999 tickets gratuits (60€/u) puis
--   les réserver sur de vrais créneaux. Coût 0, faille de monétisation exploitable.
--
-- POURQUOI C'EST SAFE DE LES SUPPRIMER
--   L'application N'UTILISE JAMAIS ces policies write : tous les inserts/updates
--   légitimes (reserver, annuler, webhook Stripe, parrainage, welcome, admin)
--   passent par la `service_role` (createServiceClient), qui BYPASS la RLS.
--   Vérifié par grep exhaustif des `.from("tickets"|"bookings").insert/update/
--   delete/upsert` : 100 % via service_role. Le seul fichier important le client
--   browser (@/lib/supabase/client) est ConfirmClient.tsx, qui ne fait aucun write.
--   Ces policies write sont donc une SURFACE D'ATTAQUE PURE, sans usage légitime.
--
-- CE QU'ON CONSERVE
--   tickets_select_own + bookings_select_own : la lecture par le client (un user
--   voit SES tickets / SES résas dans l'espace) reste légitime et nécessaire.
--   Le service_role n'est pas concerné (il bypass RLS dans tous les cas).
--
-- NUMÉRO DE MIGRATION : 0012 (et non 0010 suggéré par le ticket).
--   Raison : il existe DÉJÀ des migrations 0006-0011 sur d'autres branches non
--   mergées (user_events, slot_presets, attendance, 2× 0009 en collision,
--   welcome ticket, relance inactifs). On prend 0012 pour être STRICTEMENT après
--   tout l'existant et éviter une collision de numéro à la consolidation.
--
-- SÛRETÉ
--   `drop policy if exists` = idempotent, AUCUNE donnée touchée (on retire un
--   objet de contrôle d'accès permissif). Le check-migration-safety autorise
--   explicitement `DROP POLICY ... IF EXISTS` (cf scripts/ci/check-migration-safety.sh).
-- ============================================================================

-- tickets : retire l'insert client (auto-crédit). On garde tickets_select_own.
drop policy if exists "tickets_insert_own" on public.tickets;

-- bookings : retire l'insert ET l'update client (auto-résa / falsification de
-- status/attendance). On garde bookings_select_own.
drop policy if exists "bookings_insert_own" on public.bookings;
drop policy if exists "bookings_update_own" on public.bookings;
