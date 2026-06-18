"use client";

import { useEffect, useState } from "react";
import Cal, { getCalApi } from "@calcom/embed-react";
import {
  CALCOM_LINK,
  calBookingUrlWithPrefill,
  calPrefillConfig,
  type BookingPrefill,
} from "@/lib/booking";

/**
 * Widget Cal.com embarqué INLINE, pré-rempli depuis le profil et forcé à la
 * charte noir & or de Yoga Sculpt.
 *
 * Pré-remplissage (mécanisme vérifié en réel, juin 2026) :
 *   - `name` / `email` passés dans `config` → renseignent "Nom complet" / "Email".
 *   - `attendeePhoneNumber` → slug standard Cal pour le téléphone. Il n'est rendu
 *     que si le champ téléphone est activé côté Cal sur l'event ; sinon Cal ignore
 *     la clé (inoffensive).
 *
 * Theming : `Cal("ui", …)` avec `theme: "dark"` + `cssVarsPerTheme.dark` où
 * `cal-brand = #d4ad6a` (l'or). Un namespace unique par lien évite les collisions
 * si plusieurs embeds cohabitent.
 *
 * Robustesse : sous le widget, on garde toujours un lien "Ouvrir dans un nouvel
 * onglet" pré-rempli, au cas où l'iframe ne charge pas.
 */

const NAMESPACE = "yoga-sculpt";

export function CalEmbed({
  prefill,
  className = "",
}: {
  prefill: BookingPrefill;
  className?: string;
}) {
  const [ready, setReady] = useState(false);
  const config = calPrefillConfig(prefill);
  const fallbackUrl = calBookingUrlWithPrefill(prefill);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cal = await getCalApi({ namespace: NAMESPACE });
      if (cancelled) return;
      cal("ui", {
        theme: "dark",
        hideEventTypeDetails: false,
        layout: "month_view",
        cssVarsPerTheme: {
          dark: {
            "cal-brand": "#d4ad6a",
            "cal-bg": "#0e0e0e",
            "cal-bg-emphasis": "#1a1a1a",
            "cal-bg-muted": "#141414",
            "cal-border": "#2a2a2a",
            "cal-border-emphasis": "#3a3a3a",
            "cal-text": "#f2f0ec",
            "cal-text-emphasis": "#ffffff",
            "cal-text-muted": "#b8b4ad",
          },
          // Cal exige les deux thèmes dans le type ; on garde un light cohérent.
          light: {
            "cal-brand": "#b08f54",
          },
        },
      });
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className={className}>
      <div className="overflow-hidden rounded-[4px] border border-border bg-bg">
        {!ready && (
          <div className="flex h-[60vh] min-h-[520px] items-center justify-center">
            <span className="text-sm text-text-secondary">
              Chargement du calendrier…
            </span>
          </div>
        )}
        <div className={ready ? "block" : "hidden"}>
          <Cal
            namespace={NAMESPACE}
            calLink={CALCOM_LINK}
            config={config}
            style={{
              width: "100%",
              height: "100%",
              minHeight: "620px",
              overflow: "scroll",
            }}
          />
        </div>
      </div>

      <p className="mt-3 text-center text-xs text-text-secondary">
        Le calendrier ne s&apos;affiche pas ?{" "}
        <a
          href={fallbackUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline-offset-2 transition-colors hover:text-accent-dark hover:underline"
        >
          Ouvrir dans un nouvel onglet
        </a>
      </p>
    </div>
  );
}
