# [P2] Growth — relance automatique des inactifs (réactivation après 1 séance ou compte dormant)

**Statut** : non fait · **Qui** : agent (déclenchable)

## Contexte
La machine d'acquisition + le rappel J-1/H-2 (avant un cours déjà réservé) sont couverts. Ce qui
manque, c'est le levier de **rétention/réactivation** : relancer les gens qui se sont inscrits ou ont
fait une séance mais ne reviennent pas. Pour une prof solo, **réactiver un inscrit dormant coûte ~0 €
et rapporte plus que d'acquérir un froid**. Aucun mécanisme de ce type aujourd'hui.

⚠️ Ne recoupe PAS les rappels J-1/H-2 (ceux-ci = avant un cours réservé). Ici c'est l'inverse :
relancer ceux qui n'ont RIEN de prévu.

Segments cibles (à partir des données déjà en base : `profiles`, `bookings`, `onboarding_responses`) :
1. **Inscrit jamais réservé** : `onboarding_completed = true` mais 0 booking après X jours
   → "Votre 1ère séance vous attend" (couplé au ticket bienvenue s'il existe).
2. **A fait 1 séance, pas revenu** : dernier booking > 21 j, pas de réservation future
   → "Ça fait un moment — on remet ça ?" + éventuel petit incitatif.
3. **Carte/ticket dormant** : tickets restants > 0 mais aucune réservation à venir
   → "Il vous reste N séances, ne les perdez pas" (surtout si expiration).

## Demande précise
- Étendre le **Cron Trigger Cloudflare** existant (`/api/cron`, déjà en place pour les rappels) avec
  un scan quotidien des segments ci-dessus. **Réutiliser** la plomberie cron + Brevo déjà livrée,
  ne pas en créer une nouvelle.
- **Idempotence + anti-spam** : colonne(s) `last_reactivation_sent_at` / type de relance envoyé, pour
  ne relancer chacun qu'une fois par fenêtre (ex. max 1 relance / 30 j / segment). Migration additive.
- Templates Brevo charte noir & or (skill `brevo` / `notifuse-templates`), version texte +
  désinscription, expéditeur `contact@yoga-sculpt.fr`.
- Garde-fou volume : Alice = prof solo, le volume est faible → privilégier la pertinence à la
  fréquence (mieux vaut 1 relance bien ciblée que du drip agressif).

## Fichiers concernés
`src/app/api/cron/route.ts` (scan + envoi), nouvelle migration `supabase/migrations/0007_*.sql`
(colonnes anti-rejeu), templates Brevo, `~/all-cron/yoga-sculpt/` si déclencheur externe (mais le
Cron Trigger CF est déjà la voie retenue).

## Impact
**Rétention / LTV.** Le levier le moins cher et souvent le plus rentable pour un solo : transformer
des inscrits/clients dormants en réservations récurrentes. P2 (après le ticket bienvenue, dont la
relance "jamais réservé" dépend en partie).
