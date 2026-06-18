# Brancher SMTP custom Brevo dans Supabase (mails d'auth à la charte)

> Bloqué sur une action manuelle : générer une clé SMTP Brevo (login requis).

## Pourquoi
Supabase **free tier interdit** de personnaliser les templates d'email d'auth
TANT QU'on utilise le SMTP par défaut (message API : "Email template modification
is not available for free tier projects using the default email provider").
→ Pour avoir les mails d'auth (confirmation/magic-link/recovery) à la charte
noir & or ET expédiés depuis @yoga-sculpt.fr, il FAUT un SMTP custom = Brevo.

## Ce qui est déjà prêt
- Templates HTML auth à la charte : `emails/auth/{magic-link,confirmation,recovery,invite}.html` (committés).
- Domaine `yoga-sculpt.fr` authentifié sur Brevo (DKIM/SPF/DMARC OK), sender `notifications@yoga-sculpt.fr`.
- Mails applicatifs (rappels J-1/H-2, invitation parrainage) DÉJÀ harmonisés DA + déployés.

## Action MANUELLE requise (Robert)
1. Se connecter à app.brevo.com → **SMTP & API → onglet SMTP** → générer une clé SMTP (master password SMTP).
   Host `smtp-relay.brevo.com`, port 587, user `8b5d2a002@smtp-brevo.com`.
2. La ranger dans `~/credentials/.all-creds.env` → `BREVO_SMTP_KEY=...`

## Ce que l'agent fait ENSUITE (tout par API)
1. Config SMTP custom Supabase (prod + staging) via Management API `config/auth` :
   `smtp_admin_email=notifications@yoga-sculpt.fr`, `smtp_host=smtp-relay.brevo.com`,
   `smtp_port=587`, `smtp_user=8b5d2a002@smtp-brevo.com`, `smtp_pass=<BREVO_SMTP_KEY>`,
   `smtp_sender_name=Yoga Sculpt`.
2. Pousser les 4 templates auth (`mailer_templates_*_content` + `mailer_subjects_*`) — débloqué une fois SMTP custom actif.
3. Tester un magic-link réel → vérifier réception depuis @yoga-sculpt.fr à la charte.
