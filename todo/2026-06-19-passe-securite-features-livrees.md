# [P1] Passe de sécurité sur les features livrées (admin, invitation, paiement, parrainage)

**Statut** : à faire · **Qui** : agent (audit) · **Source** : demande Robert post-prod 2026-06-19

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
