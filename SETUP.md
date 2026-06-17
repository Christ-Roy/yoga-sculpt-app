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
4. Onboarding (4 questions) → écran final (Cal.com + ticket).
5. `/espace` : profil éditable + réservation.

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
- **App** : login, callback, onboarding, espace, route checkout (stub),
  proxy (protection des routes), charte noir & or.

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

## 4. 💳 Phase 2 — Stripe (ticket séance)

Aujourd'hui : bouton « Réserver une séance — 25 € » → page `/espace/reserver`
(« Paiement bientôt disponible »). Tout est isolé pour brancher Stripe sans
refacto :

- `src/components/BuyTicketButton.tsx` — déjà câblé : si `/api/checkout` renvoie
  `{ url }`, il redirige vers Stripe Checkout. Sinon → page placeholder.
- `src/app/api/checkout/route.ts` — **stub commenté** avec le pseudo-code complet.

**À fournir par Robert (phase 2)** : les clés du compte Stripe Yoga Sculpt →
`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_PRICE_SEANCE` (price ID
du ticket), `STRIPE_WEBHOOK_SECRET`. Variables déjà présentes (vides) dans
`.env.local`.

> ⚠️ **Cloudflare Workers (edge)** : ne pas brancher le SDK Stripe Node lourd.
> Utiliser l'**API REST Stripe en `fetch`** (recommandé) ou le SDK en mode
> `createFetchHttpClient()`. Le détail est documenté en commentaire dans
> `route.ts`. Prévoir aussi un webhook `/api/webhooks/stripe` pour créditer le
> ticket en base après paiement.

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

# Secrets (jamais commités) :
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
# ... + clés Stripe en phase 2
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
  proxy.ts                      # Next 16 : remplace middleware.ts (refresh session + protection)
  lib/
    supabase/{client,server,proxy}.ts
    onboarding.ts               # définition des 4 questions
    booking.ts                  # URL Cal.com + prix ticket
  components/                   # Logo, Button, AppHeader, SignOutButton, BuyTicketButton
  app/
    page.tsx                    # routeur (login / onboarding / espace selon état)
    login/                      # page + LoginForm + actions (magic link, OAuth, signout)
    auth/callback/route.ts      # exchangeCodeForSession
    onboarding/                 # flow 4 étapes + écran final (Cal.com + ticket)
    espace/                     # dashboard + ProfileCard + reserver/ (placeholder Stripe)
    api/checkout/route.ts       # stub Stripe (phase 2)
supabase/migrations/0001_init.sql
open-next.config.ts · wrangler.jsonc
```
