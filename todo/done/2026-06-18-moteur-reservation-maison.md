# Moteur de réservation maison (remplace Cal.com)

> Décision Robert 2026-06-18 : on dégage Cal.com (intégration iframe ratée),
> on construit un moteur de résa maison sur Google Calendar + Supabase + Stripe.
> Runtime = Cloudflare Workers (edge, OpenNext) → TOUT en Web Crypto + fetch,
> ZÉRO dépendance Node (pas de `googleapis`, pas de SDK Stripe Node).

## Ressources prêtes
- Google Calendar : service account dédié, clé JSON `~/credentials/yoga-sculpt/calendar-sa.json`
  - calendarId : `YOGA_SCULPT_CALENDAR_ID` (.all-creds.env)
  - SA email : `yoga-sculpt-calendar@yoga-sculpt-auth.iam.gserviceaccount.com` (owner du cal)
- Supabase projet `esearpxflfgreejjxlfg` (tables profiles/onboarding existantes, RLS + trigger)
- Stripe = compte d'Alice (clés sk_live/pk_live fournies). Tickets achetés sur l'app.

## Règle places collectif (V1, simple)
Pas de quota auto. Alice gère la capacité À LA MAIN : elle retire/ferme un créneau
dans son Google Agenda quand c'est plein. Un créneau est réservable tant qu'il
existe dans le calendrier. On garde : anti-double-booking par user + affichage du
nombre d'inscrits (pour qu'Alice voie le remplissage).

## Lots
- A : lib `src/lib/google-calendar.ts` (JWT RS256 Web Crypto → token → REST list/insert/delete/patch)
- B : migration `0002_booking.sql` (tickets + bookings + RLS) + types TS
- C : Stripe edge — `/api/checkout` réel + `/api/webhooks/stripe` (signature Web Crypto)
- D : moteur résa — `/api/creneaux`, `/api/reserver`, `/api/annuler`
- E : UI — calendrier maison (charte noir & or), solde tickets, mes résas, annulation
- F : dashboard Alice (créneaux + résas + remplissage + CA)
- G : nettoyage Cal.com (embed, webhook cal, lib booking, deps) + MAJ docs/CLAUDE.md
