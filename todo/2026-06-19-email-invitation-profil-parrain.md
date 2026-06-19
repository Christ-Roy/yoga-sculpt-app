# [P2] Email d'invitation parrainage — afficher le PROFIL du parrain (avatar + email), pas que le nom

**Statut** : à faire · **Qui** : agent · **Source** : demande Robert 2026-06-19

## Besoin
Quand un parrain invite un filleul **par e-mail** (`/api/parrainage/inviter` → email Brevo),
le filleul doit **savoir clairement qui l'invite**. Aujourd'hui l'email passe seulement le
**nom** du parrain (`parrainNom`, via `envoyerInvitation`). On veut un vrai bloc « profil
parrain » dans l'email : **avatar + prénom + email du parrain**, comme sur la page `/invitation`.

## État actuel (ne pas refaire)
- ✅ Page `/invitation?ref=CODE` : affiche DÉJÀ avatar + prénom + email du parrain
  (`parrainPublicParCode` dans `src/lib/referral.ts`, rendu dans `src/app/invitation/page.tsx`). Livré, en prod.
- ⬜ Email Brevo d'invitation (`/api/parrainage/inviter` → `envoyerInvitation` →
  `src/lib/email-templates.ts`) : ne passe QUE `parrainNom` (le nom). Pas d'avatar, pas d'email.

## À faire
- Étendre `/api/parrainage/inviter/route.ts` : récupérer le profil complet du parrain
  (réutiliser `parrainPublicParCode` ou un lookup équivalent → prénom + avatarUrl + email)
  et le passer à `envoyerInvitation`.
- Template email (`src/lib/email-templates.ts`) : bloc « {Prénom} ({email}) vous invite »
  avec l'avatar. ⚠️ HTML email = tables + styles inline (pas de flex/grid). Avatar = `<img>`
  distant (Google `avatar_url`) en cercle ; fallback initiale si pas d'avatar. Échapper le
  prénom/email (`escapeHtml`). Préheader d'aperçu cohérent (« {Prénom} vous invite… »).
- Décision Robert déjà actée : afficher l'**email du parrain en clair** est OK
  (cf [[yoga-sculpt-espace-client]] / décision 2026-06-19). Cohérent avec la page /invitation.
- Best-effort : si profil/avatar absent → retomber sur le nom seul, jamais d'email cassé.

## Fichiers
`src/app/api/parrainage/inviter/route.ts`, `src/lib/email-templates.ts`, `src/lib/referral.ts`
(lookup profil parrain réutilisé). Test du rendu (avatar présent/absent).
