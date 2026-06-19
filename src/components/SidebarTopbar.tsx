"use client";

import { Menu } from "lucide-react";

import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";

/**
 * Barre supérieure mobile : burger (ouvre le drawer) en HAUT À GAUCHE + médaillon
 * + wordmark. Masquée sur desktop (≥ md) où la sidebar est toujours visible.
 *
 * Le burger utilise une VRAIE icône hamburger (lucide `Menu`, 3 traits) plutôt
 * que l'icône « panneau » par défaut de shadcn — c'est le repère universel d'un
 * menu mobile. Cible tactile ≥ 44px (h-11/w-11). Toggle = `toggleSidebar()`
 * (ouvre le Sheet `openMobile` sur mobile).
 *
 * `label` optionnel : petit badge à droite (ex. « Admin ») pour distinguer le
 * dashboard de l'espace client.
 */
export function SidebarTopbar({ label }: { label?: string }) {
  const { toggleSidebar } = useSidebar();

  return (
    <header className="sticky top-0 z-20 flex items-center gap-2.5 border-b border-border bg-bg/85 px-3 py-2.5 backdrop-blur-md md:hidden">
      {/* Burger en HAUT À GAUCHE : cible tactile ≥ 44px (le bouton shadcn fait
          36px par défaut, trop petit au pouce). Bordure discrète + hover or. */}
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={toggleSidebar}
        aria-label="Ouvrir le menu"
        className="size-11 shrink-0 hover:text-accent"
      >
        <Menu className="size-5" aria-hidden="true" />
      </Button>
      {/* Médaillon seul : compact à côté du hamburger et du badge éventuel.
          Titre distinct → pas de collision d'ID de filtre SVG avec la sidebar
          (les deux coexistent dans le DOM mobile). */}
      <Logo title="Yoga Sculpt — menu" showText={false} />
      <span className="wordmark min-w-0 truncate text-base leading-none">
        <span className="text-text">YOGA</span>{" "}
        <span className="text-accent">SCULPT</span>
      </span>
      {label ? (
        <span className="ml-auto shrink-0 rounded-[var(--radius)] border border-accent/50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-widest text-accent">
          {label}
        </span>
      ) : null}
    </header>
  );
}
