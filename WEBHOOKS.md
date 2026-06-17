# Webhooks — Yoga Sculpt Espace client

## Cal.com → `/api/webhooks/cal`

L'app expose un endpoint qui reçoit les événements de réservation Cal.com
(réservation créée, annulée, déplacée…) et réagit côté app (DB, mail, etc.).

- **Route** : `src/app/api/webhooks/cal/route.ts` (POST).
- **URL prod** : `https://app.yoga-sculpt.fr/api/webhooks/cal`
  _(disponible une fois l'app déployée sur Cloudflare Workers)._
- **Sécurité** : chaque requête est authentifiée par **signature HMAC-SHA256**
  (header `X-Cal-Signature-256`). Une requête sans signature valide est
  rejetée en **401**. La vérification utilise **Web Crypto** (`crypto.subtle`),
  compatible avec le runtime Cloudflare Workers (pas le module `crypto` de Node).

### ⚠️ Deux secrets Cal.com DIFFÉRENTS — ne pas confondre

| Variable | Rôle | Sens | Où l'obtenir |
|---|---|---|---|
| `CALCOM_API_KEY` | Appeler l'**API** Cal.com depuis l'app | sortant | Cal → Settings → Developer → API Keys |
| `CALCOM_WEBHOOK_SECRET` | **Vérifier la signature** des webhooks entrants | entrant | Chaîne **que tu génères** et que tu colles dans le webhook Cal |

`CALCOM_WEBHOOK_SECRET` n'est **pas** la clé API. C'est un secret de signature
arbitraire : on le génère, on le met des deux côtés (app + Cal.com), et Cal s'en
sert pour signer chaque payload.

---

### Configuration côté Cal.com (à faire par Robert, app déployée)

1. **Générer le secret de signature** (en local) :

   ```bash
   openssl rand -hex 32
   ```

   Copier la valeur produite (ex: `a1b2c3…`).

2. **Cal.com** → **Settings → Developer → Webhooks → New Webhook** (ou, sur un
   event type précis, l'onglet **Advanced → Webhooks**) :
   - **Subscriber URL** : `https://app.yoga-sculpt.fr/api/webhooks/cal`
   - **Secret** : coller la valeur générée à l'étape 1.
   - **Event Triggers** : cocher au minimum
     - `Booking Created`
     - `Booking Cancelled`
     - `Booking Rescheduled`
     - (optionnel) `Booking Requested`, `Booking Rejected`, `Meeting Ended`…
   - **Payload template** : laisser le template par défaut (l'app lit
     `triggerEvent` + `payload`).
   - Activer le webhook.

3. **Donner le même secret à l'app** :

   ```bash
   # En prod (Cloudflare Workers) :
   npx wrangler secret put CALCOM_WEBHOOK_SECRET
   # → coller la même valeur qu'à l'étape 1.
   ```

   En local (dev), renseigner `CALCOM_WEBHOOK_SECRET` dans `.env.local`.

4. **Tester** : depuis Cal.com, bouton **"Ping"** / **"Test"** du webhook, ou
   créer une vraie réservation de test. Vérifier les logs du Worker
   (`npx wrangler tail`) : on doit voir `[webhook:cal] BOOKING_CREATED …`.
   Une signature absente/incorrecte renvoie `401` (c'est le comportement
   attendu — preuve que la vérification fonctionne).

---

### Événements gérés (état actuel)

Le handler vérifie la signature puis route sur `triggerEvent`. Pour l'instant
chaque cas **log proprement** et porte un `TODO` métier — la logique réelle
(enregistrement DB, notifications) sera implémentée cas par cas :

| `triggerEvent` | Action prévue (TODO) |
|---|---|
| `BOOKING_CREATED` | Enregistrer la réservation en DB (lier au profil via email) + notifier |
| `BOOKING_CANCELLED` | Marquer annulée en DB + notifier |
| `BOOKING_RESCHEDULED` | Mettre à jour les dates en DB + notifier |
| `BOOKING_REQUESTED` | État "pending" (si l'event exige approbation) |
| `BOOKING_REJECTED` | Nettoyer le "pending" + notifier |
| `BOOKING_PAID` / `BOOKING_PAYMENT_INITIATED` | Rapprocher du paiement (phase 2 Stripe) |
| `MEETING_STARTED` / `MEETING_ENDED` | Suivi de présence / relance |

Les événements non listés sont **acquittés (200)** sans traitement (évite que
Cal.com ne re-tente en boucle) et loggés pour visibilité.

---

## Stripe → `/api/webhooks/stripe` (PHASE 2 — pas encore implémenté)

Prévu en phase 2 pour créditer un "ticket séance" après paiement. Vérification
de signature via `STRIPE_WEBHOOK_SECRET` (header `Stripe-Signature`). Voir le
pseudo-code dans `src/app/api/checkout/route.ts` et SETUP.md §4.
