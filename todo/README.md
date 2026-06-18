# TODO — Yoga Sculpt espace client (app.yoga-sculpt.fr)

> Index du backlog. Le moteur de réservation (A→G) est **livré en prod** (cf `done/`).
> Dernière MAJ : 2026-06-18.

## 🔴 À finir vite (reliquats de la mise en prod)

1. **`2026-06-18-smtp-brevo-auth.md`** — Mails d'auth : SMTP Brevo OK + templates poussés
   par API. Reste : vérifier que les sujets FR + le style noir & or sont bien actifs
   sur les 4 templates (le WAF Cloudflare devant l'API Supabase bloque sur la fréquence,
   pas le contenu → pousser espacé). Désactiver le tracking de clics Brevo est inutile
   depuis la page anti-prefetch `/auth/confirm` (le token n'est plus brûlé au prefetch).
2. **`2026-06-18-oauth-google-staging.md`** — Activer Google OAuth sur le projet Supabase
   staging (aujourd'hui : "400 provider not supported", seul le magic-link marche sur staging).
   En prod, Google OAuth marche déjà.

## 🟡 Features produit (`2026-06-18-features-produit-reservation.md`)
- **Rappels mail J-1/H-2** : code + Cron Trigger livrés. À VÉRIFIER en condition réelle
  (le cron tape `/api/cron` ; confirmer qu'il tourne et envoie via Brevo). Brancher le
  déclencheur tick→route si pas encore fait.
- **Parrainage** : livré. Reste l'anti-abus complet (IP + fingerprint + email jetable) à
  câbler dans `/api/parrainage/completer` (les libs existent, vérifier qu'elles sont actives).
- **Carte cadeau** (offrir une séance payée) — repoussé, à faire.
- **Ticket-contre-avis (5b)** — gated sur l'approbation de l'API GMB (quota à 0). À activer
  dès que GMB répond : match nom OAuth ↔ reviewer.displayName.
- **Sidebar shadcn** : livrée. Polir le responsive mobile (drawer) si besoin.

## 🟢 Nouveaux chantiers repérés cette session (à ticketer si on les prend)
- **E2E Stripe complet en mode test** : staging a les clés Stripe TEST + prix test. Écrire
  un E2E Playwright qui paie avec la carte 4242 → vérifie le crédit ticket via webhook
  (aujourd'hui l'E2E s'arrête à la page Checkout). Cf agent E2E existant.
- **"Mes réservations" : afficher le lieu** : le composant LieuMaps est prêt mais la page
  `reservations/page.tsx` ne charge pas le lieu Google (éviter N appels au render → batch).
- **Style mails d'auth** : si le WAF continue d'embêter, les coller via Dashboard Supabase.
- **Monitoring prod léger** : health-check `app.yoga-sculpt.fr` + alerte (le 500 du 1er
  déploiement serait passé inaperçu sans vérif manuelle). Optionnel vu le volume.
- **CSP enforce** sur le vitrine (report-only actuellement, cf todo du repo vitrine).
- **Google One Tap** (ticket #15 hérité) sur vitrine + app.

## 📂 Convention
Un fichier `.md` par sujet. Quand livré (avec preuve : SHA + prod vérifiée) → `git mv` vers `done/`.
