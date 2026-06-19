# [P3] Doc : `WEBHOOKS.md` référencé par le CLAUDE.md maître mais absent du repo app

**Statut** : non fait · **Qui** : agent (déclenchable)

## Contexte
Le CLAUDE.md maître du projet (`/home/brunon5/site-clients/alice-gaudry/CLAUDE.md`, §4) renvoie à un `WEBHOOKS.md` du repo app :
> "Webhook Cal.com : `/api/webhooks/cal` avec vérif HMAC-SHA256 edge... À configurer côté Cal (URL + `CALCOM_WEBHOOK_SECRET`) — cf `WEBHOOKS.md`."

**Deux problèmes :**
1. `WEBHOOKS.md` **n'existe pas** dans le repo app (vérifié : seuls `AGENTS.md`, `CLAUDE.md`, `DEPLOY.md`, `README.md`, `SETUP.md`).
2. Le webhook décrit (`/api/webhooks/cal` Cal.com) **n'existe plus** : Cal.com a été remplacé par le moteur de réservation maison (Google Calendar). Le seul webhook livré est `/api/webhooks/stripe`. Les vars `CALCOM_*` ont d'ailleurs été retirées du `wrangler.jsonc` (cf commit `32cdc82 chore(cleanup): retire les vars CALCOM`).

Le `CLAUDE.md` du repo app fait 11 octets (quasi vide), `AGENTS.md` 327 octets. La doc à jour vit dans `SETUP.md` / `DEPLOY.md` (vérifiés présents et récents) + le CLAUDE.md maître côté `alice-gaudry/`.

## Demande précise
Deux options (arbitrage team-lead) :
- **A (léger, recommandé)** : ne pas créer `WEBHOOKS.md`. À la place, corriger le §4 du CLAUDE.md maître `alice-gaudry/CLAUDE.md` : retirer la référence à Cal.com + `WEBHOOKS.md`, pointer vers `DEPLOY.md` / `SETUP.md` du repo app pour la config du webhook **Stripe** (`STRIPE_WEBHOOK_SECRET`, endpoint `/api/webhooks/stripe`). Vérifier que la config webhook Stripe est bien documentée dans `DEPLOY.md`/`SETUP.md` ; sinon l'y ajouter.
- **B** : créer un vrai `WEBHOOKS.md` dans le repo app documentant le webhook Stripe (URL, secret, événement `checkout.session.completed`, idempotence) et mettre à jour la référence côté maître.

Dans les deux cas : **supprimer toute mention résiduelle de Cal.com / webhook Cal** (mort).

## Fichiers concernés
- `/home/brunon5/site-clients/alice-gaudry/CLAUDE.md` (§4 — référence morte à corriger)
- `yoga-sculpt-app/DEPLOY.md` / `SETUP.md` (vérifier que le webhook Stripe y est documenté)
- éventuel `yoga-sculpt-app/WEBHOOKS.md` (option B uniquement)

## Impact
Doc seulement. Risque : un futur agent suit la référence morte, cherche un webhook Cal.com inexistant, perd du temps. Faible mais réel. Quick à corriger.
