import { Loader2 } from "lucide-react";

/**
 * Spinner inline réutilisable (charte : hérite `currentColor`). Pour les boutons
 * « or inline » qui ne passent pas par `ui/button` (lequel a déjà son spinner).
 * Rotation coupée sous prefers-reduced-motion (`motion-safe`). Décoratif.
 */
export function Spinner({ className = "size-4" }: { className?: string }) {
  return (
    <Loader2
      className={`${className} motion-safe:animate-spin`}
      aria-hidden="true"
    />
  );
}
