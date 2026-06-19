# [P3] QA sécu — Bornes métier absentes sur les créneaux admin (garde-fou, pas faille)

**Statut** : durcissement optionnel · **Qui** : agent · **Source** : QA sécu 2026-06-19 (axe #8 input validation)

## Problème
`src/app/api/admin/creneaux/lib.ts` (`creneauInputSchema` + `validerCoherence`) valide le FORMAT `HH:MM` et la cohérence fin>début, mais **aucune borne métier** : un admin peut poser un créneau à 03:00, ou de durée absurde. Ce n'est PAS une faille (route gatée `requireAdmin()`, seule Alice y accède, c'est SON agenda) — juste un garde-fou métier manquant qui éviterait une faute de frappe.

Note : la "résa libre particulier 9h-21h" mentionnée dans le brief n'existe PAS encore dans le code de staging — la branche `feat/resa-libre-particulier` ne touche que `Logo.tsx`/`YsMonogram.tsx` (et a une migration `0009` non mergée). Donc pas de surface "starts_at arbitraire" côté résa libre à auditer aujourd'hui. À re-auditer quand le moteur résa libre sera réellement câblé (valider les bornes 9h-21h serveur, hors indispos Alice, anti-chevauchement via l'index unique partiel prévu par la migration).

## Reco (faible priorité)
Ajouter des bornes au schéma créneau admin : heure dans une plage raisonnable (ex. 06:00-22:00), durée min/max. Cosmétique sécu.

## Ce qui est DÉJÀ solide (input validation)
- **Toutes les routes admin** (`api/admin/**`) : `requireAdmin()` en tête + zod `.strict()` partout, validation par `userId` UUID (jamais par email client). Crédit ticket borné **1..50 entier** (`users/_lib/validation.ts`), pas de négatif/énorme/décimal. Débit borné par solde réel (pas de solde négatif). Anti-auto-suspension admin.
- **auth-action** : l'email pour recovery/magic-link est relu serveur via GoTrue (`lireUtilisateur(userId)`), jamais pris d'un email fourni client.
- **checkout** : le client ne peut PAS choisir un price Stripe arbitraire (enum `formule` OU `priceId` vérifié `===` valeur d'env connue → anti price-à-0€). Zod `.strict()`, auth requise, quantité dérivée serveur.
- **reserver/annuler/move** : on ne réserve QUE contre un `creneauId` = event existant de l'agenda d'Alice (404 sinon), pas de `starts_at` client injectable (bornes lues depuis Google), anti-double-booking par index unique (23505→409), garde appartenance (403), garde 24h calculée sur `starts_at` lu en base, rollback fail-safe, concurrence par updates conditionnels.
- **cron** : `CRON_SECRET` timing-safe, fail-safe 503 si absent.
- **webhook Stripe** : HMAC-SHA256 Web Crypto, timing-safe, anti-replay 5min, idempotence sur `stripe_session_id`, `payment_status==="paid"` requis, fail-safe si secret absent.
- **Emails parrainage** : nom du parrain `escapeHtml()` avant injection HTML.
- **Secrets** : aucun `NEXT_PUBLIC_*` sensible (grep service_role/secret/stripe/brevo = vide), pas de secret loggé.

## Fichiers
`src/app/api/admin/creneaux/lib.ts`.
