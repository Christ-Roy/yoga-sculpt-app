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

## ✅ CODE FAIT (agent, 2026-06-19) — migration Data Manager API livrée
`src/lib/google-ads.ts` réécrit : `uploadClickConversion` appelle désormais la **Data
Manager API** au lieu de l'ancien ConversionUploadService. Contrat de
`drainAdsConversions` INCHANGÉ (même signature, throw→reste pending, idempotence
Supabase préservée). Maillons 1→4 non touchés. Tests adaptés, 581/581 verts, tsc OK.

### Détails techniques de l'implémentation
- **Endpoint** : `POST https://datamanager.googleapis.com/v1/events:ingest`
- **Scope OAuth** : `https://www.googleapis.com/auth/datamanager` (≠ `adwords`)
- **Pas de header** `developer-token` ni `login-customer-id` (ignorés à l'ingestion) —
  la relation MCC passe par `loginAccount` (MCC) / `operatingAccount` (compte client)
  DANS le payload.
- **Payload** (résumé) :
  ```json
  {
    "destinations": [{
      "operatingAccount": { "accountType": "GOOGLE_ADS", "accountId": "6478938833" },
      "loginAccount":     { "accountType": "GOOGLE_ADS", "accountId": "6437191896" },
      "productDestinationId": "7654707078"
    }],
    "events": [{
      "adIdentifiers": { "gclid": "<gclid>" },
      "conversionValue": 60, "currency": "EUR",
      "eventTimestamp": "2026-06-19T12:00:00Z", "eventSource": "WEB"
    }]
  }
  ```
- `productDestinationId` = **ID numérique** de la conversion action (pas le resource
  name) → extrait automatiquement de `ADS_CONV_ACTION_*` par `conversionActionId()`.
- `eventTimestamp` = RFC 3339 UTC (`formatEventTimestamp()`).

## 🔴 ACTION ROBERT — à activer côté Google AVANT de re-tester (le code est prêt, pas l'accès)
Le code est complet, mais l'API a besoin de 2 activations que l'agent ne peut pas faire :

1. **Activer la Data Manager API dans le projet GCP** qui porte l'OAuth client Ads.
   Console GCP → APIs & Services → Library → chercher « Data Manager API »
   (`datamanager.googleapis.com`) → **Enable**. (Self-serve, pas de formulaire d'accès.)

2. **Régénérer `GOOGLE_ADS_REFRESH_TOKEN` avec le scope Data Manager.**
   Le refresh_token actuel a très probablement le scope `adwords` uniquement → l'upload
   échouera en auth. Régénérer un refresh_token avec le scope :
   `https://www.googleapis.com/auth/datamanager`
   (cf skill `google-ads` `reference/auth.md` pour la procédure refresh_token ; même
   OAuth client, juste le scope qui change). Puis `wrangler secret put GOOGLE_ADS_REFRESH_TOKEN`.
   > Note : si on veut garder l'accès Ads classique en parallèle, demander les DEUX scopes
   > (`adwords` + `datamanager`) à la régénération.

3. **Vérifier que les credentials ont accès au compte via le MCC** : l'email/compte des
   credentials doit être user du `loginAccount` (MCC Veridian `6437191896`) qui gère le
   compte Yoga Sculpt (`6478938833`). C'est déjà le cas pour l'API Ads classique → OK a priori.

## Comment re-tester en réel (après activations Robert)
- **Dry-run sans risque** : ajouter temporairement `validateOnly: true` au payload (champ
  supporté par events:ingest) → valide la structure + l'auth + l'accès SANS écrire de
  conversion. Si HTTP 200 `{requestId}` → structure/scope/accès OK.
- **Vrai E2E** : laisser une conversion `purchase` pending (déjà en base depuis le test
  E2E du 19/06) → relancer le drain (cron `/api/cron` ou appel direct `drainAdsConversions`).
  Attendu : `uploaded: 1, failed: 0`, ligne `ads_conversions.uploaded=true`,
  `upload_error=null`. Côté Google Ads : la conversion remonte sous 24-72h sur la conv
  action (compteur conversions de la campagne).

## ⚠️ Pas testable end-to-end par l'agent
L'agent N'A PAS pu valider l'appel réel : la Data Manager API n'est pas encore activée
côté GCP + le scope du refresh_token est probablement insuffisant. Le code suit la doc
officielle (endpoint/scope/payload vérifiés sur developers.google.com le 19/06) et tous
les tests unitaires passent, **mais le 1er appel réel reste à confirmer** par Robert
après les activations ci-dessus (commencer par `validateOnly: true`).

## Ce qui est VALIDÉ (ne pas y retoucher) — test E2E réel 2026-06-19
- ✅ Maillon 1 : gclid capté sur vitrine prod → cookie `ys_gclid` (payload {gclid,landing,ts}).
- ✅ Maillon 2 : cookie `Domain=.yoga-sculpt.fr` → visible sur app.yoga-sculpt.fr (cross-domain).
- ✅ Maillon 3 : `captureGclidOnProfile` au callback `/auth/callback` (PKCE, OAuth+magic-link y passent).
- ✅ Maillon 4 : webhook Stripe écrit la conversion `purchase` (valeur=montant, idempotent kind+source_ref).
- 🟢 Maillon 5 : CODE migré Data Manager API (CE TICKET) — reste activation Google + 1 test réel.

## Référence
Skill `google-ads` (`~/.claude/skills/google-ads/`) — passage Data Manager API documenté
dans `reference/api-pitfalls.md` (piège majeur pour tout nouveau compte).
