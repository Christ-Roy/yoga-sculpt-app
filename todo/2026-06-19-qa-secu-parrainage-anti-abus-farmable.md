# [P2] QA sécu — Parrainage : durcir l'anti-abus (reliquat après le cap)

**Statut** : partiellement livré · **Qui** : agent · **Source** : QA sécu 2026-06-19 (axe #4 anti-abus)

## ✅ Déjà livré (commit cba2c2a)
**Cap par parrain** : un parrain n'est crédité qu'au maximum `maxParrainagesCredites()`
fois (défaut métier 3), au-delà le filleul reste rattaché mais ne crédite plus. Plafond
configurable sans redéploiement via l'env **`REFERRAL_MAX_CREDITS`**. Source de vérité
unique dans `src/lib/referral.ts` (`completerReferral`, count `ticket_credite=true` par
`parrain_user_id` avant crédit). Ça borne le rendement du farming (plus de rendement
linéaire illimité), mais ça ne le **tue** pas : un attaquant peut toujours obtenir jusqu'au
plafond avec des faux comptes.

## ⬜ Reste à faire (par ordre d'impact)

### 1. Créditer le parrain APRÈS la 1ère séance HONORÉE du filleul (levier qui tue l'attaque)
Aujourd'hui `referral.ts` `completerReferral` crédite dès l'inscription du filleul (callback
OAuth / `/completer`), pas après une présence en cours. Un faux compte n'ira jamais en
cours → conditionner le crédit à un booking passé + `bookings.attendance='attended'`
(tables déjà présentes) supprime l'incitation à créer des comptes bidon.
- ⚠️ Ça déplace le déclencheur du crédit du flux d'inscription vers le **cron d'attendance**
  (recâblage non trivial, laissé hors du commit cap pour ne pas fragiliser l'inscription).
  Un `TODO(anti-abus)` est déjà posé à l'endroit exact dans `src/lib/referral.ts`
  (juste après le check du plafond).

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
