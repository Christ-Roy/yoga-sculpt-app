# Yoga Sculpt — Espace client

Espace client web de **Yoga Sculpt** (Alice Gaudry). App Next.js 16 (App Router,
TypeScript, Tailwind) + Supabase Auth, **séparée du site vitrine** yoga-sculpt.fr.

> ⚠️ Ne jamais lier cet espace depuis le site vitrine. Il vit seul.

## Démarrer

```bash
npm install
npm run dev   # http://localhost:3000
```

## Documentation

Tout est dans **[`SETUP.md`](./SETUP.md)** :

- Lancer / tester en local (flow magic link fonctionnel).
- Ce qui est déjà fait (DB + RLS + trigger + auth email).
- **Ce que Robert doit fournir** : creds OAuth Google + Microsoft (Phase 1),
  clés Stripe (Phase 2).
- Déploiement Cloudflare Workers via OpenNext (à venir, rien déployé).

## Stack

- Next.js 16 (App Router, `proxy.ts` = ex-middleware)
- `@supabase/ssr` + `@supabase/supabase-js` (REST/PostgREST, edge-compatible)
- Tailwind v4, fonts Anton + Inter, charte noir & or
- Cible déploiement : Cloudflare Workers (`@opennextjs/cloudflare`)
