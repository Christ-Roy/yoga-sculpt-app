/**
 * Wordmark "YOGA SCULPT" en typo condensée (Anton), accent or sur "SCULPT".
 * Pas de lien vers le site vitrine — l'espace client vit seul.
 */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span
      className={`wordmark inline-flex items-baseline gap-2 text-xl leading-none select-none ${className}`}
      aria-label="Yoga Sculpt"
    >
      <span className="text-text">YOGA</span>
      <span className="text-accent">SCULPT</span>
    </span>
  );
}
