"use client";

import { Logo } from "@/components/Logo";
import { SidebarTrigger } from "@/components/ui/sidebar";

/**
 * Barre supérieure mobile : bouton hamburger (ouvre le drawer) + médaillon.
 * Masquée sur desktop (≥ md) où la sidebar est toujours visible.
 *
 * `label` optionnel : petit badge à droite (ex. « Admin ») pour distinguer le
 * dashboard de l'espace client.
 */
export function SidebarTopbar({ label }: { label?: string }) {
  return (
    <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-bg/80 px-4 py-3 backdrop-blur-md md:hidden">
      <SidebarTrigger />
      {/* Médaillon seul : compact à côté du hamburger et du badge éventuel.
          Titre distinct → pas de collision d'ID de filtre SVG avec la sidebar
          (les deux coexistent dans le DOM mobile). */}
      <Logo title="Yoga Sculpt — menu" showText={false} />
      {label ? (
        <span className="ml-auto rounded-[var(--radius)] border border-accent/50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-widest text-accent">
          {label}
        </span>
      ) : null}
    </header>
  );
}
