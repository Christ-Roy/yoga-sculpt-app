# [P0 — BLOQUANT LANCEMENT ADS] L'upload conversion utilise une API fermée → migrer vers Data Manager API

**Statut** : 🔴 BLOQUANT · **Qui** : agent · **Source** : test E2E réel 2026-06-19 (avant lancement Ads)

## Le problème (découvert en test E2E réel sur prod)
La chaîne d'attribution est parfaite en amont (gclid capté vitrine → cookie cross-domain
`.yoga-sculpt.fr` → rangé sur profil au callback → conversion `purchase` écrite au webhook
Stripe → drain). **MAIS le dernier maillon échoue** : l'upload à Google Ads renvoie

> `New integrations for uploading click conversions should use the Data Manager API.
>  Usage of ConversionUploadService.UploadClickConversions is limited to existing users.`

→ Google a **fermé l'ancienne API** `ConversionUploadService.UploadClickConversions` aux
nouveaux comptes. Le compte Yoga Sculpt (`6478938833`) est neuf → il DOIT utiliser la
**Data Manager API** (https://developers.google.com/data-manager/api/devguides/events/google-ads/offline).

Vérifié en réel : `drainAdsConversions` → `failed: 1`, `upload_error` = le message ci-dessus.
La ligne reste `pending` (re-tentée → ré-échouera tant que pas migré). AUCUNE conversion ne
remonte à Google aujourd'hui.

## Conséquence business
🔴 **NE PAS lancer Google Ads avant ce fix** : on paierait des clics sans qu'AUCUNE conversion
d'achat ne remonte → Smart Bidding aveugle, budget gaspillé, pas de mesure du ROI.
Pas de fallback : le gtag vitrine ne fait que du remarketing (`aw_remarketing_only`), pas de
conversion d'achat ; et le paiement est sur app. (pas la vitrine) sans tag conversion client.

## À faire
Migrer `src/lib/google-ads.ts` (`uploadClickConversion`, endpoint
`googleads.googleapis.com/v23/customers/{id}:uploadClickConversions`, l.119) vers la
**Data Manager API** :
- Nouvel endpoint Data Manager (`datamanager.googleapis.com` — vérifier la ref exacte +
  la version + le scope OAuth requis, possiblement différent de `adwords`).
- Nouveau format de payload (events / userData / clickConversion selon la doc Data Manager).
- Réutiliser l'auth existante (refresh_token / developer_token) si le scope le permet, sinon
  régénérer un refresh_token avec le scope Data Manager.
- Garder le reste INTACT : la chaîne 1→4 marche (capture, cross-domain, profil, écriture
  conversion, idempotence, drain best-effort). Seul `uploadClickConversion` change.
- Adapter `__tests__/lib/ads-attribution.test.ts` (le test mocke l'upload — adapter au nouveau
  contrat) + idéalement re-tester en réel sur prod (1 conversion test → vérifier `uploaded=true`).

## Ce qui est VALIDÉ (ne pas y retoucher) — test E2E réel 2026-06-19
- ✅ Maillon 1 : gclid capté sur vitrine prod → cookie `ys_gclid` (payload {gclid,landing,ts}).
- ✅ Maillon 2 : cookie `Domain=.yoga-sculpt.fr` → visible sur app.yoga-sculpt.fr (cross-domain).
- ✅ Maillon 3 : `captureGclidOnProfile` au callback `/auth/callback` (PKCE, OAuth+magic-link y passent).
- ✅ Maillon 4 : webhook Stripe écrit la conversion `purchase` (valeur=montant, idempotent kind+source_ref).
- ❌ Maillon 5 : upload Google → API fermée (CE TICKET).

## Référence
Skill `google-ads` (`~/.claude/skills/google-ads/`) — y documenter le passage Data Manager API
dans `reference/api-pitfalls.md` (piège majeur pour tout nouveau compte).
