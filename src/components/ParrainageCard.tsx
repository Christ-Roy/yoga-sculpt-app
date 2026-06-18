"use client";

import { useState } from "react";
import { Gift } from "lucide-react";

/**
 * Carte de présentation du parrainage + lien personnel copiable.
 *
 * - Explication : parrainez un ami → il s'inscrit → vous gagnez un ticket.
 * - Lien de parrainage en lecture seule + bouton « Copier » (Clipboard API,
 *   fallback `execCommand` pour les contextes sans `navigator.clipboard`).
 *
 * Charte NOIR & OR. Bouton copier ≥44px, état « Copié ✓ » éphémère, a11y soignée
 * (aria-live sur la confirmation, `readOnly` sur le champ lien).
 */
export function ParrainageCard({
  lienParrainage,
  code,
}: {
  lienParrainage: string;
  /** Code de parrainage brut (affiché en discret sous le lien). */
  code: string;
}) {
  const [copie, setCopie] = useState(false);

  async function copier() {
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(lienParrainage);
        ok = true;
      }
    } catch {
      ok = false;
    }

    // Fallback navigateurs/contextes sans Clipboard API (ex. http en dev).
    if (!ok) {
      try {
        const ta = document.createElement("textarea");
        ta.value = lienParrainage;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }

    if (ok) {
      setCopie(true);
      window.setTimeout(() => setCopie(false), 2500);
    }
  }

  return (
    <section
      className="rounded-[4px] border border-border bg-surface/60 p-6"
      aria-labelledby="parrainage-card-title"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-[4px] border border-accent/40 bg-accent/10 text-accent"
        >
          <Gift className="size-4" />
        </span>
        <div>
          <h2
            id="parrainage-card-title"
            className="font-display text-xl text-text"
          >
            Offrez une séance à un ami
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-text-secondary">
            Partagez votre lien personnel. Dès qu&apos;un ami crée son compte
            Yoga Sculpt grâce à vous, <span className="text-text">un ticket
            vous est offert</span> — de quoi vous retrouver sur le tapis.
          </p>
        </div>
      </div>

      <div className="mt-5">
        <p className="text-xs uppercase tracking-widest text-text-secondary">
          Votre lien de parrainage
        </p>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row">
          <input
            type="text"
            readOnly
            value={lienParrainage}
            aria-label="Votre lien de parrainage"
            onFocus={(e) => e.currentTarget.select()}
            className="min-h-[44px] flex-1 select-all rounded-[4px] border border-border bg-surface px-3 py-2.5 text-sm text-text focus:border-accent focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void copier()}
            className="inline-flex min-h-[44px] items-center justify-center rounded-[4px] border border-border bg-surface px-5 py-2.5 text-sm font-medium text-text transition-colors hover:border-accent/60 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            aria-label="Copier le lien de parrainage"
          >
            {copie ? "Copié ✓" : "Copier"}
          </button>
        </div>
        {code && (
          <p className="mt-2 text-xs text-text-secondary">
            Code : <span className="font-medium text-text">{code}</span>
          </p>
        )}
        {/* Confirmation annoncée aux lecteurs d'écran. */}
        <span className="sr-only" role="status" aria-live="polite">
          {copie ? "Lien copié dans le presse-papiers." : ""}
        </span>
      </div>
    </section>
  );
}
