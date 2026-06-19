"use client";

/**
 * TicketCard — ticket de séance en SVG, design premium noir & or.
 * Deux variantes : "collectif" (cours en groupe) et "particulier" (cours privé).
 * Animation "shimmer" : un reflet doré balaie le ticket de temps en temps.
 *
 * Forme billet : coins encochés (les deux demi-cercles latéraux), ligne de
 * perforation verticale qui sépare la souche, motif distinct par type.
 */

type TicketType = "collectif" | "particulier";

export function TicketCard({
  type,
  count,
  className = "",
}: {
  type: TicketType;
  /** Nombre de séances restantes (affiché dans la souche). */
  count: number;
  className?: string;
}) {
  const collectif = type === "collectif";
  const uid = `tk-${type}`;
  const titre = collectif ? "Cours collectif" : "Cours particulier";
  const sousTitre = collectif ? "En groupe" : "Séance privée";

  return (
    <div
      className={`ticket-card relative ${className}`}
      role="img"
      aria-label={`${count} ticket${count > 1 ? "s" : ""} ${titre}`}
    >
      <svg viewBox="0 0 360 132" className="block w-full h-auto" fill="none">
        <defs>
          {/* dégradé or du corps */}
          <linearGradient id={`${uid}-gold`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#F4D58A" />
            <stop offset="45%" stopColor="#D4AD6A" />
            <stop offset="100%" stopColor="#B08F54" />
          </linearGradient>
          {/* dégradé sombre (variante particulier = corps noir, accents or) */}
          <linearGradient id={`${uid}-ink`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#1d1a14" />
            <stop offset="100%" stopColor="#0e0e0e" />
          </linearGradient>
          {/* bande de reflet pour le shimmer */}
          <linearGradient id={`${uid}-shine`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="50%" stopColor="#ffffff" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
          {/* masque = forme du ticket (corps + encoches latérales) */}
          <mask id={`${uid}-shape`}>
            <rect x="4" y="4" width="352" height="124" rx="12" fill="white" />
            <circle cx="248" cy="4" r="11" fill="black" />
            <circle cx="248" cy="128" r="11" fill="black" />
          </mask>
        </defs>

        <g mask={`url(#${uid}-shape)`}>
          {/* corps */}
          <rect
            x="4"
            y="4"
            width="352"
            height="124"
            fill={collectif ? `url(#${uid}-gold)` : `url(#${uid}-ink)`}
          />
          {/* souche (partie droite, après la perforation) */}
          <rect
            x="248"
            y="4"
            width="108"
            height="124"
            fill={collectif ? "#caa460" : "#15120c"}
            opacity={collectif ? 0.55 : 1}
          />
          {/* bord or pour la variante particulier */}
          {!collectif && (
            <rect
              x="4"
              y="4"
              width="352"
              height="124"
              fill="none"
              stroke="#D4AD6A"
              strokeWidth="1.5"
              opacity="0.6"
            />
          )}

          {/* reflet shimmer animé (balaye horizontalement) */}
          <rect
            className="ticket-shine"
            x="-120"
            y="0"
            width="120"
            height="132"
            fill={`url(#${uid}-shine)`}
            opacity={collectif ? 0.7 : 0.4}
          />
        </g>

        {/* ligne de perforation */}
        <line
          x1="248"
          y1="20"
          x2="248"
          y2="112"
          stroke={collectif ? "#0e0e0e" : "#D4AD6A"}
          strokeWidth="2"
          strokeDasharray="2 6"
          strokeLinecap="round"
          opacity="0.5"
        />

        {/* ─ Texte partie gauche ─ */}
        <text
          x="28"
          y="42"
          fontFamily="Anton, sans-serif"
          fontSize="13"
          letterSpacing="2"
          fill={collectif ? "#0e0e0e" : "#D4AD6A"}
          opacity="0.85"
        >
          YOGA SCULPT
        </text>
        <text
          x="28"
          y="78"
          fontFamily="Anton, sans-serif"
          fontSize="26"
          fill={collectif ? "#0e0e0e" : "#F2F0EC"}
        >
          {titre.toUpperCase()}
        </text>
        <text
          x="28"
          y="100"
          fontFamily="Inter, sans-serif"
          fontSize="12"
          fill={collectif ? "#3a3325" : "#9a9080"}
        >
          {sousTitre} · valable 1 séance
        </text>

        {/* ─ Souche : nombre de séances ─ */}
        <text
          x="302"
          y="58"
          textAnchor="middle"
          fontFamily="Anton, sans-serif"
          fontSize="40"
          fill={collectif ? "#0e0e0e" : "#D4AD6A"}
        >
          {count}
        </text>
        <text
          x="302"
          y="80"
          textAnchor="middle"
          fontFamily="Inter, sans-serif"
          fontSize="10"
          letterSpacing="1.5"
          fill={collectif ? "#3a3325" : "#9a9080"}
        >
          SÉANCE{count > 1 ? "S" : ""}
        </text>
      </svg>
    </div>
  );
}
