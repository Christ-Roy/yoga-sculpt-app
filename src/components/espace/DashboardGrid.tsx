import type { ReactNode } from "react";

/**
 * Grille responsive du tableau de bord `/espace`.
 *
 * - mobile : 1 colonne (cartes empilées) ;
 * - ≥ md   : 2 colonnes ;
 * - ≥ xl   : 3 colonnes.
 *
 * `items-start` pour que chaque carte garde sa hauteur naturelle (pas d'étirement
 * forcé d'une carte courte sur la hauteur d'une longue). Les widgets qui doivent
 * occuper plus d'une colonne posent eux-mêmes leur `className` (col-span).
 */
export function DashboardGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 items-start gap-4 sm:gap-5 md:grid-cols-2 xl:grid-cols-3">
      {children}
    </div>
  );
}
