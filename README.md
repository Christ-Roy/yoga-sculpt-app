# Yoga Sculpt — Espace client

Espace client web de **Yoga Sculpt** (Alice Gaudry). App Next.js 16 (App Router,
TypeScript, Tailwind) + Supabase Auth, **séparée du site vitrine** yoga-sculpt.fr.

> ⚠️ Ne jamais lier cet espace depuis le site vitrine. Il vit seul.

## Démarrer

```bash
npm install
npm run dev   # http://localhost:3000
```

## Ce que fait l'app

- **Auth** Supabase : magic link e-mail + OAuth Google + Microsoft (Azure).
- **Onboarding** 4 questions → écran de fin qui renvoie vers la réservation.
- **Réservation maison** : Alice pose ses créneaux dans un **Google Calendar
  partagé** ; l'app les lit/écrit via un **service account** Google
  (`src/lib/google-calendar.ts`, 100 % edge, zéro dépendance Node). Réserver =
  s'inscrire comme attendee de l'event Google + consommer un ticket.
- **Carnets de tickets (Stripe)** : l'utilisateur achète des crédits de séances
  (Checkout Stripe via API REST en `fetch`, edge-compatible) ; le crédit réel est
  appliqué dans le webhook Stripe sur `checkout.session.completed`.
- **Dashboard admin** `/admin` (réservé à Alice + Robert via `ADMIN_EMAILS`,
  garde serveur `requireAdmin()`) : KPIs, créneaux à venir avec inscrits, dernières
  réservations.
- Export `.ics` d'une réservation (rappels J-1 et H-2).

> ℹ️ **Cal.com a été retiré** (juin 2026) au profit de ce moteur maison sur
> Google Calendar + Stripe.

## Documentation

Détails (setup local, OAuth, déploiement, arborescence) dans
**[`SETUP.md`](./SETUP.md)**.

## Stack

- Next.js 16 (App Router, `middleware.ts` pour le refresh de session + protection
  des routes — **pas** `proxy.ts`, incompatible OpenNext).
- `@supabase/ssr` + `@supabase/supabase-js` (REST/PostgREST, edge-compatible).
- Tailwind v4, fonts Anton + Inter, charte noir & or.
- Cible déploiement : Cloudflare Workers (`@opennextjs/cloudflare`).
