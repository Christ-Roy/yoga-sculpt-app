# [P1] `/api/parrainage/completer` n'est jamais appelé côté UI → fingerprint du filleul + filet de complétion morts

**Statut** : non fait · **Qui** : agent (déclenchable)

## Contexte
`POST /api/parrainage/completer` est le **filet de sécurité fiable** du parrainage : appelé après l'inscription du filleul, il (a) enregistre ses signaux anti-abus **avec le fingerprint client** (le seul moment où on l'a), et (b) complète le parrainage si un code a été suivi (idempotent avec le callback). C'est explicitement désigné comme la voie robuste dans `auth/callback/route.ts` (le callback serveur, lui, n'a pas accès au fingerprint JS).

**Aucun code client n'appelle cette route.** Vérifié par grep : seules des mentions en commentaires/docstrings. Le `FingerprintCollector` pointe vers `/api/parrainage/fingerprint` (autre endpoint, inexistant — cf ticket dédié), pas vers `/completer`.

Conséquences :
- Le **fingerprint du filleul** n'est jamais transmis au moment de la complétion → la garde anti-abus R3 (même appareil) est privée de sa donnée même si le crédit avait lieu.
- Si le cookie `ys_ref` rate (cf ticket cookie : il n'est de toute façon pas posé aujourd'hui), il n'y a **aucun second appel** pour rattraper la complétion. Les deux voies de complétion sont donc mortes simultanément.

## Demande précise
Déclencher `POST /api/parrainage/completer` une fois, après l'inscription du filleul, avec le code suivi + le fingerprint.

Approche recommandée (à arbitrer par le team-lead, deux options) :

**Option A (préférée) — fusionner avec le FingerprintCollector.** Plutôt que deux endpoints, faire que le collector POST directement `/api/parrainage/completer` avec `{ code, fingerprint: components }` :
- lire le code depuis le cookie `ys_ref` (nécessite de le rendre lisible JS — donc PAS httpOnly — OU exposer le code autrement). ⚠️ Tension avec le ticket cookie qui recommande httpOnly pour le callback. Décision archi à prendre : soit deux cookies (un httpOnly pour le callback serveur, un lisible JS pour le client), soit le client lit `?ref=` directement dans l'URL au 1er chargement.
- `completer` accepte déjà `{ code?, fingerprint? }` (`bodySchema`) → contrat compatible sans changer le backend.
- Avantage : un seul endpoint, le fingerprint ET la complétion partent ensemble. Rend le ticket "fingerprint-endpoint-404" caduc (à coordonner).

**Option B — garder les deux endpoints séparés.** Créer l'endpoint fingerprint (ticket dédié) ET ajouter un appel `/completer` distinct (ex. au 1er montage de `/espace` ou en fin d'onboarding) avec le code lu du cookie/URL. Plus de surface, deux requêtes.

Dans les deux cas : appel **best-effort**, échec silencieux, une seule fois par session (garde type `sessionStorage`, comme le collector actuel). La réponse de `/completer` est toujours `200 { ok: true }` (ne rien afficher au filleul).

## Fichiers concernés
- `src/components/FingerprintCollector.tsx` (option A : rerouter + joindre le code)
- `src/app/api/parrainage/completer/route.ts` (contrat déjà bon, ne pas toucher le backend)
- `src/app/login/page.tsx` (cookie `ys_ref` — cf ticket cookie ; décider httpOnly vs lisible JS)
- coordination avec `2026-06-19-fingerprint-endpoint-404.md` et `2026-06-19-parrainage-ref-cookie-jamais-pose.md`

## Impact
**Bloquant business** (3e maillon du même flux parrainage cassé). Sans cet appel, même le cookie réparé ne suffit pas à transmettre le fingerprint au moment de la décision de crédit. À traiter en lot avec les deux autres tickets parrainage (P1) — c'est un seul flux à recâbler de bout en bout.
