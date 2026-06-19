# Attribution Google Ads server-side — valeur composée (paiement + filleuls + tickets consommés)

> Créé 2026-06-19. Chantier APP (touche webhook Stripe + parrainage + migration).
> Côté vitrine, la brique de capture est DÉJÀ livrée (cf §0). Ici = le côté app.
> ⚠️ Ne PAS démarrer tant qu'un autre agent a le working tree sale sur referral.ts /
>    events.ts (collision migration + logique parrainage). Coordonner.

## Objectif (demande Robert)

Apprendre à Google Ads la VRAIE valeur d'un visiteur venu de l'Ads, pas juste sa
transaction directe. On remonte côté serveur, attribué au **gclid d'origine** :

1. **Paiements Stripe** du user lui-même (valeur = montant réellement payé).
2. **Valeur générée par ses filleuls** (intérêts composés du parrainage) : un user
   qui vient de l'Ads, parraine des amis qui convertissent → on attribue AUSSI au
   gclid du parrain la valeur que ses filleuls produisent. C'est ce qui rend le user
   acquis via Ads bien plus rentable que sa seule 1re dépense.
3. **Tickets gratuits — UNIQUEMENT quand ils sont CONSOMMÉS pour réserver** (pas à
   l'émission). Valeur attribuée ≈ **10 € / séance** (≈ ce qu'une séance vaut).
   Un ticket welcome/referral émis mais jamais utilisé = 0 (aucune valeur réelle).

On NE comptabilise QUE : paiements + tickets gratuits effectivement consommés en résa.

## §0 — Déjà fait (côté vitrine, repo alice-gaudry)

- `site/src/components/GclidCapture.tsx` : capte `gclid`/`gbraid`/`wbraid` à l'arrivée
  sur yoga-sculpt.fr et le stocke en cookie **`ys_gclid`, `Domain=.yoga-sculpt.fr`**
  (partagé apex + app), 90 j, ne s'écrase pas par une visite directe ultérieure.
- Dépend du même scope de cookie que le ticket [cookie-cross-domain-vitrine] (option A
  `Domain=.yoga-sculpt.fr`). Le cookie gclid est lisible par l'app dès qu'on est sur
  `app.yoga-sculpt.fr`.

## §1 — Data model (migration 00XX, prendre le prochain numéro libre)

Sur `profiles` (ou table dédiée `ad_attribution` 1-1 avec le user) :
- `gclid text`, `gbraid text`, `wbraid text` — l'identifiant de clic d'origine.
- `ad_landing text`, `ad_clicked_at timestamptz` — contexte.
- `gclid_captured_at timestamptz` — quand l'app a rangé le gclid sur le user.

Sur les events de conversion uploadés (table `ads_conversions_uploaded` à créer) pour
l'**idempotence** (ne jamais uploader 2× la même conversion) :
- `id`, `user_id`, `kind` (`purchase` | `referral_value` | `free_ticket_used`),
  `source_ref` (stripe_session_id | referral_id | booking_id), `value_eur numeric`,
  `gclid text`, `uploaded_at timestamptz`, UNIQUE(`kind`, `source_ref`).

## §2 — Capture du gclid sur le user (app)

À la **création de compte / 1re session** (callback OAuth + magic link + onetap) :
lire le cookie `ys_gclid` (présent grâce à §0), parser le JSON, et le ranger sur le
user (si pas déjà présent — first-touch gagne). Point d'entrée probable : là où
`account_signals` est déjà écrit à l'inscription (`POST /api/parrainage/completer`
et les callbacks auth) — réutiliser ce chemin pour ne pas multiplier les hooks.

## §3 — Upload des conversions à Google (server-side)

Méthode : **Click Conversion Upload** (offline conversion import via gclid) sur l'API
Google Ads, OU Enhanced Conversions for Leads. Click upload via gclid = le plus direct
ici (on a le gclid). Conversion action à créer sur le compte 6478938833 (catégorie
PURCHASE pour les paiements ; une action distincte pour la valeur parrainage/ticket).
Outil : skill `google-ads` (`gads conv-create`, puis upload — à ajouter au CLI si absent,
cf `cmd_conversions.py`). Toujours envoyer `value` + `currency=EUR` + `conversion_date_time`.

Les 3 déclencheurs :

1. **Paiement** — dans `webhooks/stripe/route.ts`, sur `checkout.session.completed`,
   APRÈS le crédit de tickets : si le user a un gclid → enregistrer + uploader une
   conversion `purchase`, value = `amount_total/100`, source_ref = stripe_session_id
   (idempotence déjà gérée par la dédup session). 

2. **Valeur filleul** — dans le flux `canCreditReferral` / passage referral `completed`
   (referral.ts) : quand un filleul génère de la valeur (son 1er paiement OU sa 1re
   séance consommée), attribuer cette valeur au **gclid du PARRAIN** (pas du filleul),
   conversion `referral_value`, source_ref = referral_id (+ event). Anti-abus : ne
   compter que les referrals déjà validés par `canCreditReferral` (pas les pending /
   bloqués fingerprint) — on réutilise la garde existante.

3. **Ticket gratuit consommé** — au moment où un ticket `source IN (welcome, referral)`
   est utilisé pour une réservation (création booking qui décrémente un ticket gratuit) :
   conversion `free_ticket_used`, **value = 10 € (constante, ≈ valeur séance)**,
   source_ref = booking_id. PAS à l'émission du ticket. Attribuer au gclid du user qui
   réserve (et, si c'est un filleul, voir si on double-compte côté parrain — décision
   à trancher : éviter de compter 2× la même valeur).

## §4 — Tests E2E (staging, harnais Playwright déjà présent)

Le repo a déjà un harnais Playwright (`test/e2e`, cf commit 79db39c). Ajouter :
- arrivée avec `?gclid=TEST_xxx` sur la vitrine → cookie `ys_gclid` posé scope parent.
- création de compte → gclid rangé sur le user.
- paiement Stripe (mode test) → ligne `ads_conversions_uploaded` kind=purchase, value OK.
- parrainage validé → conversion `referral_value` attribuée au PARRAIN.
- réservation consommant un ticket gratuit → conversion `free_ticket_used` value=10.
- idempotence : rejouer le webhook → pas de double upload (UNIQUE kind+source_ref).
- Valider sur `staging.veridian.site` AVANT prod (prod app = accord Robert requis).

## Dépendances / ordre

1. [cookie-cross-domain-vitrine] option A déployé (sinon l'app ne lit pas `ys_gclid`).
2. Migration §1 (sérialiser après la dernière migration en cours — pas de collision).
3. §2 capture → §3 upload (purchase d'abord, puis referral_value, puis free_ticket_used).
4. §4 E2E staging → revue → prod sur accord.

## §5 — À TERME : exclure les payeurs de l'audience de retargeting (Robert)

Arrêter de payer pour retargeter des gens DÉJÀ clients. Aujourd'hui le tag
remarketing (RemarketingAction 7652610697) dépose TOUS les visiteurs du vitrine.
Cible : retirer/exclure ceux qui ont payé (ou réservé).
- Piste A : Customer Match — uploader la liste email des payeurs comme audience,
  puis l'EXCLURE des campagnes de retargeting (audience d'exclusion au niveau
  campagne/ad group). L'app a les emails des payeurs (profiles + tickets paid).
- Piste B : segmenter le tag remarketing (ne pas déposer / déposer dans une autre
  audience une fois connecté/payeur) — plus complexe côté vitrine statique.
- Reco : A (Customer Match d'exclusion), alimenté par un export périodique des
  payeurs depuis l'app. 3e chantier distinct (gestion d'audience ≠ conversion).

## §6 — État au 2026-06-19 (CE QUI EST FAIT)

Branche `feat/ads-attribution-server-side` (worktree, basé staging). tsc + 20 tests OK :
- migration 0017 (gclid sur profiles + table ads_conversions idempotente).
- lib/google-ads.ts (client edge : OAuth refresh + uploadClickConversions REST v23).
- lib/ads-attribution.ts (capture first-touch, recordAdsConversion, drainAdsConversions).
- 3 conversions câblées : purchase (webhook Stripe), referral_value (completerReferral,
  → gclid parrain), free_ticket_used (reserver, ticket welcome/referral consommé, ~10€).
- drain branché sur le cron existant /api/cron (4e passe).
- 3 conversionActions CRÉÉES sur le compte 6478938833 (resource names en .env.example).

RESTE pour activer en prod :
- `wrangler secret put` des creds Ads (GOOGLE_ADS_*) + ADS_CONV_ACTION_* en env prod.
- appliquer la migration 0017 sur Supabase prod.
- E2E Playwright staging (cf §4) + revue + merge dans staging→main.
- §5 (exclusion payeurs du retargeting) = chantier suivant.

## Notes valorisation (Robert, 2026-06-19)

- On ne compte QUE le concret : paiements (montant réel) + tickets gratuits CONSOMMÉS
  (≈10€/séance). Ticket émis non utilisé = 0.
- Intérêts composés : la valeur des filleuls remonte au gclid du parrain venu de l'Ads.
- Le formulaire de contact du vitrine = décoratif/SEO, PAS une conversion à optimiser
  (décision Robert) → on ne câble PAS de conversion lead sur le form.
