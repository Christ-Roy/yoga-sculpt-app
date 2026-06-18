# Mails d'auth Supabase — état (2026-06-18)

## ✅ FAIT (prod + staging)
- SMTP custom Brevo configuré + testé (mails partent de notifications@yoga-sculpt.fr).
- Sujets d'auth en FR.
- Templates magic-link / confirmation / recovery poussés par API Management → le lien pointe vers
  `/auth/confirm?token_hash=...&type=...&redirectTo=/espace` (corrige le bug du fragment #access_token
  qui ne connectait pas). HTML fonctionnel mais SOBRE (pas de style inline).

## ⚠️ RESTE (cosmétique, via DASHBOARD — l'API a un WAF qui refuse le HTML stylé)
- Style noir & or des mails d'auth + template `invite`. Coller `emails/auth/*.html` via
  Supabase Dashboard → Authentication → Emails (pas de WAF dans l'UI). Login Supabase requis.
- ⚠️ Piège API : le WAF Management (403 code 1010) bloque `style=` inline ET les gros payloads.
  Pousser UN champ à la fois, espacé (~40s), HTML léger sans style → passe. Sinon dashboard.
