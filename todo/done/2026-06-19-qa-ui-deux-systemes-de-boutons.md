# [P3] Deux systèmes de boutons coexistent (`Button` maison vs `ui/button` shadcn)

> QA-cohérence design system · 2026-06-19 · agent · LECTURE SEULE (finding)

## Le problème
L'app a DEUX composants Button distincts, avec des APIs de variants différentes :

1. `src/components/Button.tsx` — maison, variants `primary` / `secondary` / `ghost`.
   - Utilisé par : login (`LoginForm`), onboarding (`OnboardingFlow`), profil (`ProfileCard`).
2. `src/components/ui/button.tsx` — shadcn (cva), variants `default` / `destructive` /
   `outline` / `secondary` / `ghost` / `link`, prop `size`, `asChild`.
   - Utilisé par : admin comptes (`InviterCompte`, `CompteActions`).

Les deux rendent bien la charte noir & or (le `default`/`primary` = `bg-accent text-[#0e0e0e]`),
donc **visuellement le résultat est proche** — pas de régression visible majeure. Mais :

- Le mapping de variants diffère (`primary` vs `default`, `secondary` ≠ même style entre
  les deux : maison `secondary` = bordure/surface, shadcn `secondary` = `bg-surface-2`).
- Beaucoup d'écrans n'utilisent NI l'un NI l'autre et réécrivent des `<button className="…
  inline-flex min-h-[44px] … bg-accent …">` à la main (réserver, parrainage, tickets,
  welcome banner, calendrier admin, réservations admin…). Le style or est dupliqué une
  douzaine de fois en classes inline.

## Pourquoi c'est un finding de cohérence
- Risque de dérive : chaque bouton inline est une occasion de diverger (padding, min-h,
  hover, focus-ring) — déjà des `min-h-[36px]` vs `min-h-[44px]` qui cohabitent.
- Le ticket `2026-06-19-toasts-loaders-feedback-ux.md` prévoit justement d'ajouter un état
  `loading` au composant Button : il faut d'abord trancher LEQUEL des deux est le canonique,
  sinon on ajoute `loading` à un Button que la moitié de l'app n'utilise pas.

## Correctif recommandé
Décision design system à prendre (puis propager) :
- **Choisir `ui/button` (shadcn)** comme canonique (cohérent avec la sidebar/Sheet/Tooltip
  déjà shadcn, et c'est là que le ticket toasts veut ajouter `loading`), migrer les usages
  de `components/Button` dessus, puis supprimer le doublon.
- Remplacer progressivement les `<button>` inline « or » par ce Button canonique (au moins
  dans les nouveaux écrans), pour tuer la duplication de la classe primaire.

À coordonner avec le ticket toasts/loaders (même cible) — ne PAS faire les deux en parallèle
sans séquencer (collisions).

## Sévérité
**P3** : dette de cohérence / maintenabilité, pas de bug ni de régression visuelle nette
aujourd'hui. À traiter de préférence AVANT le ticket toasts/loaders (dépendance logique).

## Fichiers
- `src/components/Button.tsx` (maison) + ses usages : `LoginForm`, `OnboardingFlow`, `ProfileCard`
- `src/components/ui/button.tsx` (shadcn) + ses usages : `InviterCompte`, `CompteActions`
- Boutons « or » inline (échantillon) : `ReserverClient`, `ReserverParticulierLibre`,
  `BuyTickets`, `TicketsWidget`, `WelcomeTicketBanner`, `ShareInvitation`, `InviteAmiForm`,
  `CalendrierClient`, `ReservationsManager`, `ConfirmDialog`.
