"use client";

import { useEffect } from "react";
import { trackFunnel } from "@/lib/veridian-analytics";

/**
 * Marque une étape de tunnel au montage d'une page (1×/montage). Sert à instrumenter
 * une page rendue côté serveur (où on ne peut pas appeler trackFunnel directement)
 * en y déposant ce petit composant client. Rend `null`.
 *
 * Ex. sur la landing d'invitation : <FunnelGoal action="referral_landing" /> →
 * compte l'arrivée d'un filleul comme porte d'entrée du tunnel (branche parrainage).
 */
export default function FunnelGoal({
  action,
  properties,
}: {
  action: string;
  properties?: Record<string, string>;
}) {
  useEffect(() => {
    void trackFunnel(action, { properties });
    // au montage uniquement
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
