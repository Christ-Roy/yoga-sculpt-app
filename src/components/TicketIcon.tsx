/**
 * TicketIcon — mini-ticket SVG en mode icône (compact, tient sur une ligne).
 * Sert à illustrer « N tickets à gagner » sans prendre de hauteur.
 * Forme billet stylisée : corps doré (collectif) ou sombre (particulier),
 * encoches latérales + ligne de perforation. Animé (shimmer) comme TicketCard.
 */
type TicketType = "collectif" | "particulier";

export function TicketIcon({
  type = "collectif",
  className = "h-9 w-14",
}: {
  type?: TicketType;
  className?: string;
}) {
  const collectif = type === "collectif";
  const uid = `tki-${type}`;
  return (
    <span
      className={`ticket-card inline-block ${className}`}
      role="img"
      aria-hidden="true"
    >
      <svg viewBox="0 0 56 36" fill="none" className="block h-full w-full">
        <defs>
          <linearGradient id={`${uid}-g`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#F4D58A" />
            <stop offset="100%" stopColor="#B08F54" />
          </linearGradient>
          <linearGradient id={`${uid}-shine`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#fff" stopOpacity="0" />
            <stop offset="50%" stopColor="#fff" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <mask id={`${uid}-m`}>
            <rect x="2" y="4" width="52" height="28" rx="4" fill="white" />
            <circle cx="38" cy="4" r="4" fill="black" />
            <circle cx="38" cy="32" r="4" fill="black" />
          </mask>
        </defs>
        <g mask={`url(#${uid}-m)`}>
          <rect
            x="2"
            y="4"
            width="52"
            height="28"
            fill={collectif ? `url(#${uid}-g)` : "#15120c"}
          />
          {!collectif && (
            <rect x="2" y="4" width="52" height="28" fill="none" stroke="#D4AD6A" strokeWidth="1" opacity="0.7" />
          )}
          {/* reflet shimmer */}
          <rect className="ticket-shine" x="-20" y="0" width="20" height="36" fill={`url(#${uid}-shine)`} opacity={collectif ? 0.7 : 0.4} />
        </g>
        {/* perforation */}
        <line x1="38" y1="9" x2="38" y2="27" stroke={collectif ? "#0e0e0e" : "#D4AD6A"} strokeWidth="1.5" strokeDasharray="1 3" strokeLinecap="round" opacity="0.5" />
        {/* étoile / pastille dans la souche */}
        <circle cx="46" cy="18" r="2.5" fill={collectif ? "#0e0e0e" : "#D4AD6A"} opacity="0.85" />
      </svg>
    </span>
  );
}
