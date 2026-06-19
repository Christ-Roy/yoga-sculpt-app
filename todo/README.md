# TODO — Yoga Sculpt espace client (app.yoga-sculpt.fr)

> Index du backlog. Le moteur de réservation (A→G) est **livré en prod** (cf `done/`).
> Tickets sur la branche `staging`. Quand un ticket est livré (preuve : SHA + code) → `git mv` vers `done/`.
> Dernière MAJ : 2026-06-19.

## 🔴 À finir vite (reliquats de la mise en prod)

1. **`2026-06-18-smtp-brevo-auth.md`** — Mails d'auth : SMTP Brevo OK + templates poussés.
   Reste (cosmétique, via DASHBOARD car WAF Management bloque le HTML stylé) : style noir & or
   des 4 templates + template `invite`. Login Supabase requis.
2. **`2026-06-18-oauth-google-staging.md`** — Activer Google OAuth sur le projet Supabase
   STAGING (aujourd'hui « 400 provider not supported », seul le magic-link marche sur staging).
   En prod, Google OAuth marche déjà.

## 🟡 Features produit (ouvertes)

- **`2026-06-18-features-produit-reservation.md`** — Backlog index. Livré : annulation 24h,
  rappels J-1/H-2 (à vérifier en réel), sidebar shadcn, parrainage. Reste : carte cadeau
  (repoussé), ticket-contre-avis 5b (gated approbation API GMB).
- **`2026-06-18-dashboard-widgets-et-dev-env.md`** — Dashboard à widgets (partiellement en
  place via les widgets espace) + env `npm run dev` hot-reload exposé Tailscale sur dev-pub.
- **`2026-06-19-onboarding-page-accueil-invitation-parrainage.md`** — Page d'accueil
  chaleureuse en début d'onboarding quand on arrive via un lien d'invitation (créé ce jour).
- **`2026-06-19-toasts-loaders-feedback-ux.md`** — Système de toasts + état loading unifié
  sur toutes les actions. **Dépend de** la décision « deux systèmes de boutons » (ci-dessous).
- **`2026-06-19-login-fond-flou.md`** — Image de fond floutée derrière le login (cosmétique premium).
- **`2026-06-19-cookie-cross-domain-vitrine.md`** — Scoper le cookie de session
  `Domain=.yoga-sculpt.fr` pour que `/api/session-status` réponde `authed:true` depuis le
  vitrine. Touche les fichiers auth sensibles (`server.ts` + `proxy.ts`) → décision + re-login forcé.

## 🟠 QA-cohérence UI / design system (findings lecture seule, non corrigés)

- **`2026-06-19-qa-ui-checkbox-var-gold-inexistante.md`** [P2] — 2 checkboxes admin sur
  `var(--gold)` (variable inexistante) → cases bleues/violettes au lieu d'or. Quick-win.
- **`2026-06-19-qa-ui-deux-systemes-de-boutons.md`** [P3] — `Button` maison vs `ui/button`
  shadcn coexistent. À trancher AVANT le ticket toasts (même cible : prop `loading`).
- **`2026-06-19-qa-ui-fiche-compte-status-filleul-brut.md`** [P3] — fiche compte admin affiche
  le statut filleul en brut (« pending »/« completed ») au lieu du FR.
- **`2026-06-19-qa-ui-insights-table-mobile.md`** [P3] — table « Par utilisateur » de
  `/admin/insights` sans version mobile (scroll horizontal 860px).

## 🔒 QA sécu (durcissement)

- **`2026-06-19-qa-secu-parrainage-anti-abus-farmable.md`** [P2] — **cap par parrain LIVRÉ**
  (commit cba2c2a, `REFERRAL_MAX_CREDITS`). Reste : crédit après séance HONORÉE (levier qui
  tue le farming), blocklist email dynamique + normalisation alias Gmail.
- **`2026-06-19-qa-secu-bornes-metier-creneaux-admin.md`** [P3] — bornes métier (06:00-22:00,
  durée min/max) sur le schéma créneau admin. Garde-fou optionnel, pas une faille (route gatée).

## ✅ Livré récemment → `done/`

- `2026-06-19-qa-ui-lieu-incoherent-dashboard.md` (commit 662dd1e — vrai lieu Google sur
  dashboard + mes réservations, `src/lib/booking-lieu.ts`, plus de `LIEU_COURS` en dur).
- `2026-06-19-qa-secu-open-redirect-auth-callback.md` (commit d873b13 — `safeInternalRedirect`
  dans `src/lib/auth-redirect.ts`, branché sur callback + confirm + checkout).
- `2026-06-19-onboarding-reprise-avancement-db.md` (commit e38add4 — migration 0014
  `onboarding_draft` + `saveOnboardingProgress`, reprise à l'étape exacte).
- `2026-06-19-onboarding-tient-sur-un-ecran-mobile.md` (commit e38add4 — chaque étape
  mobile-first, sans scroll).
- + tout le reste du moteur de résa et la vague QA-sécu/résa-libre (cf dossier `done/`).

## 📂 Convention
Un fichier `.md` par sujet. Quand livré (avec preuve : SHA + code/prod vérifié) → `git mv` vers `done/`.
