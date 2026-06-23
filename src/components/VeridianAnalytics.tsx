"use client";

import { useEffect } from "react";
import {
  initVeridianAnalytics,
  identify,
  trackFunnel,
  FUNNEL,
} from "@/lib/veridian-analytics";

// Marque login_success UNE fois par session navigateur (sinon il partirait à
// chaque navigation dans l'espace, qui re-monte ce composant).
const LOGIN_GOAL_FLAG = "ys_va_login";

/**
 * Charge le tracker Veridian Analytics Engine sur l'espace client et, si un
 * `userId` est fourni (espace authentifié), identifie le visiteur.
 *
 * Monté DEUX fois sans risque (init idempotente) :
 *   - layout racine, sans userId → tracking partout (login, onboarding, checkout)
 *   - espace/layout, AVEC user.id → recolle le parcours anonyme au user Supabase
 *
 * Rend `null`. Best-effort : ne casse jamais le rendu.
 */
export default function VeridianAnalytics({ userId }: { userId?: string }) {
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await initVeridianAnalytics();
      if (cancelled || !userId) return;
      await identify(userId);
      // Étape de tunnel : entrée dans l'espace authentifié (1×/session).
      try {
        if (!sessionStorage.getItem(LOGIN_GOAL_FLAG)) {
          sessionStorage.setItem(LOGIN_GOAL_FLAG, "1");
          void trackFunnel(FUNNEL.LOGIN_SUCCESS);
        }
      } catch {
        /* sessionStorage indispo → on saute le goal, pas grave */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return null;
}
