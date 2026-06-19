# [P3] Insights : table « Par utilisateur » sans version mobile (scroll horizontal 860px)

> QA-cohérence responsive · 2026-06-19 · agent · LECTURE SEULE (finding)

## Le problème
La page `/admin/insights` contient une grande table « Par utilisateur » (8 colonnes :
Client, Acquisition, Séances, Tickets, Filleuls, Abandons, LTV, Dernière activité).
Elle est rendue en `overflow-x-auto` avec une largeur minimale forcée :

```tsx
// src/app/admin/insights/page.tsx:213-214
<div className="overflow-x-auto rounded-[4px] border border-border">
  <table className="w-full min-w-[860px] border-collapse text-sm">
```

Sur mobile (~375-390px de large), la table impose donc un **scroll horizontal de ~860px** :
l'admin doit faire défiler latéralement pour lire une ligne. C'est l'écran de pilotage le
plus dense de l'app.

## Incohérence
Les autres tables admin gèrent proprement le mobile avec un pattern « table desktop +
cartes empilées mobile » (même donnée, deux présentations) :
- `src/components/admin/ReservationsRecentes.tsx` (`<ul className="… md:hidden">` + table `hidden md:block`)
- `src/app/admin/comptes/_components/ComptesTable.tsx` (idem)
- `src/app/admin/insights/page.tsx` lui-même pour la table « Checkouts abandonnés »
  (l.119-204 : cartes mobile + table desktop).

Seule la table « Par utilisateur » déroge à ce pattern → incohérence responsive interne
à la même page Insights.

## Correctif recommandé
Appliquer le même pattern que les autres tables admin : version cartes empilées en
`md:hidden` (une carte par utilisateur, libellés = en-têtes de colonnes) + la table en
`hidden md:block`. Réutiliser le style des cartes de `ReservationsRecentes` / `ComptesTable`.

## Sévérité
**P3** : back-office, donnée toujours accessible (scroll), mais confort mobile dégradé et
incohérent avec le reste. Alice consultera probablement les Insights surtout sur desktop,
d'où P3 et non P2.

## Fichiers
- `src/app/admin/insights/page.tsx` (section « Par utilisateur », l.207-304)
