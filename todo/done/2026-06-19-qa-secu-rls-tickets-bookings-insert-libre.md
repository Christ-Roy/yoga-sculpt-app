# [P1] QA sécu — RLS : un client peut s'auto-créditer des tickets (et bookings) via la clé anon

**Statut** : à corriger · **Qui** : agent · **Source** : QA sécu 2026-06-19 (axe #2 RLS — la vraie faille monétisation)

## Problème
La clé Supabase `anon` est **publique** (bundle navigateur, `wrangler.jsonc`, `src/lib/supabase/client.ts` — public par design, protégé par RLS). Or les policies RLS de la migration `0002_booking.sql` autorisent l'utilisateur authentifié à INSÉRER/UPDATER directement ses propres lignes `tickets` et `bookings`, **sans contrôle d'origine** :

`supabase/migrations/0002_booking.sql` (~l.113-136) :
```sql
create policy "tickets_insert_own" on public.tickets for insert
  with check (auth.uid() = user_id);
create policy "bookings_insert_own" on public.bookings for insert
  with check (auth.uid() = user_id);
create policy "bookings_update_own" on public.bookings for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
```
Le `with check` borne juste à *son propre* user_id — il ne vérifie NI `source`, NI `stripe_session_id`, NI un paiement. Et le moteur de résa (`src/app/api/reserver/route.ts`) sélectionne le ticket à consommer sur `user_id + type + quantite_restante>0` **sans filtre `source` ni exigence Stripe** → un ticket auto-inséré est pleinement réservable (création d'event Google incluse).

## Exploit (coût 0, aucun anti-abus déclenché)
Connecté sur app.yoga-sculpt.fr, dans la console navigateur (anon key visible dans le bundle) :
```js
await supabase.from('tickets').insert({
  user_id: MON_USER_ID, type: 'particulier',
  quantite_initiale: 999, quantite_restante: 999
});
// → 999 cours (60€/u) gratuits, immédiatement réservables.
```
Même vecteur pour `bookings` : s'auto-insérer/forcer `status='confirmed'`, `attendance='attended'`, etc. (pollution d'état + tracking présence falsifié). C'est plus grave que le farming de parrainage : pas besoin de filleuls, crédit illimité direct.

## Pourquoi ça ne casse rien aujourd'hui dans l'app (mais reste exploitable)
L'app n'utilise JAMAIS ces policies write : tous les inserts/updates légitimes (`reserver`, `annuler`, webhook Stripe, parrainage, welcome, admin) passent par le **service_role** (bypass RLS). Ces policies write sont donc **inutiles** et n'ouvrent qu'une surface d'attaque.

## Correctif
Supprimer les policies write côté client, ne garder que la lecture :
```sql
drop policy if exists "tickets_insert_own" on public.tickets;     -- INSERT via service_role only
drop policy if exists "bookings_insert_own" on public.bookings;
drop policy if exists "bookings_update_own" on public.bookings;
-- conserver : tickets_select_own, bookings_select_own (lecture de SES lignes)
```
Migration additive dédiée (ex. `0010_rls_lockdown_writes.sql`), `drop policy if exists` → idempotent. Vérifier après coup que `reserver`/`annuler`/dashboard fonctionnent (ils passent par service_role, donc OK), et que l'UI espace ne fait aucun write direct anon sur tickets/bookings.

## Voisin à traiter dans la même passe — `profiles_update_own` trop large (P2)
`0001_init.sql` `profiles_update_own` (update au niveau ligne) laisse le client modifier des colonnes système ajoutées plus tard : `referral_code`, `welcome_ticket_granted_at`, `relance_*_sent_at`, `onboarding_completed`. Le seul levier à enjeu (remettre `welcome_ticket_granted_at=null` pour re-déclencher un ticket bienvenue) est **stoppé par l'index unique partiel DB** `tickets_welcome_once_uidx` (bonne défense en profondeur), donc P2 et non P1. Reco : soit router les writes profile via service_role et retirer la policy, soit `GRANT UPDATE (email, full_name, phone)` column-level + `REVOKE UPDATE` global.

## Ce qui est DÉJÀ solide (RLS)
- 4 tables système en deny-all parfait : `referrals` (select-only sur `parrain_user_id`), `account_signals` / `user_events` / `slot_presets` (0 policy ⇒ deny-all). Admin lit/écrit via service_role derrière `requireAdmin()`.
- Vues insights en `security_invoker = true` (un anon obtiendrait 0 ligne — pas de fuite cross-user ; le piège classique `security definer` a été évité).
- Trigger `handle_new_user` en `security definer` + `set search_path = public` (anti-hijack), insert event wrappé en `exception when others`.
- Index uniques d'idempotence robustes : `tickets_welcome_once_uidx`, `tickets_stripe_session_id_uidx`, `bookings_no_double_creneau_uidx`, `referrals_parrain_email_uidx`.

## Fichiers
`supabase/migrations/0001_init.sql`, `supabase/migrations/0002_booking.sql`, `src/app/api/reserver/route.ts` (sélection ticket sans filtre source).
