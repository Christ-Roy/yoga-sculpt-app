# [P3] Image de fond floutée derrière le login

**Statut** : non fait · **Qui** : agent · **Demande Robert 2026-06-19**

## Demande
Ajouter une **image de fond floutée** derrière la page `/login` (et idéalement `/auth/confirm`, `/onboarding` pour cohérence) → rendu plus chaleureux/premium qu'un fond noir plat.

## Détail
- Photo N&B de la banque d'images yoga existante (`public/images/...` — réutiliser une photo de séance, cohérente avec la galerie du vitrine). Ou une photo dédiée.
- Traitement : `filter: blur(...)` + overlay sombre (`rgba(14,14,14,0.7-0.8)`) pour garder le contraste du formulaire (lisibilité = priorité, le flou ne doit pas gêner la lecture des champs).
- Charte noir & or respectée (accent or sur le formulaire qui ressort).
- Performance : image optimisée WebP, `object-cover`, pas de layout shift. Respecter `prefers-reduced-motion` si animation (pas d'anim lourde).
- Accessibilité : l'image est décorative (`aria-hidden`), contraste du formulaire ≥ WCAG AA maintenu malgré le fond.

## Fichiers
- `src/app/login/page.tsx` (+ `auth/confirm`, `onboarding` si on harmonise) ou un composant `AuthBackground` partagé.

## Impact
Cosmétique mais améliore nettement la première impression (le login est la 1ère page vue par un nouveau client venu de "Essai gratuit"). À coordonner avec l'agent cohérence/charte (mêmes fichiers).
