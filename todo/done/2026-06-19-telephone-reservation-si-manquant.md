# [P2] Demander le téléphone à la réservation si absent du profil

**Statut** : à faire (après merge agent mobile) · **Qui** : agent · **Source** : demande Robert 2026-06-19

## Besoin
Robert : récupérer le tél client soit au paiement Stripe (FAIT — autre ticket/agent :
phone_number_collection + webhook range profiles.phone), soit **à la RÉSERVATION quand
le profil n'a pas de téléphone enregistré**.

## À faire
- Au moment de réserver (`src/components/ReserverClient.tsx` + flux `/api/reserver`), si
  `profiles.phone` est vide → demander le numéro AVANT de confirmer la réservation (petit
  champ tél, validé via le helper `src/lib/phone.ts` créé par le volet paiement).
- Le numéro saisi → rangé sur `profiles.phone` (le serveur le persiste à la réservation).
- Si le profil a déjà un tél → ne rien demander.
- Réutiliser le helper de validation/normalisation `src/lib/phone.ts` (créé au volet Stripe).

## ⚠️ Pourquoi pas tout de suite
Touche `ReserverClient.tsx` (UI) que l'agent responsive mobile refond en parallèle →
collision. À lancer UNIQUEMENT après merge de l'agent mobile sur staging.

## Fichiers
`src/components/ReserverClient.tsx` (champ tél conditionnel), `src/app/api/reserver/route.ts`
(persister le tél saisi), `src/lib/phone.ts` (réutilisé). Tests.
