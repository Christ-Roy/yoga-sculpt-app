# [P1] Tracking signals complet — journal d'events user + page admin Insights

**Statut** : non fait · **Qui** : agent (vague backend + UI) · **Demande Robert 2026-06-19**

## Objectif (Robert)
« Avoir en DB des signaux de tracking propres et complets sur les users pour TOUT savoir. »
Un système qui sait, pour chaque personne et dans le temps :
- qui **abandonne le checkout Stripe** (session créée, jamais payée)
- qui **parraine** et qui **s'est fait parrainer**
- qui a été **invité / parrainé / a reçu un cadeau ticket** (mode d'acquisition de chaque ticket)
- le **nombre de séances passées** par chaque personne
- le **nombre de tickets payés** (existe déjà via la table tickets — à exposer, pas à recréer)

## Décisions d'archi (tranchées avec Robert 2026-06-19)
1. **Modèle = journal d'events horodatés** (PAS de simples compteurs). Table `user_events` :
   `id, user_id (nullable pour events pré-compte ex. checkout anonyme via session), event_type, metadata jsonb, created_at, ip inet?, source text?`.
   + **vues SQL agrégées** par user (funnel, totaux) pour le dashboard.
2. **Sortie = page admin dédiée** dans l'app, réservée à 2 emails : `gdry.alice@gmail.com` (Alice) + `brunon5robert@gmail.com` (Robert).
   Réutiliser le `requireAdmin()` existant (liste blanche email, fail-safe). Onglet/section "Insights" dans `/admin` (ou `/admin/insights`).
3. **Migration additive** versionnée (`supabase/migrations/0006_user_events.sql`), RLS : insert service_role only, select admin only (ou service_role + lecture via route serveur admin). ZÉRO workaround (R0).

## Event types à émettre (liste de départ, extensible via metadata)
| event_type | émis où | metadata |
|---|---|---|
| `signup` | création profil (trigger ou onboarding) | provider (google/ms/magiclink), ref?, ip, fingerprint |
| `onboarding_completed` | fin onboarding | objectif, niveau, fréquence |
| `checkout_started` | `/api/checkout` (création session Stripe) | stripe_session_id, formule, montant |
| `checkout_completed` | webhook Stripe `checkout.session.completed` | stripe_session_id, formule, montant, nb_tickets |
| `checkout_abandoned` | **dérivé** : session `checkout_started` sans `checkout_completed` après X (vue SQL ou cron de réconciliation) | stripe_session_id, formule |
| `ticket_acquired` | webhook Stripe + crédit parrainage + (futur) cadeau | type, quantite, **acquisition_source** (paid/referral/gift/welcome), source_user_id? |
| `referral_invited` | quand un membre envoie une invitation | email_filleul (hashé?), code |
| `referral_signup` | quand un filleul s'inscrit avec un ref | parrain_user_id, code |
| `referral_credited` | quand le parrain reçoit son ticket | parrain_user_id, filleul_user_id |
| `referral_blocked` | échec silencieux anti-abus | raison (ip/email/fingerprint) — pour qu'Alice/Robert voient les abus |
| `booking_created` | `/api/reserver` | booking_id, créneau, type |
| `booking_cancelled` | `/api/annuler` | booking_id, recrédité? |
| `booking_attended` | séance passée (créneau dans le passé + booking confirmed, ou marquage admin) | booking_id |

## Vues agrégées pour le dashboard (par user)
- `nb_seances_passees`, `nb_seances_a_venir`, `nb_tickets_payes`, `nb_tickets_total`, `acquisition_source`,
  `parrain` (qui m'a parrainé), `nb_filleuls_credites`, `checkout_abandonnes`, `LTV` (somme montants payés), `derniere_activite`.
- Funnel global : visiteurs → signup → onboarding → 1er achat → 1ère résa → 1ère séance.

## Fichiers concernés (à câbler)
- `supabase/migrations/0006_user_events.sql` (nouvelle table + RLS + vues)
- `src/lib/events.ts` (nouveau) — helper `logEvent(userId, type, metadata)` côté serveur (service_role)
- `src/app/api/checkout/route.ts` + `src/app/api/webhooks/stripe/route.ts` — émettre checkout_started / completed / ticket_acquired
- `src/app/api/reserver/route.ts` + `src/app/api/annuler/route.ts` — booking_created / cancelled
- `src/lib/reservation.ts` ou cron — booking_attended (séance passée)
- parrainage (cf tickets P1 parrainage 2026-06-19-*) — referral_* events (À CÂBLER EN MÊME TEMPS que le fix parrainage, sinon events morts)
- `src/app/admin/` — section Insights (KPIs + table par user), gate `requireAdmin()` (ajouter gdry.alice@ + brunon5robert@ à la liste blanche si pas déjà)
- checkout_abandoned : cron de réconciliation (Cloudflare Cron Trigger déjà en place) OU vue SQL `LEFT JOIN`.

## ⚠️ Dépendance
Les events `referral_*` dépendent du **fix du parrainage cassé** (tickets P1 :
`2026-06-19-parrainage-ref-cookie-jamais-pose.md`, `-fingerprint-endpoint-404.md`, `-completer-jamais-appele.md`).
À traiter dans la MÊME vague (réparer le parrainage + l'instrumenter d'un coup).

## Impact
Business fort : visibilité totale sur l'acquisition, la rétention, les abandons de paiement, l'efficacité du parrainage.
C'est le socle de pilotage de l'activité d'Alice. Tier migration = additive (pas 💀), donc agent autonome après validation des priorités.
