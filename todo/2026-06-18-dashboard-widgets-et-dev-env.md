# Dashboard /espace à widgets + env `npm run dev` (Tailscale) pour peaufiner l'UI

> Déposé 2026-06-18 (demande Robert). Deux chantiers liés (UI espace client).

## 1. 🎨 Page `/espace` = vrai dashboard à WIDGETS
Aujourd'hui `/espace` est basique. Robert veut une page d'accueil de l'espace client avec
des **widgets** couvrant tout le compte :
- **Mes séances à venir** (prochaines réservations + bouton "Ajouter à l'agenda" / annuler)
- **Mes tickets / solde** (X collectif · Y particulier) + CTA "Prendre des tickets"
- **Réserver** (accès rapide au calendrier)
- **Parrainer un ami** (lien + nb de filleuls)
- **Offrir une séance à un ami** (carte cadeau — cf feature repoussée, à activer)
- (option) **Mon profil / onboarding**

Charte noir & or, responsive, réutilise la sidebar shadcn + les composants existants
(SoldeBadge, LieuMaps, AddToCalendar...). Server Components + données via les routes déjà
livrées (/api/creneaux, /api/parrainage, lecture tickets/bookings RLS).

## 2. 🔧 Env de dev hot-reload (`npm run dev`) exposé via Tailscale
But : itérer sur l'UI en LIVE (hot reload) sans redéployer Cloudflare à chaque tweak.
⚠️ **Règle R1 : PAS en local** (machine `mail` 7.6G sature). → tourne sur **dev-pub**
(Node 22.22, Tailscale IP `100.92.215.42`, ~2 G RAM libre / 11 G disk).

Setup :
- Cloner `yoga-sculpt-app` sur dev-pub.
- `.env.local` branché sur le **Supabase STAGING** (`htgbtckgkulwuyzfsvjq`) + clés staging
  (cf `.all-creds.env` → `YOGA_SCULPT_STAGING_SUPABASE_*`, `STRIPE_ALICE_GAUDRY_TEST_*`,
  Google Calendar SA + `YOGA_SCULPT_STAGING_CALENDAR_ID`).
- `npm run dev` (port ex 3000) exposé via Tailscale (`100.92.215.42:3000`) ou un
  Tailscale Funnel/serve si accès hors-VPN voulu.
- ⚠️ `next dev` ≠ runtime edge OpenNext à 100% (qq routes API edge peuvent différer), mais
  PARFAIT pour le polish UI (composants/layout/responsive/widgets). Pour valider le edge réel
  → toujours le déploiement staging Cloudflare.
- Idéal avec le **mode UI-polish** du skill team-orchestration (agent dev + agent reviewer Chrome
  sur l'URL Tailscale, boucle tweak→check).

## Ordre suggéré
Monter le dev-env Tailscale D'ABORD (pour voir en live), PUIS coder le dashboard widgets dessus
avec hot-reload.
