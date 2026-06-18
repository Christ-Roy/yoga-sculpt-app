"use client";

import { useEffect } from "react";

/**
 * Collecteur de fingerprint device — anti-abus du parrainage (silencieux).
 *
 * Au montage, collecte des composantes non-PII permettant d'estimer si deux
 * comptes proviennent du même appareil (un parrain qui s'auto-parraine via un
 * faux filleul). Aucune lib payante : code maison léger, best-effort, jamais
 * bloquant. Les composantes sont POSTées brutes à `POST /api/parrainage/fingerprint` ;
 * c'est le SERVEUR qui les hashe (l'agent parrainage stocke un hash stable, pas
 * les valeurs en clair).
 *
 * Hypothèse d'endpoint (cf. brief) : `POST /api/parrainage/fingerprint`
 *   body `{ components: FingerprintComponents }` → 200 (réponse ignorée).
 * Si l'endpoint réel diffère, seul l'URL ci-dessous est à ajuster.
 *
 * Transparence UX : montage discret, aucune sortie visible, échecs avalés
 * (un fingerprint manquant ne doit JAMAIS dégrader l'expérience client).
 */

/** Composantes collectées (toutes optionnelles : best-effort). */
interface FingerprintComponents {
  /** Hash numérique d'un rendu <canvas> (signature GPU/anti-aliasing). */
  canvas?: string;
  /** Renderer WebGL non masqué (carte graphique). */
  webglRenderer?: string;
  /** Vendor WebGL. */
  webglVendor?: string;
  /** Polices détectées parmi une liste de référence. */
  fonts?: string[];
  /** User-Agent. */
  userAgent?: string;
  /** Langue préférée + langues. */
  language?: string;
  languages?: readonly string[];
  /** Résolution + profondeur de couleur. */
  screen?: string;
  /** Densité de pixels. */
  pixelRatio?: number;
  /** Fuseau horaire IANA. */
  timezone?: string;
  /** Décalage UTC en minutes. */
  timezoneOffset?: number;
  /** Nombre de cœurs logiques. */
  hardwareConcurrency?: number;
  /** RAM approximative (Go, Chrome only). */
  deviceMemory?: number;
  /** Plateforme déclarée. */
  platform?: string;
  /** Support du tactile (nombre max de points). */
  touchPoints?: number;
}

/** Liste de polices testées (présence = empreinte du système). */
const POLICES_TEST = [
  "Arial",
  "Arial Black",
  "Calibri",
  "Cambria",
  "Comic Sans MS",
  "Consolas",
  "Courier New",
  "Georgia",
  "Helvetica",
  "Impact",
  "Tahoma",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
  "Segoe UI",
  "Roboto",
  "Ubuntu",
  "Cantarell",
  "DejaVu Sans",
  "Liberation Sans",
  "Menlo",
  "Monaco",
  "SF Pro Text",
] as const;

/** Hash 32 bits déterministe (FNV-1a) → chaîne hex. Pas de valeur de sécurité. */
function hash(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/** Signature de rendu canvas (best-effort). */
function fingerprintCanvas(): string | undefined {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 60;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    ctx.textBaseline = "top";
    ctx.font = "14px 'Arial'";
    ctx.fillStyle = "#f60";
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = "#069";
    ctx.fillText("Yoga Sculpt \u{1F9D8} 0123", 2, 15);
    ctx.fillStyle = "rgba(102, 204, 0, 0.7)";
    ctx.fillText("Yoga Sculpt \u{1F9D8} 0123", 4, 17);
    return hash(canvas.toDataURL());
  } catch {
    return undefined;
  }
}

/** Renderer/vendor WebGL non masqués (best-effort). */
function fingerprintWebgl(): { renderer?: string; vendor?: string } {
  try {
    const canvas = document.createElement("canvas");
    const gl =
      (canvas.getContext("webgl") as WebGLRenderingContext | null) ??
      (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);
    if (!gl) return {};
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    if (!ext) return {};
    return {
      renderer: String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? ""),
      vendor: String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) ?? ""),
    };
  } catch {
    return {};
  }
}

/**
 * Détection de polices par mesure de largeur de texte (comparaison à des
 * polices de repli connues). Best-effort, sans dépendance.
 */
function fingerprintFonts(): string[] | undefined {
  try {
    const repli = ["monospace", "sans-serif", "serif"];
    const texte = "mmmmmmmmmmlli";
    const taille = "72px";
    const span = document.createElement("span");
    span.style.position = "absolute";
    span.style.left = "-9999px";
    span.style.fontSize = taille;
    span.style.visibility = "hidden";
    span.textContent = texte;
    document.body.appendChild(span);

    // Mesures de référence (polices de repli seules).
    const base: Record<string, { w: number; h: number }> = {};
    for (const r of repli) {
      span.style.fontFamily = r;
      base[r] = { w: span.offsetWidth, h: span.offsetHeight };
    }

    const detectees: string[] = [];
    for (const police of POLICES_TEST) {
      let presente = false;
      for (const r of repli) {
        span.style.fontFamily = `'${police}', ${r}`;
        if (
          span.offsetWidth !== base[r].w ||
          span.offsetHeight !== base[r].h
        ) {
          presente = true;
          break;
        }
      }
      if (presente) detectees.push(police);
    }

    document.body.removeChild(span);
    return detectees;
  } catch {
    return undefined;
  }
}

/** Assemble toutes les composantes disponibles (best-effort, sans throw). */
function collecter(): FingerprintComponents {
  const nav = navigator;
  const webgl = fingerprintWebgl();

  // `deviceMemory` n'est pas standard partout : accès défensif.
  const deviceMemory = (
    nav as Navigator & { deviceMemory?: number }
  ).deviceMemory;

  return {
    canvas: fingerprintCanvas(),
    webglRenderer: webgl.renderer,
    webglVendor: webgl.vendor,
    fonts: fingerprintFonts(),
    userAgent: nav.userAgent,
    language: nav.language,
    languages: nav.languages,
    screen: `${screen.width}x${screen.height}x${screen.colorDepth}`,
    pixelRatio: window.devicePixelRatio,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timezoneOffset: new Date().getTimezoneOffset(),
    hardwareConcurrency: nav.hardwareConcurrency,
    deviceMemory,
    platform: nav.platform,
    touchPoints: nav.maxTouchPoints,
  };
}

export function FingerprintCollector() {
  useEffect(() => {
    // Garde anti-double-envoi (Strict Mode monte deux fois en dev) + on ne
    // ré-émet pas à chaque navigation interne dans la même session onglet.
    const CLE_SESSION = "ys_fp_sent";
    let annule = false;

    try {
      if (sessionStorage.getItem(CLE_SESSION) === "1") return;
    } catch {
      // sessionStorage indisponible (mode privé strict) → on tente quand même
      // l'envoi mais sans garde de session.
    }

    // Différé hors du chemin critique : on attend que le navigateur soit au
    // repos pour ne pas concurrencer le rendu/les fetchs métier.
    const lancer = () => {
      if (annule) return;
      try {
        sessionStorage.setItem(CLE_SESSION, "1");
      } catch {
        /* ignoré */
      }

      let components: FingerprintComponents;
      try {
        components = collecter();
      } catch {
        return; // collecte impossible → on abandonne en silence
      }

      // keepalive : l'envoi survit à une navigation immédiate. Échec avalé.
      void fetch("/api/parrainage/fingerprint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ components }),
        keepalive: true,
        // Pas de credentials explicites : le cookie de session part par défaut
        // (same-origin), ce dont l'endpoint a besoin pour rattacher au user.
      }).catch(() => {
        /* anti-abus best-effort : un échec réseau ne doit rien casser */
      });
    };

    const ric = (
      window as Window & {
        requestIdleCallback?: (cb: () => void) => number;
      }
    ).requestIdleCallback;
    const id = ric ? ric(lancer) : window.setTimeout(lancer, 1200);

    return () => {
      annule = true;
      if (!ric) window.clearTimeout(id as number);
    };
  }, []);

  // Composant purement technique : aucun rendu visible.
  return null;
}
