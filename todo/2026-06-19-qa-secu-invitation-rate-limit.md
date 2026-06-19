# [P3] QA sécu — Rate limiting sur la landing publique /invitation (sévérité BASSE)

**Statut** : à faire (faible priorité) · **Qui** : agent (nécessite une décision infra Robert) ·
**Source** : passe sécu 2026-06-19 (sous-ticket de `2026-06-19-passe-securite-features-livrees.md`)

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
