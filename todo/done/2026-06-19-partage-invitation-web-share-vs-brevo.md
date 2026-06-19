# [P2] Partage d'invitation (parrainage / ticket cadeau) : Web Share natif sur mobile, Brevo sur PC

**Statut** : non fait · **Qui** : agent · **Demande Robert 2026-06-19**

## Décision Robert
Le partage d'une invitation (lien de **parrainage** d'ami, et plus tard **ticket cadeau**) doit s'adapter au device :
- **Sur mobile** : utiliser le **partage natif réseaux sociaux** du téléphone — `navigator.share()` (Web Share API) → ouvre la feuille de partage iOS/Android (WhatsApp, SMS, Instagram, Messenger, etc.). Pas d'email forcé.
- **Sur PC / desktop** (où `navigator.share` n'est pas dispo ou peu utile) : envoyer l'invitation **par email via Brevo** (le flux `inviter` existant, expéditeur `notifications@yoga-sculpt.fr`).

## Détail technique
- **Détection** : `if (navigator.share && /* mobile/touch */)` → bouton "Partager" qui appelle `navigator.share({ title, text, url })` avec le lien de parrainage (`https://app.yoga-sculpt.fr/login?ref=<CODE>`). Fallback `navigator.clipboard.writeText` + toast "lien copié" si `navigator.share` absent.
- **Desktop** : garder le formulaire email actuel (saisie email ami → `POST /api/parrainage/inviter` → Brevo). C'est déjà en place ; juste le présenter quand on n'est pas sur mobile.
- **UI** : la page/section parrainage (`src/app/espace/...` parrainer, + le widget parrainage du dashboard) propose les 2 voies selon le device : un bouton "Partager" (mobile-first, Web Share) ET "Inviter par email" (desktop). Idéalement : bouton Partager visible partout (copie le lien si pas de share natif), et le champ email visible sur desktop.
- Le **lien de parrainage** doit être le même que celui déjà généré (`GET /api/parrainage` → code) — réutiliser, ne pas recréer la mécanique (le parrainage e2e vient d'être réparé : cookie `ys_ref`, completer, fingerprint).
- Émettre l'event tracking `referral_invited` aussi sur le partage Web Share (best-effort, via un petit POST à `/api/parrainage/inviter` en mode "lien partagé" OU un endpoint léger — à voir, ne pas casser l'idempotence).

## Fichiers concernés
- Page/section parrainage côté espace client (`src/app/espace/**` — chercher `ParrainerClient` / widget parrainage), composant client.
- Réutilise `/api/parrainage` (lien) et `/api/parrainage/inviter` (email Brevo desktop).

## Plus tard (ticket cadeau)
Le ticket cadeau (carte cadeau, repoussé) suivra la même logique de partage quand il sera activé. Mutualiser le composant de partage.

## Impact
Croissance : le partage natif mobile (WhatsApp/SMS) a un taux de conversion bien supérieur à l'email sur le segment cible. Faible effort (Web Share API native), fort levier viral.
