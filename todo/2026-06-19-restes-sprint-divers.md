# [P3] Restes du sprint 2026-06-19 (repérés, pas eu le temps)

**Statut** : à faire · **Qui** : agent · **Source** : récap fin de sprint 2026-06-19

Petits chantiers vus passer pendant le sprint mise-en-prod, sans impact bloquant, à traiter
quand on a un moment. Un par item, à éclater en tickets dédiés si l'un grossit.

## Fiabilité / UX
- **Flash « This page couldn't load » sur `/admin/reservations`** (cf
  [[2026-06-19-qa-ui-...]] / observé en réel) : à la 1ère navigation client-side l'écran
  d'erreur Next apparaît (fetch RSC qui rate), OK au reload. Ajouter error boundary + retry,
  ou fiabiliser le data fetch (Google/réservations) pour éviter le timeout intermittent.
- **Couverture E2E annulation** : l'annulation (réserve → annule → ticket restitué, et
  <24h refusé) est testée UNITAIREMENT mais pas en Playwright. À ajouter au harnais e2e si
  on veut le cycle complet bout-en-bout (Robert avait dit : l'unitaire suffit pour l'instant).

## Observabilité
- **Logger : migrer les 82 `console.*` restants** (admin/*, events, relance, reminders,
  attendance, anti-abuse, welcome-ticket, routes creneaux/parrainage/ics) vers `createLogger`.
  Les 9 chemins critiques sont faits ([[2026-06-19-obs-logs-structures-legers]]), le reste
  est non prioritaire mais à finir pour une obs homogène.
- **Brancher les logs sur un collecteur** (Grafana Cloud / Logpush) le jour où on veut de
  l'obs prod réelle. Le format JSON est déjà prêt. Décision Robert : pas maintenant.

## Copy / contenu (à valider avec Alice)
- **Copy de la page `/invitation`** : titre, accroche « le yoga c'est plus sympa entre
  ami(e)s », les 2 bénéfices — volontairement nuancés (consigne « ne pas sur-affirmer »).
  Ajuster avec le wording exact qu'Alice veut.
- Coup d'œil **mobile** sur /invitation + onboarding avant d'exposer largement le parrainage.

## Staging
- `BREVO_API_KEY` / `CRON_SECRET` volontairement absents du Worker staging (pas de mail de
  test, env public anti-spam — décision Robert). Garder ainsi. Documenté.
- Indexer `STRIPE_ALICE_GAUDRY_TEST_PRICE_CARTE10` (price_1Tjm23...) dans `.all-creds.env`
  (le prix existe, juste pas indexé sous ce nom). Cosmétique.

## Dette connue (non urgente)
- 4 vulns Dependabot = devDeps (esbuild/postcss/ws), jamais dans le runtime Worker servi.
  Documenté, non appliqué (fixes breaking). Cf repo public README.
