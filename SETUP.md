# Yoga Sculpt — Espace client · SETUP

Espace client (app web) **séparé du site vitrine**. Next.js 16 (App Router) +
Supabase Auth + Cloudflare Workers (cible déploiement, via OpenNext).

> ⚠️ Cet espace ne doit **JAMAIS** être lié depuis le site vitrine yoga-sculpt.fr.
> Il vit seul, sur `app.yoga-sculpt.fr` (déploiement à venir).

---

## 1. Lancer / tester en local

```bash
cd site-clients/yoga-sculpt-app
npm install        # si pas déjà fait
npm run dev        # → http://localhost:3000 (ou 3001 si 3000 occupé)
```

- `.env.local` est **déjà rempli** (Supabase). Gitignored, ne jamais commiter.
- Build de prod : `npm run build` (passe clean).

### Flow testable **dès maintenant** (sans OAuth)

1. Ouvrir `/login`.
2. Saisir un e-mail → **« Recevoir le lien de connexion »** (magic link Supabase).
3. Cliquer le lien reçu par mail → callback `/auth/callback` → onboarding.
4. Onboarding (4 questions) → écran final qui renvoie vers `/espace/reserver`.
5. `/espace` : profil éditable + accès réservation / mes réservations.

> ✉️ **SMTP** : par défaut Supabase utilise son SMTP intégré (très bas débit,
> ~2-3 mails/h, parfois en spam) — suffisant pour tester. Pour la prod,
> configurer un SMTP propre (Brevo) dans Supabase → **Auth → SMTP Settings**.
> Tant que ce n'est pas fait, on peut aussi tester en générant un magic link
> via l'Admin API (sans envoi de mail).

---

## 2. ✅ Déjà fait (par l'agent)

- **DB** (projet Supabase `esearpxflfgreejjxlfg`, région eu-west-3) :
  - Tables `profiles` + `onboarding_responses` créées.
  - **RLS activée** sur les deux (chaque user ne voit/modifie que ses lignes).
    _Vérifié : un anon ne lit aucune ligne._
  - Trigger `on_auth_user_created` → crée la ligne `profiles` à l'inscription.
    _Vérifié end-to-end : user créé → profil auto-créé._
  - Migration versionnée : `supabase/migrations/0001_init.sql`.
- **Auth Supabase** :
  - Email (magic link) **activé** et **testé**.
  - `uri_allow_list` configurée : `localhost:3000`, `localhost:3001`,
    `app.yoga-sculpt.fr` (callbacks + wildcard).
  - `site_url = http://localhost:3000` (à passer en prod, voir §5).
- **App** : login, callback, onboarding, espace (profil + mes réservations),
  réservation maison sur Google Calendar, achat de tickets Stripe, dashboard
  admin `/admin`, `middleware.ts` (refresh session + protection des routes),
  charte noir & or.

### Réservation = moteur maison (plus de Cal.com)

Cal.com a été **retiré** (juin 2026). La réservation repose désormais sur :

- **Google Calendar partagé** : Alice y pose ses créneaux (collectifs ET
  particuliers) et gère la capacité à la main (elle retire un créneau quand il
  est plein). Source de vérité des créneaux.
- **Service account Google** (`src/lib/google-calendar.ts`) : l'app lit les
  events futurs (`/api/creneaux`), ajoute/retire un attendee à la réservation/
  annulation (`/api/reserver`, `/api/annuler`). 100 % edge (Web Crypto + fetch,
  aucune dépendance Node).
- **Tickets Supabase** (`tickets` + `bookings`, migration `0002_booking.sql`) :
  réserver consomme un crédit ; annuler le restitue.
- **Stripe** : achat de carnets de tickets (cf. §4).
- **Routes API** : `/api/creneaux` (GET), `/api/reserver` (POST), `/api/annuler`
  (POST), `/api/checkout` (POST, Stripe), `/api/webhooks/stripe` (POST),
  `/api/ics/[bookingId]` (GET, export agenda).
- **UI** : `ReserverClient` (calendrier maison), `BuyTickets` (3 formules),
  `MesReservations`, dashboard admin sous `/admin`.

---

## 3. 🔑 CE QUE ROBERT DOIT FOURNIR — OAuth Google + Microsoft

Les boutons « Continuer avec Google / Microsoft » sont **déjà codés**. Ils
afficheront une erreur amicale (« méthode pas encore activée ») tant que les
providers ne sont pas configurés. Pour les activer :

### Redirect URI à configurer côté provider (Google Cloud / Azure)

Pour **les deux** providers, l'URL de callback OAuth est celle de **Supabase**
(pas celle de l'app) :

```
https://esearpxflfgreejjxlfg.supabase.co/auth/v1/callback
```

### A. Google

1. **Google Cloud Console** → créer un projet « Yoga Sculpt » → **APIs &
   Services → Credentials → Create OAuth client ID** → type **Web application**.
2. **Authorized redirect URIs** : coller
   `https://esearpxflfgreejjxlfg.supabase.co/auth/v1/callback`.
3. (Écran de consentement OAuth à remplir : nom de l'app, logo, scopes
   `email`, `profile`, `openid`.)
4. Récupérer **Client ID** + **Client secret**.
5. **Supabase Dashboard** → **Authentication → Sign In / Providers → Google**
   → activer → coller Client ID + Client secret → Save.
6. (Optionnel, le code envoie `prompt=consent` + `access_type=offline` pour
   obtenir un refresh token.)

> Les variables `GOOGLE_OAUTH_CLIENT_ID/SECRET` dans `.env.local` sont là pour
> mémoire ; **ce qui compte, c'est de les coller dans le dashboard Supabase**
> (Supabase gère l'échange OAuth, pas l'app).

### B. Microsoft (provider Supabase = **Azure**)

1. **Azure Portal → Microsoft Entra ID → App registrations → New
   registration** → nom « Yoga Sculpt ».
   - **Supported account types** : « Accounts in any organizational directory
     and personal Microsoft accounts » (pour accepter Outlook/Hotmail perso).
   - **Redirect URI** (Web) :
     `https://esearpxflfgreejjxlfg.supabase.co/auth/v1/callback`.
2. **Certificates & secrets → New client secret** → copier la **Value**.
3. Noter l'**Application (client) ID**.
4. **Supabase Dashboard** → **Authentication → Providers → Azure** → activer →
   coller Client ID + Secret. Laisser **Azure Tenant URL** vide (ou
   `https://login.microsoftonline.com/common`) pour accepter tous les comptes.

> Côté code, le provider est appelé `'azure'` (`signInWithOAuth({ provider:
> 'azure' })`) — c'est le nom Supabase pour Microsoft.

Une fois A et/ou B faits, **rien à changer dans le code** : les boutons
fonctionnent immédiatement.

---

## 4. 💳 Stripe — carnets de tickets

Modèle métier : l'utilisateur n'achète PAS une séance à l'acte, il achète des
**crédits de séances (tickets)**. Le code est déjà branché :

- `src/components/BuyTickets.tsx` — 3 formules ; POST `/api/checkout` avec
  `{ formule }` puis redirige vers l'URL Stripe (`session.url`). Si Stripe n'est
  pas configuré, l'API renvoie `{ ready: false }` → « Paiement bientôt disponible ».
- `src/app/api/checkout/route.ts` — crée une **Checkout Session** Stripe
  (`mode=payment`) via l'API REST en `fetch` (edge-compatible, **pas** le SDK
  Node), reliée au user par `client_reference_id` + `metadata`.
- `src/app/api/webhooks/stripe/route.ts` — sur `checkout.session.completed`,
  vérifie la signature (`STRIPE_WEBHOOK_SECRET`, HMAC-SHA256 timing-safe +
  anti-replay) puis crédite la table `tickets`. **Le crédit ne se fait jamais
  au checkout** (paiement pas encore confirmé), uniquement au webhook.

**À fournir par Robert** : les clés du compte Stripe Yoga Sculpt →
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, et les price IDs des formules
`STRIPE_PRICE_COLLECTIF`, `STRIPE_PRICE_PARTICULIER`, `STRIPE_PRICE_CARTE10`
(produits créés dans le compte Stripe d'Alice, l'app les lit, ne les crée pas).
`STRIPE_PUBLISHABLE_KEY` est optionnelle (réservée à un futur Stripe.js).

> ⚠️ **Cloudflare Workers (edge)** : ne jamais brancher le SDK Stripe Node lourd.
> On parle à Stripe uniquement via l'**API REST en `fetch`** (form-urlencoded).
> Détail documenté en commentaire dans `checkout/route.ts`.

---

## 5. 🚀 Déploiement (Cloudflare Workers via OpenNext) — À VENIR, rien de déployé

Décision actée : déploiement sur **Cloudflare Workers** via `@opennextjs/cloudflare`
sur **app.yoga-sculpt.fr**. Construit edge-ready (aucune dépendance Node-only ;
on parle à Supabase uniquement via REST/PostgREST en `fetch`).

Fichiers déjà prêts : `open-next.config.ts`, `wrangler.jsonc`
(`nodejs_compat`, name `yoga-sculpt-app`).

**Quand on déploiera (NE PAS exécuter maintenant) :**

```bash
# Build OpenNext + déploiement Workers
npx opennextjs-cloudflare build
npx wrangler deploy          # ou: npx opennextjs-cloudflare deploy

# Secrets (jamais commités) — à pousser via `wrangler secret put` :
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put GOOGLE_CALENDAR_SA_KEY   # JSON service account (1 ligne)
npx wrangler secret put GOOGLE_CALENDAR_ID
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put STRIPE_PRICE_COLLECTIF
npx wrangler secret put STRIPE_PRICE_PARTICULIER
npx wrangler secret put STRIPE_PRICE_CARTE10
npx wrangler secret put ADMIN_EMAILS             # CSV des emails admin (/admin)
# Les NEXT_PUBLIC_* peuvent aller dans [vars] de wrangler.jsonc.
```

**À faire au moment du déploiement** :
1. Créer le DNS `app.yoga-sculpt.fr` (CNAME/route Workers) — **pas encore fait**.
2. Supabase → **Authentication → URL Configuration** : passer `site_url` à
   `https://app.yoga-sculpt.fr` (laisser localhost dans l'allow list pour le dev).
3. Vérifier que la redirect URI Supabase reste inchangée côté Google/Azure.

---

## 6. Arborescence

```
src/
  middleware.ts                 # Next 16 : refresh session + protection des routes
                                #   (PAS proxy.ts — incompatible OpenNext)
  lib/
    supabase/{client,server,proxy,service}.ts  # service.ts = client service_role
    onboarding.ts               # définition des 4 questions
    google-calendar.ts          # accès API Google Calendar (service account, edge)
    reservation.ts              # logique métier PURE (creneaux/types/attendees)
    calendar-export.ts          # génération .ics (VALARM J-1 / H-2)
    db-types.ts                 # types Booking / Ticket / TicketType
    admin.ts                    # requireAdmin() (garde serveur /admin)
    admin-data.ts · admin-format.ts            # données + formatage du dashboard
  components/                   # Logo, Button, AppHeader, SignOutButton, Toast,
                                #   ReserverClient, BuyTickets, MesReservations,
                                #   AddToCalendar, admin/*
  app/
    page.tsx                    # routeur (login / onboarding / espace selon état)
    login/                      # page + LoginForm + actions (magic link, OAuth, signout)
    auth/callback/route.ts      # exchangeCodeForSession
    onboarding/                 # flow 4 étapes + écran final → /espace/reserver
    espace/                     # dashboard + ProfileCard + reserver/ + reservations/
    admin/page.tsx              # dashboard Alice (KPIs, créneaux, réservations)
    api/
      creneaux/route.ts         # GET  créneaux réservables (Google Calendar)
      reserver/route.ts         # POST réserver (attendee Google + ticket)
      annuler/route.ts          # POST annuler une réservation
      checkout/route.ts         # POST Stripe Checkout (carnet de tickets)
      webhooks/stripe/route.ts  # POST webhook Stripe (crédite les tickets)
      ics/[bookingId]/route.ts  # GET  export .ics d'une réservation
supabase/migrations/{0001_init.sql, 0002_booking.sql}
open-next.config.ts · wrangler.jsonc
```
