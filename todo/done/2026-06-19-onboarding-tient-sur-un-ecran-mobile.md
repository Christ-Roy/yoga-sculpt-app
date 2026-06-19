# [P2] Onboarding : chaque étape tient sur un écran mobile (pas de scroll)

**Statut** : non fait · **Qui** : agent · **Demande Robert 2026-06-19**

## Demande
TOUTES les étapes de l'onboarding (les 6 : objectif / niveau / disponibilités / format / parrainage / final) doivent **tenir sur un écran de téléphone sans scroll**. L'étape 5 (parrainage) vient d'être compactée (mini-tickets sur une ligne, 3 boutons) — vérifier qu'elle tient ET appliquer le même soin aux autres.

## Points à vérifier / corriger (sur viewport mobile ~375×667 à ~390×844)
- **Étape 1 (objectif)** : 4 options + titre + barre → vérifier que ça rentre (les cartes sm:py-6 peuvent être trop hautes sur mobile → réduire le padding mobile).
- **Étape format (4)** : layout split = 2 grandes images aspect-[4/5] + option centrale → potentiellement trop haut sur mobile. Réduire le ratio des images sur mobile (aspect plus paysage) pour que tout tienne.
- **Étape 6 (final)** : 2 cartes tickets Stripe + bouton → vérifier.
- **En général** : le titre `text-3xl sm:text-4xl lg:text-5xl` peut être trop gros sur petit écran + le `py-12` du `<main>` mange de la hauteur → ajuster les paddings/tailles en mobile-first.

## Méthode
- Tester chaque étape sur viewport mobile réel (dev tools device mode 375px ET 390px).
- Réduire ce qui dépasse : padding vertical des options sur mobile, taille titre mobile, ratio images split mobile, gaps.
- Le contenu doit rester lisible et les cibles tactiles ≥44px. Ne pas tasser au point d'être illisible — si une étape a trop de contenu pour tenir (ex. format avec 2 grandes images), privilégier des images plus courtes en hauteur sur mobile plutôt que de tout rétrécir.
- Garder le rendu desktop actuel (qui est bien) — c'est du mobile-first à ajouter, pas une régression desktop.

## Fichiers
- `src/app/onboarding/OnboardingFlow.tsx` (tailles/paddings responsive)
- `src/app/onboarding/page.tsx` (le py-12 du main)
- éventuellement `globals.css` si une util manque

## Impact
La cible (clientes yoga venant de "Essai gratuit") est massivement sur mobile. Un onboarding qui scrolle/déborde fait mal au taux de complétion.
