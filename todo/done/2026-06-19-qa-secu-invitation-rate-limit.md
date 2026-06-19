# [P3] QA sécu — Rate limiting sur la landing publique /invitation (sévérité BASSE)

**Statut** : garde-fou anti-flood CODE livré (best-effort) · reste la règle WAF côté CF (décision/infra Robert) ·
**Qui** : agent (code) + Robert (dashboard CF) · **Source** : passe sécu 2026-06-19
(sous-ticket de `2026-06-19-passe-securite-features-livrees.md`)

## ✅ LIVRÉ 2026-06-19 — anti-flood edge-safe SANS dépendance/binding
Rate-limit in-memory (fixed-window, 30 req/60 s/IP via `CF-Connecting-IP`) appliqué
dans le **middleware** SUR `/invitation` uniquement, AVANT tout I/O session →
dépassement = `429` + `Retry-After`. Fichiers : `src/lib/rate-limit.ts` (module pur,
edge-safe, cap mémoire anti-fuite, fail-open sans IP), `src/middleware.ts` (branchement),
tests `__tests__/lib/rate-limit.test.ts`.

⚠️ **C'est best-effort, PAS une garantie** : l'état est local à l'isolate Cloudflare
(non partagé entre isolates, volatil) → ça casse un flood NAÏF depuis une même IP sur
un même isolate, mais un attaquant réparti sur plusieurs isolates peut passer outre.
À coût ~nul (aucune I/O, aucune dépendance, aucun binding). La VRAIE défense durable
reste l'Option A ci-dessous (à faire par Robert).

## 🔴 RESTE À FAIRE (Robert) — règle Cloudflare Rate Limiting / WAF (Option A)
Poser une règle CF Rate Limiting sur le path `/invitation` (ex. 30 req/min/IP) au
niveau du dashboard. Zéro code, réversible en un clic, état partagé global (vraie
protection DoS). 5 min de config. (Le garde-fou code ci-dessus reste utile en
complément, ou pourra être retiré une fois la règle WAF en place.)

## Contexte
`/invitation?ref=<CODE>` est PUBLIQUE et résout, via `service_role`, prénom + avatar + **email
complet** du parrain (décision Robert : email assumé, le parrain partage son lien volontairement).
Aucun rate limiting n'est posé sur cette route.

## Pourquoi c'est BAS (pas une faille exploitable aujourd'hui)
- **Énumération impossible en pratique** : le code fait 8 caractères d'un alphabet de 31 (non
  ambigu) → ~31^8 ≈ 8,5×10¹¹ combinaisons. Brute-force aléatoire infaisable.
- **Guess invalide = coût nul** : `sanitizeRefCode` rejette tout code hors format (longueur/alphabet)
  AVANT toute requête DB. Un attaquant qui balance des codes au hasard ne touche même pas la base.
- **Guess valide-de-format-mais-inconnu = 1 SELECT indexé** (`profiles.referral_code`). L'appel
  Admin API `getUserById` (plus coûteux, pour l'avatar) ne se déclenche QUE si un profil est trouvé.
- **Pas d'amplification de scraping** : qui possède le lien possède déjà l'email (exposé par design).

Donc : pas de fuite nouvelle ni d'énumération réaliste. Le seul vecteur résiduel est un **flood
DoS** de codes valides-de-format, mitigé par Cloudflare (WAF/edge) en amont.

## Pourquoi ce n'est PAS corrigé dans la passe
Un rate-limiter correct sur Cloudflare Workers (edge) exige une infra à état partagé :
- binding **Rate Limiting** de Cloudflare (`unsafe.rateLimit`), ou
- **KV** / **Durable Object** (compteur par IP/fenêtre).

C'est une **nouvelle ressource d'infra + binding wrangler + déploiement** → hors périmètre d'une
passe code (contrainte : pas de nouvelle dépendance/binding, pas de deploy).

## Reco (si on décide de durcir)
**Option A (recommandée, ~70 %)** — règle **Cloudflare WAF / Rate Limiting Rule** au niveau du
dashboard CF sur le path `/invitation` (ex. 30 req/min/IP). Zéro code, zéro binding wrangler,
réversible en un clic. C'est le bon niveau pour une protection DoS d'une route publique.
- Impact : 5 min de config dashboard, aucun risque code, aucun deploy app.

**Option B** — binding Rate Limiting Cloudflare + check dans le middleware edge (clé = IP via
`CF-Connecting-IP`, déjà extraite par `getClientIp`). Plus de code + un binding wrangler par env.
- Impact : ~1 h, test, deploy staging+prod, à maintenir.

→ **Ma reco : Option A** (WAF rule). Le code n'est pas le bon endroit pour ça sur cette stack.

## Fichiers concernés (pour mémoire)
`src/app/invitation/page.tsx`, `src/lib/referral.ts` (`parrainPublicParCode`), `src/middleware.ts`.
