import YsMonogram from "./YsMonogram";

/**
 * Logo Yoga Sculpt — médaillon (monogramme YS animé serti dans un anneau or)
 * + wordmark "YOGA SCULPT" (Anton, accent or sur "SCULPT").
 * L'espace client garde le TEXTE à côté du médaillon (contrairement au site
 * vitrine où le médaillon est seul). Pas de lien vers le vitrine.
 *
 * Props :
 *   - className : classes sur le conteneur
 *   - showText  : afficher le wordmark (défaut true). false = médaillon seul.
 *   - title     : libellé accessible + ID de filtre SVG unique par instance.
 */
export function Logo({
  className = "",
  showText = true,
  title = "Yoga Sculpt",
}: {
  className?: string;
  showText?: boolean;
  title?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-3 select-none ${className}`}
      aria-label="Yoga Sculpt"
    >
      <span
        className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
        style={{
          background:
            "radial-gradient(circle at 50% 36%, #FBF8F1 0%, #F2F0EC 70%, #E8E3D8 100%)",
          border: "1.5px solid var(--accent)",
          boxShadow:
            "0 0 0 1px rgba(212,173,106,0.18) inset, 0 4px 14px rgba(0,0,0,0.28)",
        }}
      >
        <YsMonogram className="h-[64%] w-[64%]" color="#B08F54" title={title} />
      </span>
      {showText && (
        <span className="wordmark inline-flex items-baseline gap-2 text-xl leading-none">
          <span className="text-text">YOGA</span>
          <span className="text-accent">SCULPT</span>
        </span>
      )}
    </span>
  );
}
