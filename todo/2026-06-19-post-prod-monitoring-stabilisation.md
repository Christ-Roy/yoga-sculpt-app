# [P1] Post-prod — surveillance & stabilisation des features fraîchement déployées

**Statut** : à faire · **Qui** : agent + Robert · **Source** : mise en prod 2026-06-19

## Contexte
Le 2026-06-19 on a poussé en prod un GROS lot (back-office admin, moteur résa maison,
parrainage, invitation, fix paiement 0015) jamais éprouvé en conditions réelles prod.
Les 5 comptes prod actuels sont des comptes de test (Robert/Alice/Veridian) — pas encore
de vrai client. Fenêtre idéale pour stabiliser AVANT le premier vrai utilisateur.

## À faire — surveillance
1. **Parcours de bout en bout en prod réelle** (Robert/Alice) : login Google + magic-link,
   onboarding complet, réservation collectif (dim 19h) + particulier libre, annulation 24h,
   **achat réel d'un ticket en LIVE** (petite somme, quitte à rembourser) → vérifier le crédit
   ticket via le webhook live (c'est le point critique business « on paye → on reçoit »).
2. **Surveiller les logs prod** quelques jours : `wrangler tail yoga-sculpt-app` (logger
   structuré JSON déjà en place). Repérer toute erreur récurrente (webhook, résa, auth).
3. **Health-check léger** `app.yoga-sculpt.fr` : un check périodique + alerte (le 1er 500
   du déploiement initial était passé inaperçu sans vérif manuelle). Cf all-cron.
4. **Vérifier le cron rappels en prod** : CRON_SECRET posé, le Cron Trigger CF (*/15) tape
   bien /api/cron et envoie via Brevo. Confirmer qu'un rappel J-1/H-2 part réellement.

## À faire — nettoyage prod
5. Retirer le secret résiduel **`CALCOM_API_KEY`** du Worker prod (Cal.com retiré, le code
   ne le lit plus) : `wrangler secret delete CALCOM_API_KEY --env production`. Cosmétique.
6. Vérifier que le **CTA vitrine « Mon espace »** s'active bien maintenant que
   /api/session-status répond en prod (200) — tester connecté depuis yoga-sculpt.fr.

## Référence
Migrations prod à jour jusqu'à 0016. Stripe LIVE actif (compte yoga-sculpt.fr d'Alice,
webhook live → app.yoga-sculpt.fr). Cf [[2026-06-19-obs-logs-structures-legers]].
