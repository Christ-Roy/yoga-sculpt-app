# [P3] Fiche compte admin : statut des filleuls affiché en BRUT ("pending"/"completed")

> QA-cohérence libellés · 2026-06-19 · agent · LECTURE SEULE (finding)

## Le problème
Sur la fiche d'un compte (`/admin/comptes/[id]`), la section « Filleuls parrainés »
affiche la valeur DB technique du statut, telle quelle :

```tsx
// src/app/admin/comptes/[id]/page.tsx:191-193
<span className="text-xs text-text-secondary">
  {f.status}                            // ← "pending" / "completed" (anglais, brut)
  {f.ticketCredite ? " · ticket crédité" : ""}
</span>
```

Alice (admin) voit donc « pending » / « completed » en anglais, valeurs internes.

## Incohérence
Partout ailleurs dans l'app, ce même statut est traduit en FR :
- `src/app/espace/parrainer/ParrainerClient.tsx` → « En attente » / « ✓ Inscrit »
- `src/components/espace/ParrainageWidget.tsx` → compte les `completed` mais affiche du FR.

La fiche compte est le seul endroit qui laisse fuiter le libellé technique.

## Correctif recommandé
Mapper `f.status` sur un libellé FR cohérent avec le reste (« En attente » / « Inscrit »),
idéalement via un petit badge réutilisant le style des autres badges de statut
(`CompteBadges.tsx`), ou a minima un ternaire.

## Sévérité
**P3** : back-office uniquement (pas vu par le client final), purement cosmétique, mais
c'est une incohérence de libellé qui fait « interface pas finie ». Trivial.

## Fichiers
- `src/app/admin/comptes/[id]/page.tsx` (l.179-199, le `{f.status}` l.191)
