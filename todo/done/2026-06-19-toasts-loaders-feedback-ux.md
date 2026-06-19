# [P2] Toasts + loaders sur chaque action (feedback UX pro)

**Statut** : non fait · **Qui** : agent · **Demande Robert 2026-06-19**

## Décision Robert
Chaque action utilisateur doit donner un **feedback visuel** :
- un **toast** (notification temporaire) de succès / erreur
- un **petit loader** (spinner) pendant l'action en cours (bouton en état loading)
Objectif : rendu plus **pro**, l'utilisateur sait toujours ce qui se passe.

## Périmètre — toutes les actions de l'espace client
- **Réservation** : réserver un créneau, annuler → toast "Séance réservée ✓" / "Réservation annulée" + bouton en loading pendant l'appel.
- **Tickets / paiement** : "Prendre des tickets" (redirection Stripe) → loader pendant la création de session.
- **Parrainage** : invitation envoyée / lien copié / partagé → toast.
- **Profil / onboarding** : sauvegarde → toast "Profil mis à jour".
- **Admin** (back-office) : crédit/débit ticket, reset mdp, magic-link, suspension, création/édition créneau & preset, annuler/déplacer résa, marquer présence → toast succès/erreur + loader. (Plusieurs agents admin ont déjà mis du `window.confirm` + des toasts maison — UNIFIER.)
- **Auth** : login (magic-link envoyé), confirm → toast.

## Détail technique
- **Système de toast unifié** : créer (ou consolider s'il en existe déjà un — vérifier `src/components/`, certains agents ont posé des "toasts" maison) UN provider de toast réutilisable, charte noir & or de l'app (fond `--surface`/ink, accent or, succès/erreur/info). Position cohérente (ex bas-droite ou haut-centre). Auto-dismiss + closable. Accessible (`role="status"` / `aria-live`).
  - Option : adopter une lib légère (sonner, react-hot-toast) OU un provider maison (zéro dep, cohérent avec le reste). Décision agent : si l'app a déjà shadcn/radix (la sidebar est shadcn), un toast shadcn/sonner est cohérent. Sinon maison. Documenter le choix.
- **État loading des boutons** : pattern réutilisable (bouton désactivé + spinner inline) pendant les appels async. Composant `Button` avec prop `loading`, ou hook `useAction` qui gère pending/success/error + toast automatiquement.
- **Uniformiser** : remplacer les feedbacks ad-hoc déjà posés par les agents (toasts maison disparates, `window.confirm` bruts) par le système unifié. Garder les confirmations sur les actions destructives mais via une modale cohérente (un agent a déjà fait `ConfirmDialog` côté admin réservations — réutiliser/généraliser).

## Fichiers concernés (large)
- Nouveau : `src/components/ui/toast.tsx` (ou provider) + `src/components/ui/Button` (état loading) ou hook `useAction`.
- Tous les composants client qui déclenchent une action (réserver, annuler, BuyTickets, parrainage, profil, onboarding, et les `*Actions`/`*Manager` admin).
- Monter le ToastProvider dans le layout racine (`src/app/layout.tsx` ou un provider client).

## Impact
UX : perçu beaucoup plus pro et rassurant. Effort moyen (1 système + propagation). À faire idéalement APRÈS / EN COORDINATION avec les agents en cours (logo, résa libre, ticket bienvenue, partage, relance) qui touchent ces mêmes composants — sinon collisions. Le team-lead séquence.
