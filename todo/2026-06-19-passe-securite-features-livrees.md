# [P1] Passe de sécurité sur les features livrées (admin, invitation, paiement, parrainage)

**Statut** : AUDITÉ 2026-06-19 (agent backend) — verdict par surface en bas du fichier ·
**Qui** : agent (audit) · **Source** : demande Robert post-prod 2026-06-19

## But
Audit sécu ciblé des surfaces ajoutées/modifiées ce sprint, maintenant qu'elles sont en
prod avec Stripe LIVE. Vérifier chaque point, documenter le verdict (sûr / à corriger),
ouvrir un sous-ticket par faille réelle trouvée. Adversarial : chercher à casser.

## Surfaces à auditer
### Auth / invitation (nouveau)
- `/invitation` est PUBLIQUE : confirmer qu'elle n'expose AUCUNE PII du parrain au-delà
  de ce qui est voulu (prénom, et bientôt avatar+email — l'email du parrain devient visible
  au filleul : est-ce acceptable ? le parrain le sait-il ? cf RGPD/consentement).
- `prenomParrainParCode` : injection via `?ref=` (déjà sanitizeRefCode), énumération de codes
  (un attaquant peut-il brute-forcer des codes pour récupérer des prénoms/avatars/emails ?
  → rate limiting + le fait que ça ne révèle qu'un prénom limite, mais l'EMAIL change la donne).
- Composant auth partagé `AuthMethods` : pas de régression sur /login (open-redirect déjà
  couvert par safeInternalRedirect — revérifier que /invitation aussi).

### Admin (back-office complet, nouveau en prod)
- Toutes les routes `api/admin/**` : `requireAdmin()` en tête + zod strict (déjà audité avant,
  re-confirmer après merge). Vérifier qu'AUCUNE page/donnée admin ne fuit à un non-admin
  (tester avec un compte user normal connecté → 403/redirect partout).
- Actions sensibles (créditer tickets, suspendre, magic-link, annuler/déplacer résa au nom
  d'un client) : bornes, idempotence, pas d'élévation de privilège.

### Paiement (Stripe LIVE désormais)
- Webhook : HMAC live, anti-replay, idempotence (fix 0015) — re-confirmer en LIVE.
- Checkout : impossible de payer un prix arbitraire / 0€ (enum formule + priceId vérifié).
- Le `metadata.user_id` ne peut pas être usurpé pour créditer un autre compte.

### Parrainage (farming)
- Cap REFERRAL_MAX_CREDITS actif en prod. Le reste (crédit-séance-honorée, blocklist email
  dynamique, normalisation alias Gmail) est dans [[2026-06-19-qa-secu-parrainage-anti-abus-farmable]].

## Méthode
Idéalement une passe multi-agents adversariaux (chercher à exploiter chaque surface) +
vérification. Lister findings réels (pas de bruit), sévérité, repro, fix proposé.
Headers sécu (CSP, HSTS, X-Frame) sur app.yoga-sculpt.fr à vérifier aussi.

---

## ✅ VERDICT DE L'AUDIT (2026-06-19, agent backend)

Passe adversariale sur chaque surface live. Deux findings réels (1 corrigé, 1 sous-ticket).
Le reste est SOLIDE — rien à corriger.

### Routes admin — SOLIDE ✅
- `requireAdmin()` en tête de chaque page ET de chaque route `api/admin/**` (défense en
  profondeur, indépendante du middleware — couvre CVE-2025-29927). Fail-safe : `ADMIN_EMAILS`
  absent/vide → set VIDE → personne n'est admin. Un non-admin connecté est redirigé `/espace`
  (pas de 403 bavard qui révèle la zone). Aucune donnée `service_role` chargée avant le gate.
- Zod `.strict()` partout, validation par `userId` UUID (jamais par email client). Crédit ticket
  borné 1..50 (`users/_lib/validation.ts`), débit borné par solde réel, anti-auto-suspension.
  Pas d'élévation de privilège trouvée.

### Webhook Stripe (LIVE) — SOLIDE ✅
- HMAC-SHA256 Web Crypto, comparaison timing-safe, anti-replay 5 min (rejet si `|now - t| > 300s`),
  fail-safe 500 si `STRIPE_WEBHOOK_SECRET` absent. `payment_status === "paid"` requis.
- Idempotence : upsert `onConflict: stripe_session_id, ignoreDuplicates` (index unique 0015) →
  un rejeu ne crédite JAMAIS 2×. `metadata.user_id` non usurpable : il provient du `client_reference_id`
  posé SERVEUR au checkout (l'utilisateur authentifié), pas d'un champ client.

### Checkout — SOLIDE ✅ (anti price-0€ confirmé)
- Auth requise. Le client ne choisit JAMAIS un price arbitraire : soit une `formule` (enum), soit
  un `priceId` qui DOIT être `===` à une valeur d'env connue (`resolveFormule`). Un price à 0 € /
  inconnu → 400. Quantité dérivée serveur. Zod `.strict()`.

### Parrainage (farming) — SOLIDE ✅ (cap vérifié + testé)
- Cap `maxParrainagesCredites()` (défaut 3, surchargeable `REFERRAL_MAX_CREDITS`) : au plafond,
  AUCUN ticket inséré (vérifié + test de régression ajouté : "plafond atteint → 0 ticket" +
  "desserrage via env"). Idempotence (flag `ticket_credite` + marquage conditionnel + compensation
  de course), anti-auto-parrainage, échec silencieux, pas de fail-open. R2 (IP) tolère 2 comptes/IP
  (colocs), refuse au 3e. Le levier "crédit après séance honorée" reste un TODO séparé (non requis ici).

### Headers de sécurité — FINDING CORRIGÉ (sévérité HAUTE → fixé) 🔧
AUCUN header de sécurité n'était posé sur l'app (auth + Stripe LIVE) — `next.config.ts#headers()`
n'est pas évalué par l'export edge OpenNext. **Corrigé** (commit "feat(secu): en-têtes de sécurité
globaux") : middleware edge pose HSTS / X-Frame DENY / nosniff / Referrer-Policy / Permissions-Policy
/ COOP + CSP en **report-only** (calée sur Supabase/Stripe/Google). CSP report-only volontaire
(comme le vitrine) pour ne pas risquer de casser le rendu Next sans build de validation — à durcir
+ enforcer ensuite (cf. le ticket CSP enforce existant côté vitrine, à dupliquer pour l'app).

### Énumération de codes sur /invitation — FINDING (sévérité BASSE → sous-ticket) 📋
La landing `/invitation?ref=CODE` est publique et expose prénom + avatar + **email** du parrain,
sans rate limiting. Analyse : pas un risque d'énumération réel (code 8 chars / alphabet 31 =
~8.5e11 combinaisons, et un code de format invalide est rejeté par `sanitizeRefCode` AVANT toute
requête DB → un guess invalide ne coûte rien). Le seul coût d'un guess valide-de-format-mais-inconnu
= 1 SELECT indexé (l'Admin API `getUserById`, plus chère, ne se déclenche QUE si un profil existe).
Pas d'amplification de scraping (qui a le lien a déjà l'email — décision Robert assumée).
Un vrai rate-limiter sur Workers edge exige une infra (KV / Durable Object / binding Rate Limiting)
= hors périmètre de cette passe (pas de nouvelle dépendance/binding, pas de deploy).
→ **Sous-ticket** : `2026-06-19-qa-secu-invitation-rate-limit.md`.

### Composant auth partagé `AuthMethods` — SOLIDE ✅
`/invitation` n'est PAS dans les routes protégées du middleware (landing publique voulue) et ne
fait PAS la redirection "déjà connecté → /espace" (réservée à /login) : un filleul fraîchement
authentifié peut enchaîner sur l'onboarding. L'open-redirect reste couvert par `safeInternalRedirect`
au callback (déjà audité, ticket `qa-secu-open-redirect-auth-callback` archivé en `done/`).
