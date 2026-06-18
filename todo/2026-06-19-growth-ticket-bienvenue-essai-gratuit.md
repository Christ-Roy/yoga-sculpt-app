# [P1] Growth — 1 ticket "1ère séance offerte" crédité à l'inscription (pivot Essai gratuit)

**Statut** : non fait · **Qui** : agent + arbitrage team-lead/Robert (revient sur une décision)

## Contexte
Depuis le 2026-06-19, **tout le tunnel d'acquisition repose sur "Essai gratuit"** : le vitrine
pousse désormais les visiteurs vers l'app (cf tickets vitrine), avec la promesse implicite d'une
1ère séance gratuite. Or côté app, **aucun ticket gratuit n'est crédité à l'inscription** : les
tickets ne naissent QUE par parrainage (`src/lib/referral.ts:160`, `crediterTicketParrain`) ou par
achat Stripe. Un nouvel inscrit "Essai gratuit" arrive sur un espace… sans rien de gratuit. Friction
maximale, promesse non tenue, et le parrainage perd son sens si l'inscription de base ne donne rien.

⚠️ **Ce ticket revient sur une décision du 2026-06-18** : `todo/2026-06-18-features-produit-
reservation.md` §5 dit explicitement "PAS de ticket de bienvenue auto". Cette décision est
**antérieure au pivot "Essai gratuit" du 2026-06-19** → à re-trancher. Je le remonte comme arbitrage,
pas comme exécution silencieuse.

## Arbitrage à trancher (team-lead / Robert)
**Décision** : crédite-t-on automatiquement 1 ticket gratuit à l'inscription, ou non ?
- **Option A (reco, ~75 %)** : 1 ticket "collectif" offert quand `onboarding_completed` passe à true
   (1ère vraie complétion), une seule fois par compte. Tient la promesse "Essai gratuit", alimente
   la 1ère réservation, cohérent avec le vitrine.
- **Option B** : pas de crédit auto, l'"essai gratuit" = juste l'accès à l'app + parrainage. Risque :
   promesse vitrine creuse, taux d'activation faible.
   → Impact A : ~30 min de code, additif, anti-abus déjà en place. Risque = des comptes multiples
     pour multiplier les essais → MUTUALISER la garde anti-abus du parrainage (IP+fingerprint+email
     jetable, `src/lib/anti-abuse.ts` + `account_signals`), échec silencieux comme le parrainage.

## Demande précise (si Option A retenue)
1. Au passage `onboarding_completed = true` (`src/app/onboarding/actions.ts:69-72`), créditer 1 ticket
   `type: "collectif"`, `quantite_initiale/restante: 1`, sans `stripe_*` (cf le pattern exact de
   `crediterTicketParrain`). Idempotent : 1 ticket bienvenue par compte max → flag dédié
   (`profiles.welcome_ticket_granted_at` ou marqueur sur `tickets`/`account_signals`).
2. **Anti-abus** : réutiliser la garde existante (IP/fingerprint/email jetable). Échec silencieux
   (pas de message qui révèle le blocage), exactement comme le parrainage.
3. **Expiration** : décider si le ticket bienvenue expire (ex. 30 j pour pousser à l'usage) ou non
   (le parrainage met `expires_at = null`). Reco : 30 j pour créer l'urgence d'activation.
4. UI espace : un encart "Votre 1ère séance est offerte → Réserver" tant que le ticket est dispo
   (forte incitation à la 1ère réservation = le moment d'activation clé).
5. Migration additive si nouvelle colonne (`0006_welcome_ticket.sql`), RLS calquée sur l'existant.

## Fichiers concernés
`src/app/onboarding/actions.ts` (hook de crédit), `src/lib/referral.ts` (pattern d'insert ticket à
réutiliser/factoriser), `src/lib/anti-abuse.ts`, `supabase/migrations/0006_*.sql`, UI espace
(`src/app/espace/page.tsx`).

## Impact
**Pivot business central + taux d'activation.** C'est le ticket qui fait que "Essai gratuit" (vitrine)
= quelque chose de réel (app). Sans lui, la nouvelle stratégie d'acquisition est une coquille vide.
P1 — à traiter en parallèle du câblage CTA vitrine.
