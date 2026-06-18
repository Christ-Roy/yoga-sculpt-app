# Mails d'auth Supabase — état

## ✅ FAIT
- **SMTP custom Brevo configuré** (prod `esearpxflfgreejjxlfg` + staging `htgbtckgkulwuyzfsvjq`) via Management API `config/auth` :
  smtp_host=smtp-relay.brevo.com:587, user=8b5d2a002@smtp-brevo.com, pass=BREVO_SMTP_KEY (rangée), sender=notifications@yoga-sculpt.fr "Yoga Sculpt".
- **Testé** : POST /auth/v1/magiclink → 200, mail envoyé depuis notifications@yoga-sculpt.fr. ✅
- Sujets des mails d'auth personnalisés en FR (magic-link/confirmation/recovery/invite).
- Templates HTML à la charte prêts : `emails/auth/{magic-link,confirmation,recovery,invite}.html`.

## ⚠️ RESTE : coller le HTML stylé des templates via le DASHBOARD (pas l'API)
L'API Management Supabase a un **WAF (403 code 1010)** qui bloque tout `mailer_templates_*_content`
contenant du HTML stylé (style= inline / <style>). Impossible de pousser les templates riches par API.
→ Les coller à la main via **Supabase Dashboard → Authentication → Emails → (chaque template)** :
  copier le contenu de `emails/auth/<type>.html`. À faire sur prod ET staging.
  (Login Supabase requis — action manuelle Robert.)
Aujourd'hui : les mails d'auth partent du bon expéditeur (@yoga-sculpt.fr) avec un sujet FR mais
un corps HTML basique tant que le dashboard n'a pas reçu le HTML stylé.

## Aussi à faire (dashboard, même session)
- Pousser les templates auth identiques en prod ET staging.
