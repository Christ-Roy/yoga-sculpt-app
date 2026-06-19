# [P2] QA sécu — Parrainage : anti-abus contournable, crédit à l'inscription, pas de plafond

**Statut** : à durcir · **Qui** : agent · **Source** : QA sécu 2026-06-19 (axe #4 anti-abus)

## Problème
L'anti-abus parrainage (`src/lib/anti-abuse.ts`, `referral.ts`) est un filtre **anti-naïf**, pas une vraie défense. Un attaquant déterminé farme des tickets gratuits. Trois faiblesses cumulées :

### 1. Fingerprint 100 % contrôlé par le client (R3 / W3 contournables)
`src/components/FingerprintCollector.tsx` POST les composantes brutes ; `src/lib/fingerprint.ts` ne fait que **hasher ce que le client envoie**. Un attaquant POST un `fingerprint` différent (ou `null` → la règle est skippée, `anti-abuse.ts` `if (fingerprint)`) à chaque faux compte → R3/W3 ne matchent jamais.

### 2. R2 (IP partagée) auto-sabotée par l'ordre + tombe sous VPN
`completer/route.ts` appelle `enregistrerSignaux` (upsert IP du filleul) AVANT `canCreditReferral`, et R2 fait `.neq('user_id', filleulUserId)`. Le **1er** filleul depuis une IP passe toujours (personne d'autre n'a encore cette IP) ; R2 ne bloque qu'à partir du 2e abus *sur la même IP*. Avec VPN/4G CGNAT à IP rotative, R2 tombe complètement.

### 3. Crédit à l'inscription + aucun plafond
`referral.ts` `completerReferral` crédite le parrain dès l'inscription du filleul (callback OAuth / `/completer`), **pas** après un achat ou une présence en cours. Aucun cap (ni quotidien ni total) sur le nombre de filleuls crédités par parrain. Le seul garde-fou "action réelle" (avis Google) est documenté TODO **non implémenté**. La blocklist email jetable (`anti-abuse.ts`) est statique (~55 domaines), ignore les milliers de domaines réels + les alias Gmail `user+tag@`.

## Scénario de farming (sans même toucher au P1 RLS)
1. Attaquant = parrain, récupère son code (`GET /api/parrainage`).
2. Pour chaque ticket voulu : VPN nouvelle IP → nouveau compte filleul (alias Gmail `+`) → suit `?ref=CODE` → onboarding → `/completer` POST avec `fingerprint` aléatoire.
3. R1 (email) ok, R2 (IP neuve) ok, R3 (fp neuf) ok, R4 (jamais crédité) ok → **parrain crédité**. Rendement linéaire illimité.

## Reco (par ordre d'impact)
1. **Créditer le parrain après la 1ère séance HONORÉE du filleul** (booking passé + `attendance='attended'`, tables déjà présentes) plutôt qu'à l'inscription. C'est le levier qui tue l'attaque (un faux compte ne va pas en cours).
2. **Cap par parrain** (ex. 10 parrainages crédités, configurable).
3. Blocklist email externe/dynamique + normalisation des alias `+`/`.` Gmail.
4. Ne pas présenter le fingerprint maison comme une défense (il n'attrape que l'abuseur qui reclique dans le même navigateur).

## Ce qui est DÉJÀ solide (à conserver)
- **Idempotence du crédit** : court-circuit si `pending.ticket_credite`, marquage conditionnel `.eq("ticket_credite", false)` + compensation de course (`retirerDernierTicketParrainage`), unique `(parrain, email)` (`0004`), R4 = 1 ticket/filleul tous parrains confondus. Pas de double crédit sur rejeu de `/completer`.
- **Anti-auto-parrainage** : `parrainUserId === filleulUserId` refusé + `inviter` refuse de s'inviter.
- **Échec silencieux respecté** : `/completer` renvoie toujours `200 {ok:true}`, l'issue crédité/bloqué reste interne (pas d'oracle pour l'attaquant).
- **Pas de fail-open** : sur erreur DB, `canCreditReferral`/`hasSharedSignals` renvoient le côté SÛR (refus). Une panne anti-abus ne crédite jamais.
- **Code parrainage vérifié serveur** : le filleul fournit un CODE (8 chars, alphabet restreint, `sanitizeRefCode` strict), pas un `user_id` → pas d'injection de parrain arbitraire. Pas d'open-redirect via `?ref=`.
- **IP fiable** : `getClientIp` lit `CF-Connecting-IP` en priorité (non spoofable derrière Cloudflare).
- **Ticket de bienvenue** : idempotence EXEMPLAIRE (flag applicatif `welcome_ticket_granted_at` + index unique partiel DB `tickets_welcome_once_uidx` → 23505 traité comme succès idempotent ; un reset du flag ne recrée pas le ticket). Seul vecteur restant = multi-comptes (mêmes limites IP/fp ci-dessus).

## Fichiers
`src/lib/anti-abuse.ts`, `src/lib/referral.ts`, `src/lib/fingerprint.ts`, `src/components/FingerprintCollector.tsx`, `src/app/api/parrainage/completer/route.ts`, `src/app/api/parrainage/route.ts`.
