# Webhooks — Yoga Sculpt espace client

Inventaire des webhooks **entrants** que l'app expose et de leur configuration.
Source de vérité : le code dans `src/app/api/webhooks/`. Ce fichier décrit ce qui
existe réellement, pas ce qui est supposé.

> ℹ️ **Pas de webhook Cal.com.** Cal.com a été retiré (juin 2026) au profit du
> moteur de réservation maison sur Google Calendar (cf. `SETUP.md` §2). L'ancien
> endpoint `/api/webhooks/cal` n'existe plus. **Le seul webhook livré est Stripe.**
> Le calendrier, lui, est lu/écrit en *pull* via l'API Google Calendar (service
> account, `src/lib/google-calendar.ts`) — Google ne nous envoie aucun webhook.

---

## 1. Stripe — `POST /api/webhooks/stripe`

Fichier : [`src/app/api/webhooks/stripe/route.ts`](./src/app/api/webhooks/stripe/route.ts)

Reçoit les événements de paiement Stripe et **crédite les carnets de tickets**
(table `tickets`) quand un achat aboutit. C'est le seul endroit où un crédit est
appliqué : jamais au moment du checkout (le paiement n'y est pas encore confirmé).

### Événement traité

| Événement Stripe | Traitement |
|---|---|
| `checkout.session.completed` | Si `payment_status === "paid"` (ou absent), crédite `tickets` à partir de `metadata.user_id` / `metadata.type` / `metadata.quantite` (fallback `client_reference_id` pour le user). |
| (tout autre type) | ACK `200` sans action (log seulement), pour éviter les retries en boucle. |

`GET` sur ce endpoint renvoie `405` (Stripe n'appelle qu'en `POST`).

### Sécurité — vérification de signature (obligatoire)

- Header `Stripe-Signature` de la forme `t=<ts>,v1=<hex>[,v1=<hex>...]`.
- « Signed payload » = `` `${t}.${rawBody}` `` (le **corps brut**, pas un JSON
  re-sérialisé). HMAC-SHA256 avec `STRIPE_WEBHOOK_SECRET`, comparé en **timing-safe**
  à `v1`. Rejet `400` si invalide.
- **Anti-replay** : rejet `400` si l'horodatage `t` s'écarte de plus de **5 min**
  de l'heure courante (`SIGNATURE_TOLERANCE_SECONDS`).
- Si `STRIPE_WEBHOOK_SECRET` est absent : rejet `500` (fail-safe — un webhook non
  vérifié est une porte non authentifiée, on refuse de traiter).
- Plusieurs `v1` (rotation de secret côté Stripe) : on prend le premier.

### Idempotence

Stripe peut rejouer un webhook (retries, doublons réseau). Le crédit est un
`upsert` sur la table `tickets` avec `onConflict: "stripe_session_id"` +
`ignoreDuplicates: true` → une même session de paiement ne crédite **jamais** deux
fois. Repose sur l'index `UNIQUE(stripe_session_id)` posé par la migration
`0002_booking.sql` (Lot B).

### Codes de réponse

| Code | Cas |
|---|---|
| `200 { received: true }` | Traité (ou événement non géré, ACK volontaire). |
| `400` | Signature absente/invalide/expirée, ou JSON illisible. |
| `405` | Méthode `GET` (endpoint POST-only). |
| `500` | `STRIPE_WEBHOOK_SECRET` manquant, ou échec d'écriture DB → Stripe re-tente (l'upsert idempotent rend le rejeu sans danger). |

### Runtime

Cloudflare Workers (edge, via OpenNext). HMAC en **Web Crypto** (`crypto.subtle`)
uniquement — jamais le module `crypto` de Node (indisponible sur Workers).
Écriture DB via le client Supabase `service_role` (bypass RLS, pas de session
cookie ici), `createServiceClient()` de `src/lib/supabase/service.ts`.

### Configuration

1. **Côté Stripe** (Dashboard → Developers → Webhooks → Add endpoint) :
   - URL : `https://app.yoga-sculpt.fr/api/webhooks/stripe`
   - Événement à abonner : **`checkout.session.completed`** (suffisant).
   - Stripe génère un **signing secret** (`whsec_...`).
2. **Côté app** — pousser ce secret sur le Worker (jamais commité) :
   ```bash
   npx wrangler secret put STRIPE_WEBHOOK_SECRET --env production
   # (et --env staging si on teste les paiements en staging)
   ```
   Variable documentée dans `.env.example` (`STRIPE_WEBHOOK_SECRET`), procédure
   complète des secrets dans `DEPLOY.md` §4.

> ⚠️ `STRIPE_WEBHOOK_SECRET` (signing secret `whsec_...`) est **différent** de la
> clé secrète API `STRIPE_SECRET_KEY` (`sk_...`). Ne pas confondre.

---

## 2. Pas d'autre webhook

`src/app/api/webhooks/` ne contient que `stripe/`. Les autres routes `/api/*`
(`creneaux`, `reserver`, `annuler`, `checkout`, `ics/[bookingId]`, `cron`,
`parrainage/*`) ne sont **pas** des webhooks tiers : elles sont appelées par
l'app elle-même ou par le Cron Trigger Cloudflare (`/api/cron`, protégé par
`CRON_SECRET`), pas par un service externe signant ses requêtes.
