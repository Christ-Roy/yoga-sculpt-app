# [P3] Expéditeur e-mail d'invitation parrainage incohérent (`contact@` en fallback vs `notifications@` partout ailleurs)

**Statut** : non fait · **Qui** : agent (déclenchable)

## Contexte
L'e-mail d'invitation parrainage utilise un fallback d'expéditeur différent du reste de l'app :

```ts
// src/app/api/parrainage/inviter/route.ts:167
const senderEmail = process.env.BREVO_INVITE_SENDER_EMAIL ?? "contact@yoga-sculpt.fr";
```

Or partout ailleurs l'expéditeur authentifié Brevo est `notifications@yoga-sculpt.fr` :
- `.env.example:85` : `BREVO_INVITE_SENDER_EMAIL=notifications@yoga-sculpt.fr`
- `src/lib/brevo.ts:23` : sender par défaut `notifications@yoga-sculpt.fr` (domaine SPF/DKIM authentifié).

Si `BREVO_INVITE_SENDER_EMAIL` n'est pas posée en prod (oubli `wrangler secret put`), le fallback enverra depuis `contact@yoga-sculpt.fr`. `contact@` est une **redirection Cloudflare Email Routing** (cf CLAUDE.md projet), pas forcément un expéditeur SPF/DKIM validé côté Brevo → **risque de mail en spam / rejet** (le domaine est authentifié mais l'alignement de l'adresse exacte d'envoi compte selon la config Brevo).

## Demande précise
Aligner le fallback sur `notifications@yoga-sculpt.fr` (l'expéditeur authentifié connu), pour que même sans la var d'env, l'envoi parte d'une adresse validée :

```ts
const senderEmail = process.env.BREVO_INVITE_SENDER_EMAIL ?? "notifications@yoga-sculpt.fr";
```

Quick-win 1 ligne, safe, réversible. (Non appliqué par cet audit car règle "lecture seule + tickets" — c'est un changement de code, pas un fix de typo/lien mort.)

Vérifier au passage que `BREVO_INVITE_SENDER_EMAIL` est bien poussé en prod (`wrangler secret list` / vars du Worker) ; si oui, l'impact réel est nul mais le fallback reste une bombe à retardement.

## Fichiers concernés
- `src/app/api/parrainage/inviter/route.ts` (ligne 167)

## Impact
Délivrabilité de l'e-mail d'invitation (cœur du levier d'acquisition). Faible probabilité si la var d'env est posée, mais le fallback actuel est un piège. Trivial à corriger.
