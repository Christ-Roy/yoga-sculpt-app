# [P1] Cours particulier en créneau LIBRE (9h-21h) + notifications Alice sur tous les événements

**Statut** : non fait · **Qui** : agent (à lancer APRÈS l'agent calendrier, fichiers partagés) · **Demande Robert 2026-06-19**

## Décisions Robert (tranchées)
1. **Cours PARTICULIER = créneau libre**, PAS de contrainte de créneaux pré-posés. Le client choisit
   **n'importe quelle date + heure entre 9h00 et 21h00**, réservation **directe et confirmée**,
   **SAUF sur les plages où Alice est indisponible** (autres cours déjà dans son Google Calendar,
   events perso, indispos marquées). Le client voit donc 9h-21h MOINS les trous occupés.
   → À la réservation : crée l'event dans l'agenda Google d'Alice + consomme 1 ticket particulier.
2. **Cours COLLECTIF = inchangé** : reste sur créneaux fixes (ex vendredi soir) posés dans le calendrier / via les presets admin. Ne pas casser ce flux.
3. **Alice reçoit une NOTIFICATION sur TOUS les événements** : nouvelle réservation (collectif ET particulier),
   annulation, déplacement, no-show. Canal : email Brevo (`contact@yoga-sculpt.fr` → Alice) au minimum.
   (Option future : Telegram/push — pour l'instant email suffit.)

## Détail technique — créneau libre particulier
- Nouvelle logique dans `src/lib/reservation.ts` (ou un module `reservation-libre.ts`) : pour le type `particulier`,
  au lieu de lister des events existants, **générer les disponibilités** = plage 9h-21h sur N jours à venir,
  granularité à définir (ex: pas de 30 min, durée cours 60 min), **moins les busy** lus dans le Google Calendar
  d'Alice (utiliser l'API freebusy `calendar.freebusy.query` OU `listEvents` puis soustraire les chevauchements).
  Respecter le délai mini de réservation (cf collectif : 24h ? à confirmer — pour le particulier Robert n'a pas dit, garder 24h par défaut).
- Route : soit étendre `/api/creneaux?type=particulier` pour renvoyer les slots libres calculés, soit une route
  dédiée `/api/creneaux/particulier`. Réservation via `/api/reserver` (réutiliser : anti-double-booking via index
  unique partiel, insertEvent dans l'agenda d'Alice, décrément ticket, rollback fail-safe).
- ⚠️ Anti-chevauchement : deux clients ne doivent pas réserver le même horaire libre → l'event Google + le
  booking DB servent de verrou (le 2e tombe sur busy/conflit). Tester ce cas.
- UI client : `src/app/espace/reserver` doit proposer, pour le particulier, un **sélecteur de date + heure libre**
  (pas une liste de créneaux figés), avec les heures occupées grisées. Charte noir & or.

## Détail technique — notifications Alice
- Helper `src/lib/notify-alice.ts` (ou réutiliser le module Brevo existant des rappels) : `notifierAlice(event, payload)`.
- Brancher aux points : `/api/reserver` (résa créée), `/api/annuler` (annulation), admin déplacement/no-show.
- Email Brevo, expéditeur `contact@yoga-sculpt.fr`, destinataire = email d'Alice (`gdry.alice@gmail.com` ou var d'env
  `ALICE_NOTIFY_EMAIL`). Contenu : type d'event, client (nom/email/tél), créneau, type de cours, lieu.
- Idempotent / best-effort : un échec d'envoi de notif ne casse JAMAIS la réservation (try/catch, log).
- Émettre aussi un `user_events` correspondant (cf ticket tracking) si l'infra existe au merge.

## Fichiers concernés (PARTAGÉS avec l'agent calendrier — sérialiser)
- `src/lib/reservation.ts`, `src/lib/google-calendar.ts` (ajout freebusy si absent), `src/app/api/creneaux/**`,
  `src/app/api/reserver/route.ts`, `src/app/api/annuler/route.ts`, `src/app/espace/reserver/**`,
  `src/lib/notify-alice.ts` (nouveau).
- ⚠️ **Collision** : l'agent `feat/admin-calendrier` touche google-calendar/reservation/créneaux. Lancer CE
  chantier APRÈS son merge, sur une base à jour, sinon conflit sur reservation.ts.

## Impact
Business fort : débloque le cours particulier (60€, la formule la plus rentable) en self-service total, et donne
à Alice la visibilité temps réel sur son activité. Migration : probablement aucune (réutilise bookings/tickets) ;
si délai/durée configurables → petite table de config ou constantes. Additif, pas 💀.
