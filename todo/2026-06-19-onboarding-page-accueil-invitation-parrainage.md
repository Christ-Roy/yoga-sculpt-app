# [P2] Onboarding — page d'accueil chaleureuse quand on arrive via un lien d'invitation

**Statut** : à faire · **Qui** : agent · **Source** : demande Robert 2026-06-19

## Besoin
Quand un filleul arrive via un **lien d'invitation parrainage** (`?ref=CODE`), il n'a
aujourd'hui aucun contexte : il tombe direct dans le flow d'onboarding standard. On veut
lui montrer une **première page d'accueil dédiée**, AVANT les étapes d'onboarding
classiques, qui explique pourquoi il est là et donne envie.

## Contenu (ton chaleureux, communautaire)
- Titre type : **« {Prénom du parrain} vous a invité(e) à faire du yoga ! »**
  (fallback si le prénom du parrain est inconnu : « Vous avez été invité(e) à faire du yoga ! »)
- Accroche type : **« Le yoga, c'est plus sympa entre ami(e)s 🧘 »**
- Éventuel sous-texte : ce qu'il y gagne (1ère séance, ambiance, etc.) — à caler avec la
  copy existante du ticket bienvenue / essai gratuit, rester cohérent (ne pas sur-promettre).
- CTA : « C'est parti » → enchaîne sur l'onboarding normal.

## Implémentation (à préciser par l'agent au moment du dev)
- Le code de parrainage est déjà capté côté arrivée (`?ref=CODE`, cf `src/lib/referral.ts`,
  `/api/parrainage/*`). Récupérer le **prénom du parrain** à partir du code pour personnaliser
  (lookup serveur sûr, le code → parrain ; ne PAS exposer d'info sensible du parrain, juste le
  prénom). Si pas de ref / code invalide → ne PAS afficher cette page (onboarding standard).
- Insérer la page comme **étape 0** du flow d'onboarding (avant l'étape objectif), conditionnée
  à la présence d'une invitation valide. Doit rester cohérente avec :
  - le flow 6 étapes actuel + la reprise d'avancement DB (`onboarding_draft`) — ne pas casser ;
  - chaque étape doit tenir sur un écran mobile (cf ticket onboarding mobile) ;
  - la DA noir & or + le médaillon.
- Tracking : logguer l'event "invitation_landing_view" (cohérent avec le système d'events
  existant) pour mesurer la conversion des invitations.

## Garde-fous à respecter
- Ne pas créditer/parrainer ici (le crédit suit la logique anti-abus durcie : cf
  `2026-06-19-qa-secu-parrainage-anti-abus-farmable.md` — crédit après 1ère séance honorée + cap).
  Cette page est purement **accueil/contexte**, pas un point de crédit.
- Pas d'open-redirect via le code/lien (le `?ref=` n'est pas une URL de redirection).

## Fichiers (probables)
- Flow onboarding (`src/app/onboarding/*`), composants d'étapes.
- `src/lib/referral.ts` (lookup prénom parrain depuis le code).
