# Templates email d'authentification Supabase — Yoga Sculpt

HTML statiques (charte NOIR & OR) à coller dans la config Auth de Supabase.
Ils dupliquent **volontairement** le squelette de `src/lib/email-templates.ts`
(`renderEmail`) : Supabase ne peut pas appeler le code de l'app, donc le design
est répliqué en HTML pur autonome. **Si tu changes la DA dans `renderEmail`,
reporte le changement ici** (et inversement).

## Fichiers

| Fichier | Email Supabase | Variable du lien |
|---|---|---|
| `magic-link.html` | Magic Link (connexion sans mot de passe) | `{{ .ConfirmationURL }}` |
| `confirmation.html` | Confirm signup (confirmation d'adresse) | `{{ .ConfirmationURL }}` |
| `recovery.html` | Reset password (mot de passe oublié) | `{{ .ConfirmationURL }}` |
| `invite.html` | Invite user (invitation admin) | `{{ .ConfirmationURL }}` |

## Variables Supabase utilisées

Syntaxe Go template (Supabase GoTrue) :

- `{{ .ConfirmationURL }}` — lien d'action (connexion / confirmation / reset / invitation). **Toujours présent** comme `href` du bouton + lien de secours.
- `{{ .Email }}` — adresse du destinataire (affichée dans la mention de pied de page).
- `{{ .SiteURL }}` — URL du site (non utilisée ici, le footer pointe en dur vers `https://yoga-sculpt.fr` ; disponible si besoin).

Autres variables disponibles (non utilisées) : `{{ .Token }}`, `{{ .TokenHash }}`, `{{ .RedirectTo }}`, `{{ .Data }}`.

## Où coller (2 méthodes)

### A. Dashboard Supabase (manuel, par projet)

`Dashboard → Authentication → Emails → Templates`. Pour chaque type :
1. Ouvrir l'onglet correspondant (Confirm signup / Magic Link / Reset password / Invite user).
2. Coller le HTML du fichier dans le champ **Message body**.
3. Renseigner le **Subject** (proposés ci-dessous).
4. Enregistrer.

À faire **sur les deux projets** : prod et staging.

### B. Management API (`config/auth`)

`PATCH https://api.supabase.com/v1/projects/{ref}/config/auth` (header
`Authorization: Bearer <SUPABASE_MGMT_TOKEN>`), champs :

| Type | Champ contenu | Champ sujet |
|---|---|---|
| Magic Link | `mailer_templates_magic_link_content` | `mailer_subjects_magic_link` |
| Confirm signup | `mailer_templates_confirmation_content` | `mailer_subjects_confirmation` |
| Reset password | `mailer_templates_recovery_content` | `mailer_subjects_recovery` |
| Invite | `mailer_templates_invite_content` | `mailer_subjects_invite` |

Le contenu attendu est le HTML brut du fichier (chaîne JSON échappée).

## Sujets recommandés

- Magic Link : `Votre lien de connexion Yoga Sculpt`
- Confirm signup : `Confirmez votre adresse — Yoga Sculpt`
- Reset password : `Réinitialiser votre mot de passe — Yoga Sculpt`
- Invite : `Vous êtes invité·e à rejoindre Yoga Sculpt`
