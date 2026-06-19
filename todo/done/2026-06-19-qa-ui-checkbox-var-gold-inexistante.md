# [P2] Checkboxes admin sur `var(--gold)` (variable INEXISTANTE) → pas dorées

> QA-cohérence charte · 2026-06-19 · agent · LECTURE SEULE (finding)

## Le problème
La charte NOIR & OR définit la variable d'accent comme **`--accent`** (`#d4ad6a`) dans
`src/app/globals.css`. Il n'existe **AUCUNE** variable `--gold` dans le CSS.

Or deux checkboxes du back-office « Réservations » utilisent `accent-[var(--gold)]` :

```tsx
// src/app/admin/reservations/ReservationsManager.tsx
l.374  className="mt-0.5 accent-[var(--gold)]"   // « Recréditer le ticket »
l.385  className="mt-0.5 accent-[var(--gold)]"   // « Forcer l'annulation < 24h »
```

`var(--gold)` étant indéfini (et sans fallback), la propriété CSS `accent-color` est
invalide → les deux cases cochées s'affichent dans l'**accent par défaut du navigateur/OS**
(bleu ou violet selon la plateforme), PAS en or.

## Incohérence visible
À côté, `src/app/admin/calendrier/CalendrierClient.tsx:478` fait correctement
`className="accent-accent"` (case « Répéter chaque semaine » bien dorée). Donc dans le
back-office, certaines cases à cocher sont or et d'autres bleues/violettes — incohérence
charte directe sur des contrôles que l'admin (Alice) voit régulièrement, et précisément
sur les **deux options les plus sensibles** (recrédit + forçage d'annulation).

## Note connexe (même cause, mais OK par chance)
`src/components/YsMonogram.tsx:70` utilise aussi `var(--gold, #D4AD6A)` — mais avec un
**fallback**, donc le médaillon rend bien l'or. À garder en tête : il vaudrait mieux
aligner ce composant sur `var(--accent)` pour une seule source de vérité couleur (et
éviter qu'un futur usage de `var(--gold)` sans fallback casse à nouveau). Non bloquant.

## Correctif recommandé (quick-win, < 2 min)
Remplacer les deux `accent-[var(--gold)]` par **`accent-accent`** (cohérent avec
CalendrierClient). Optionnellement, harmoniser `YsMonogram` sur `var(--accent, #D4AD6A)`.

## Sévérité
**P2** : purement cosmétique (pas de bug fonctionnel), mais c'est une dérogation charte
nette, visible côté admin, et triviale à corriger. Quick-win laissé en ticket pour ne
toucher aucun code en mode QA lecture seule.

## Fichiers
- `src/app/admin/reservations/ReservationsManager.tsx` (l.374, l.385)
- (connexe) `src/components/YsMonogram.tsx` (l.70)
