/**
 * Veridian Analytics Engine — tracking propriétaire (first-party) de l'ESPACE CLIENT.
 *
 * Pendant app du module du même nom côté vitrine. Même workspace `yoga_sculpt` :
 * c'est ce qui permet de RECOLLER le parcours d'un même visiteur de yoga-sculpt.fr
 * jusqu'à app.yoga-sculpt.fr en UNE session (cross-domain), puis de l'identifier par
 * son user Supabase une fois loggé (setUserId) — on voit alors tout le tunnel :
 *   provenance (UTM/referrer/gclid) → comportement vitrine → arrivée app → login →
 *   onboarding → checkout → ACHAT (valeur €) → réservation.
 *
 * CROSS-DOMAIN : on déclare `crossDomains: ['yoga-sculpt.fr']` (le sens inverse du
 * vitrine). Le SDK lit le param `_stm` déposé par le vitrine sur le lien sortant et
 * rattache la session → continuité du parcours.
 *
 * CONSENTEMENT : on lit le cookie `ys_consent` (posé par le vitrine en
 * `Domain=.yoga-sculpt.fr`, donc partagé avec ce sous-domaine). Si l'utilisateur a
 * accepté la mesure d'audience sur le vitrine → on track. S'il arrive DIRECTEMENT sur
 * l'app (pas de cookie) : l'espace est authentifié, privé, first-party, et le tracker
 * ne fait QUE de la mesure de service (aucune pub, aucun cookie tiers) → on active par
 * défaut au titre de la mesure nécessaire au fonctionnement du service. (Arbitrage RGPD
 * à confirmer par Robert ; bascule via VA_TRACK_WITHOUT_CONSENT_DEFAULT ci-dessous.)
 *
 * ⚠️ URL bundle = /sdk/v1/tracker.js (la racine /tracker.js renvoie le HTML SPA → cassé).
 */

export const VA_WORKSPACE_ID = "yoga_sculpt";
export const VA_ENDPOINT = "https://analytics-engine.app.veridian.site";
const VA_TRACKER_SRC = `${VA_ENDPOINT}/sdk/v1/tracker.js`;
const VA_CROSS_DOMAINS = ["yoga-sculpt.fr"];

/**
 * Faute de cookie de consentement (arrivée directe sur l'espace authentifié),
 * on track quand même : mesure de service first-party, sans pub. Passer à `false`
 * pour exiger un consentement explicite même dans l'espace privé.
 */
const VA_TRACK_WITHOUT_CONSENT_DEFAULT = true;
const CONSENT_COOKIE = "ys_consent";

type GoalData = {
  action: string;
  value?: number;
  currency?: string;
  properties?: Record<string, string>;
};
type StaminadsAPI = {
  init: (config: {
    workspace_id: string;
    endpoint: string;
    crossDomains?: string[];
    trackSPA?: boolean;
    trackScroll?: boolean;
    trackClicks?: boolean;
    adClickIds?: string[];
  }) => Promise<void>;
  trackGoal: (data: GoalData) => Promise<void>;
  setUserId: (id: string | null) => Promise<void>;
  setDimension: (index: number, value: string) => Promise<void>;
};

declare global {
  interface Window {
    Staminads?: StaminadsAPI;
    __vaLoaded?: boolean;
  }
}

/** True si la mesure d'audience est autorisée (cookie ys_consent partagé), ou défaut. */
function analyticsAllowed(): boolean {
  if (typeof document === "undefined") return false;
  const match = document.cookie
    .split("; ")
    .find((r) => r.startsWith(`${CONSENT_COOKIE}=`));
  if (!match) return VA_TRACK_WITHOUT_CONSENT_DEFAULT;
  try {
    const raw = decodeURIComponent(match.split("=").slice(1).join("="));
    return JSON.parse(raw)?.analytics === true;
  } catch {
    return VA_TRACK_WITHOUT_CONSENT_DEFAULT;
  }
}

function loadTrackerScript(): Promise<StaminadsAPI> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") return reject(new Error("no window"));
    if (window.Staminads) return resolve(window.Staminads);
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${VA_TRACKER_SRC}"]`,
    );
    const onReady = () =>
      window.Staminads
        ? resolve(window.Staminads)
        : reject(new Error("Staminads global manquant"));
    if (existing) {
      existing.addEventListener("load", onReady, { once: true });
      existing.addEventListener("error", () => reject(new Error("load error")), {
        once: true,
      });
      return;
    }
    const s = document.createElement("script");
    s.src = VA_TRACKER_SRC;
    s.async = true;
    s.addEventListener("load", onReady, { once: true });
    s.addEventListener("error", () => reject(new Error("load error")), {
      once: true,
    });
    document.head.appendChild(s);
  });
}

/** Init idempotente du tracker (no-op si consentement refusé). */
export async function initVeridianAnalytics(): Promise<void> {
  if (typeof window === "undefined" || window.__vaLoaded) return;
  if (!analyticsAllowed()) return;
  window.__vaLoaded = true;
  try {
    const sdk = await loadTrackerScript();
    await sdk.init({
      workspace_id: VA_WORKSPACE_ID,
      endpoint: VA_ENDPOINT,
      crossDomains: VA_CROSS_DOMAINS,
      trackSPA: true,
      trackScroll: true,
      trackClicks: true,
      adClickIds: ["gclid", "gbraid", "wbraid"],
    });
  } catch {
    window.__vaLoaded = false;
  }
}

/** Identifie le visiteur courant par son user Supabase (jointure anonyme → connu). */
export async function identify(userId: string): Promise<void> {
  if (typeof window === "undefined" || !window.Staminads || !userId) return;
  try {
    await window.Staminads.setUserId(userId);
  } catch {
    /* noop */
  }
}

/** Track une étape du tunnel. Best-effort, ne lève jamais. */
export async function trackFunnel(
  action: string,
  opts?: { value?: number; currency?: string; properties?: Record<string, string> },
): Promise<void> {
  if (typeof window === "undefined" || !window.Staminads) return;
  try {
    await window.Staminads.trackGoal({
      action,
      value: opts?.value,
      currency: opts?.currency,
      properties: opts?.properties,
    });
  } catch {
    /* noop */
  }
}

/** Étapes canoniques du tunnel côté espace client (noms stables = clés d'analyse). */
export const FUNNEL = {
  /** Login / inscription réussi (arrivée dans l'espace authentifié). */
  LOGIN_SUCCESS: "login_success",
  /** Onboarding terminé (4 étapes). */
  ONBOARDING_COMPLETE: "onboarding_complete",
  /** Checkout lancé (redirection vers Stripe). */
  CHECKOUT_START: "checkout_start",
  /** Paiement confirmé (retour success). value = montant en €. */
  PURCHASE: "purchase",
  /** Réservation d'un créneau confirmée. */
  RESERVATION_CONFIRMED: "reservation_confirmed",
} as const;
