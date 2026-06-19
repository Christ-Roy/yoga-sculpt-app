# [P2] QA sécu — Parrainage : durcir l'anti-abus (reliquat après le cap)

**Statut** : levier #1 LIVRÉ (crédit déféré à la séance honorée) · **Qui** : agent · **Source** : QA sécu 2026-06-19 (axe #4 anti-abus)

## ✅ LIVRÉ 2026-06-19 — levier #1 : crédit APRÈS la 1re séance HONORÉE (tue le farming)
Le crédit du parrain n'est PLUS déclenché à l'inscription du filleul. Désormais :
- à l'inscription (callback auth / POST /completer), `completerReferral` se contente
  de LIER le filleul au parrain en `pending` (referral posé, `ticket_credite=false`,
  AUCUN ticket, AUCUN anti-abus évalué — il le sera au crédit) ;
- le ticket du parrain tombe quand le filleul est pointé `attendance='attended'`
  pour la 1re fois (route admin attendance → `crediterParrainsApresSeanceHonoree`),
  avec ré-évaluation de l'anti-abus (`canCreditReferral`) + plafond (`maxParrainagesCredites`),
  idempotent sur `referrals.ticket_credite`, best-effort (n'échoue jamais le pointage).

Effet : un faux compte / un compte EXISTANT qui ne vient jamais en cours ne sera
jamais pointé présent → le parrain n'est jamais crédité. Ferme aussi le vecteur
« parrainer un compte existant » (cf. section en bas). Fichiers : `src/lib/referral.ts`
(`completerReferral` simplifié + `crediterParrainsApresSeanceHonoree` + `crediterReferralPending`),
`src/app/api/admin/bookings/attendance/route.ts` (déclencheur sur transition→attended),
`src/app/auth/callback/route.ts` (event `referral_signup` au lieu de credited/blocked),
migration additive `0018_referral_credit_on_attendance.sql` (index lookup + doc).
Tests : `__tests__/lib/referral-lib.test.ts` + `__tests__/api/parrainage-completer.test.ts`
+ `__tests__/api/admin/bookings/attendance.test.ts`.

## ✅ Déjà livré (commit cba2c2a)
**Cap par parrain** : un parrain n'est crédité qu'au maximum `maxParrainagesCredites()`
fois (défaut métier 3), au-delà le filleul reste rattaché mais ne crédite plus. Plafond
configurable sans redéploiement via l'env **`REFERRAL_MAX_CREDITS`**. Source de vérité
unique dans `src/lib/referral.ts` (`completerReferral`, count `ticket_credite=true` par
`parrain_user_id` avant crédit). Ça borne le rendement du farming (plus de rendement
linéaire illimité), mais ça ne le **tue** pas : un attaquant peut toujours obtenir jusqu'au
plafond avec des faux comptes.

## ⬜ Reste à faire (par ordre d'impact)

### ~~1. Créditer le parrain APRÈS la 1ère séance HONORÉE du filleul~~ ✅ LIVRÉ (cf. ci-dessus)

### 2. Blocklist email jetable externe/dynamique + normalisation des alias Gmail
`src/lib/anti-abuse.ts` : la blocklist `DISPOSABLE_EMAIL_DOMAINS` est **statique** (~55
domaines en dur) → ignore les milliers de domaines jetables réels ET les alias Gmail
`user+tag@gmail.com` / `u.s.e.r@gmail.com` (qui pointent tous vers la même boîte). `estEmailJetable`
ne fait aujourd'hui qu'un `.toLowerCase()` sur le domaine.
- Normaliser l'adresse avant le test (pour Gmail/Googlemail : retirer le `+tag` et les `.`
  de la partie locale) → un même attaquant ne peut plus multiplier les alias.
- Brancher une source de blocklist externe/dynamique (liste maintenue, ou check MX/API)
  plutôt qu'une Set figée.

### 3. Ne pas présenter le fingerprint maison comme une vraie défense
`src/lib/fingerprint.ts` ne fait que **hasher ce que le client envoie** (`FingerprintCollector`
POST les composantes brutes). Un attaquant POST un fingerprint différent (ou `null` → règle
skippée) à chaque faux compte → R3/W3 ne matchent jamais. À garder comme filtre anti-naïf
(attrape l'abuseur qui reclique dans le même navigateur), mais sans s'en remettre dessus.
Le vrai garde-fou reste le levier #1 (séance honorée).

## Ce qui est DÉJÀ solide (à conserver)
- **Idempotence du crédit** : court-circuit si `pending.ticket_credite`, marquage conditionnel
  `.eq("ticket_credite", false)` + compensation de course (`retirerDernierTicketParrainage`),
  unique `(parrain, email)` (`0004`), R4 = 1 ticket/filleul tous parrains confondus. Pas de
  double crédit sur rejeu de `/completer`.
- **Anti-auto-parrainage** : `parrainUserId === filleulUserId` refusé + `inviter` refuse de s'inviter.
- **Échec silencieux respecté** : `/completer` renvoie toujours `200 {ok:true}`, l'issue
  crédité/bloqué reste interne (pas d'oracle pour l'attaquant).
- **Pas de fail-open** : sur erreur DB, `canCreditReferral`/`hasSharedSignals` renvoient le
  côté SÛR (refus). Une panne anti-abus ne crédite jamais.
- **Code parrainage vérifié serveur** : le filleul fournit un CODE (8 chars, alphabet
  restreint, `sanitizeRefCode` strict), pas un `user_id`. Pas d'open-redirect via `?ref=`.
- **IP fiable** : `getClientIp` lit `CF-Connecting-IP` en priorité (non spoofable derrière Cloudflare).
- **Ticket de bienvenue** : idempotence EXEMPLAIRE (flag `welcome_ticket_granted_at` + index
  unique partiel `tickets_welcome_once_uidx` → 23505 traité comme succès idempotent).

## Fichiers
`src/lib/anti-abuse.ts`, `src/lib/referral.ts` (TODO posé après le check plafond),
`src/lib/fingerprint.ts`, `src/components/FingerprintCollector.tsx`,
`src/app/api/parrainage/completer/route.ts`, `src/app/api/parrainage/route.ts`.

---

## ⚠️ Vecteur supplémentaire (constaté 2026-06-19) — parrainer un COMPTE DÉJÀ EXISTANT

`completerReferral` est appelé au callback auth (à CHAQUE connexion qui porte le cookie
`ys_ref`), pas seulement à la création de compte. Il n'y a **aucune garde "le filleul doit
être un nouvel inscrit"**. Donc un **compte déjà existant** qui clique sur un lien `?ref=CODE`
et se reconnecte → le parrain EST crédité (s'il n'a jamais été filleul, R4) — alors qu'aucune
acquisition réelle n'a eu lieu.

Conséquences :
- Cas bénin : un client déjà inscrit suit le lien d'un ami → l'ami gagne un ticket sans
  amener un nouveau membre.
- Cas abusif : faire cliquer ses contacts déjà clients sur son lien → farm de tickets sans
  acquisition. R4 (1 crédit/filleul à vie) + cap par parrain limitent, mais ne ferment pas.

### Fix (recoupe le levier déjà recommandé)
Le levier "**créditer après la 1ère séance HONORÉE du filleul**" (au lieu de l'inscription)
ferme aussi CE cas : un compte existant qui ne vient pas en cours ne rapporte rien. À défaut,
ajouter une garde "filleul = compte créé récemment / jamais réservé avant le clic ref" dans
`completerReferral` (ex. refuser si `profiles.created_at` du filleul est antérieur au dépôt
du cookie ref, ou s'il a déjà des bookings). À trancher : faut-il autoriser le parrainage
d'un compte existant qui n'a jamais réservé (cas légitime : ami inscrit mais jamais venu) ?
Reco : créditer à la séance honorée tranche proprement sans avoir à décider de l'âge du compte.
