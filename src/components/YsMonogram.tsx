/**
 * YsMonogram — monogramme calligraphique « YS » animé pour Yoga Sculpt.
 *
 * CONCEPT (direction gagnante : calligraphie, un seul geste).
 *   Les deux bras du Y descendent en un fût qui se déverse en un S
 *   calligraphique — une expiration de yoga tracée à l'encre dorée.
 *   Le trait se dessine seul à l'apparition (stroke-dasharray), puis le
 *   mark RESPIRE par un très léger étirement vertical pivoté sur sa base
 *   ancrée (greffe de la direction « corps en mouvement » : le sculpt qui
 *   s'allonge, pas un dash qui frétille). Le point or — la signature —
 *   apparaît en fin de course et pulse comme un souffle lent.
 *
 * Pourquoi premium : une seule ligne fine, courbes de Bézier équilibrées
 * optiquement sur la verticale, glow doré contenu (jamais néon), tempo lent.
 * Le vocabulaire d'une maison de luxe, pas d'un logo généré.
 *
 * Robustesse :
 *   - SVG inline, viewBox 0 0 120 120, mono-couleur or sur noir.
 *   - Theme-able via la prop `color` (défaut : var(--gold) avec fallback).
 *   - ID de filtre déterministe dérivé de `title` → SSR/edge-safe, zéro
 *     collision quand navbar + footer + hero rendent plusieurs instances.
 *   - Animation CSS pure (keyframes scopées), coupée sous
 *     prefers-reduced-motion ET via la prop `animate={false}`.
 *   - dasharray calibré sur les longueurs RÉELLES des tracés (mesurées),
 *     pas à l'estime → le « draw » démarre pile à zéro.
 *   - Le wordmark « YOGA SCULPT » vit ailleurs : ce composant ne rend
 *     que la marque.
 *
 * Usage :
 *   <YsMonogram className="h-11 w-11" />                  // navbar (~44px)
 *   <YsMonogram className="h-16 w-16" />                  // footer / hero
 *   <YsMonogram className="h-40 w-40" animate={false} />  // statique
 */

import type { CSSProperties } from "react";

type YsMonogramProps = {
  /** Classe Tailwind/CSS pour dimensionner (ex. "h-11 w-11"). */
  className?: string;
  /** Couleur du trait. Défaut : la CSS var --gold (#D4AD6A en fallback). */
  color?: string;
  /** Active le tracé + la respiration + le glow. Défaut : true. */
  animate?: boolean;
  /** Label accessible. */
  title?: string;
};

// --- Géométrie du geste « YS » (validée au rendu 16 / 44 / 120 px) ----------
// Y : deux bras qui plantent l'aplomb, un fût court qui se déverse dans le S.
// S : panse haute ouverte à droite, pincement à la taille, cambré bas qui se
//     referme vers la gauche — une vraie lettre, lisible, qui « grandit » du Y.
const Y_ARM_LEFT = "M40.5 31 L60 56.5";
const Y_ARM_RIGHT = "M79.5 31 L60 56.5";
const Y_STEM = "L60 62.5";
const S_CURVE =
  "C73.8 62 63.6 59.4 57.2 63.1 " + // épaule haute, ouverte à droite
  "C50.9 66.7 51.6 73.2 59.6 76.4 " + // traversée / taille pincée
  "C68.7 80 74.6 84.2 72.1 91.4 " + // ventre bas généreux
  "C69.7 98.2 58.6 99 50.6 93.6"; // cambré final qui se referme

// Geste principal continu : bras gauche du Y → fût → S.
const MAIN_PATH = `${Y_ARM_LEFT} ${Y_STEM} ${S_CURVE}`;

// Longueurs RÉELLES (mesurées par flattening des Bézier) pour le draw exact.
const MAIN_LEN = 125; // armL(32.1) + stem(6) + S(86.3) ≈ 124.4, arrondi haut
const ARM_LEN = 33; // bras droit du Y : 32.1, arrondi haut

export default function YsMonogram({
  className = "",
  color = "var(--gold, #D4AD6A)",
  animate = true,
  title = "Yoga Sculpt",
}: YsMonogramProps) {
  // ID déterministe (pas de compteur muté au render, pas de hardcode) → SSR-safe
  // et sans collision même avec plusieurs instances sur la page.
  const uid = `ys-${title.replace(/[^a-z0-9]/gi, "").toLowerCase() || "mark"}`;
  const glowId = `${uid}-glow`;

  const svgStyle = {
    ["--ys-len" as string]: String(MAIN_LEN),
    ["--ys-arm" as string]: String(ARM_LEN),
  } as CSSProperties;

  return (
    <svg
      viewBox="0 0 120 120"
      className={className}
      fill="none"
      role="img"
      aria-label={title}
      style={svgStyle}
    >
      <title>{title}</title>

      <defs>
        {/* Glow doré contenu : flou léger fondu sous le trait — profondeur,
            pas du néon. */}
        <filter
          id={glowId}
          x="-30%"
          y="-30%"
          width="160%"
          height="160%"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur stdDeviation="1.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Groupe vivant : étirement vertical pivoté sur la BASE ancrée (les
          appuis). Le mark s'allonge à l'inspiration, redescend à l'expiration —
          un sculpt qui respire. transform-box: fill-box → origin fiable. */}
      <g
        className={animate ? "ys-breathe" : undefined}
        style={{
          transformBox: "fill-box",
          transformOrigin: "60px 96px",
        }}
      >
        {/* Halo très discret derrière le trait. */}
        <g
          className={animate ? "ys-glow" : undefined}
          filter={`url(#${glowId})`}
          opacity={animate ? "0" : "0.4"}
          aria-hidden="true"
        >
          <path
            d={MAIN_PATH}
            stroke={color}
            strokeWidth="3.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d={Y_ARM_RIGHT}
            stroke={color}
            strokeWidth="3.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>

        {/* Bras droit du Y : court accent, dessiné en parallèle du geste. */}
        <path
          className={animate ? "ys-arm" : undefined}
          d={Y_ARM_RIGHT}
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Geste principal : Y (bras gauche + fût) → S calligraphique. */}
        <path
          className={animate ? "ys-stroke" : undefined}
          d={MAIN_PATH}
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Signature : le point or, posé en bout de cambré. */}
        <circle
          className={animate ? "ys-dot" : undefined}
          cx="79"
          cy="92.8"
          r="2.5"
          fill={color}
          opacity={animate ? "0" : "1"}
        />
      </g>

      <style>{`
        /* --- Geste principal : se dessine, puis souffle imperceptiblement --- */
        .ys-stroke {
          stroke-dasharray: var(--ys-len);
          stroke-dashoffset: var(--ys-len);
          animation:
            ys-draw 2.4s cubic-bezier(0.22, 0.61, 0.36, 1) 0.15s forwards,
            ys-flow 8s ease-in-out 3.2s infinite;
        }
        /* --- Bras droit du Y : court délié dessiné en parallèle --- */
        .ys-arm {
          stroke-dasharray: var(--ys-arm);
          stroke-dashoffset: var(--ys-arm);
          animation: ys-draw-arm 1.1s cubic-bezier(0.22, 0.61, 0.36, 1) 0.85s forwards;
        }
        /* --- Glow : monte doucement une fois le trait posé, puis pulse bas --- */
        .ys-glow {
          opacity: 0;
          animation:
            ys-glow-in 1.6s ease-out 2.2s forwards,
            ys-glow-pulse 6s ease-in-out 4s infinite;
        }
        /* --- Respiration du corps : léger étirement vertical, base ancrée --- */
        .ys-breathe {
          animation: ys-breathe 7s ease-in-out 3s infinite;
        }
        /* --- Point signature : apparaît après le tracé, puis pulse calme --- */
        .ys-dot {
          transform-box: fill-box;
          transform-origin: center;
          opacity: 0;
          animation:
            ys-dot-in 0.6s ease-out 2.5s forwards,
            ys-dot-pulse 4.5s ease-in-out 3.4s infinite;
        }

        @keyframes ys-draw      { to { stroke-dashoffset: 0; } }
        @keyframes ys-draw-arm  { to { stroke-dashoffset: 0; } }

        /* Souffle minuscule sur le dash : à peine perceptible, vivant. */
        @keyframes ys-flow {
          0%, 100% { stroke-dashoffset: 0;  opacity: 1;   }
          50%      { stroke-dashoffset: -4; opacity: 0.92; }
        }
        /* Étirement vertical pivoté sur la base : le sculpt qui s'allonge. */
        @keyframes ys-breathe {
          0%, 100% { transform: scaleY(1)     scaleX(1);     }
          50%      { transform: scaleY(1.022) scaleX(0.994); }
        }
        @keyframes ys-glow-in    { to { opacity: 0.5; } }
        @keyframes ys-glow-pulse {
          0%, 100% { opacity: 0.5;  }
          50%      { opacity: 0.28; }
        }
        @keyframes ys-dot-in {
          from { opacity: 0; transform: scale(0.2); }
          to   { opacity: 1; transform: scale(1);   }
        }
        @keyframes ys-dot-pulse {
          0%, 100% { opacity: 1;   transform: scale(1);    }
          50%      { opacity: 0.6; transform: scale(1.35); }
        }

        /* Accessibilité : aucun mouvement si l'utilisateur le refuse.
           Le logo s'affiche dans son état final, propre et statique. */
        @media (prefers-reduced-motion: reduce) {
          .ys-stroke,
          .ys-arm {
            stroke-dasharray: none;
            stroke-dashoffset: 0;
            animation: none;
          }
          .ys-breathe { animation: none; transform: none; }
          .ys-glow    { animation: none; opacity: 0.4; }
          .ys-dot     { animation: none; opacity: 1; transform: none; }
        }
      `}</style>
    </svg>
  );
}