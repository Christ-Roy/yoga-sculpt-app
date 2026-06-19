"use client";

import { useState, useTransition } from "react";
import type { TicketType } from "@/lib/db-types";
import { Spinner } from "@/components/ui/spinner";

/**
 * Achat de tickets — 3 formules (remplace/complète `BuyTicketButton.tsx`).
 *
 * Chaque formule POST `/api/checkout` avec `{ formule }` puis redirige vers
 * l'URL Stripe (`session.url`). Si Stripe n'est pas branché, l'API renvoie
 * `{ ready: false }` → message « Paiement bientôt disponible ».
 *
 * Les montants affichés sont INDICATIFS (le vrai prix vient de Stripe). On peut
 * pré-sélectionner et mettre en avant une formule via `highlight` (ex. ouvrir le
 * bloc sur la formule du créneau qui a renvoyé 402).
 *
 * RESPONSIVE : cartes empilées sur mobile, grille 3 colonnes dès `sm`.
 */

type Formule = "collectif" | "particulier" | "carte10";

interface FormuleAffichage {
  formule: Formule;
  titre: string;
  prix: string;
  detail: string;
  type: TicketType;
}

const FORMULES: FormuleAffichage[] = [
  {
    formule: "collectif",
    titre: "Cours collectif",
    prix: "20 €",
    detail: "1 séance en groupe",
    type: "collectif",
  },
  {
    formule: "particulier",
    titre: "Cours particulier",
    prix: "60 €",
    detail: "1 séance individuelle",
    type: "particulier",
  },
  {
    formule: "carte10",
    titre: "Carte 10 séances",
    prix: "180 €",
    detail: "Cours collectifs · tarif dégressif",
    type: "collectif",
  },
];

export function BuyTickets({
  highlightType = null,
  title = "Prendre des tickets",
}: {
  /** Met en avant les formules de ce type (ex. après un 402). */
  highlightType?: TicketType | null;
  title?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [enCours, setEnCours] = useState<Formule | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function acheter(formule: Formule) {
    setMessage(null);
    setEnCours(formule);
    startTransition(async () => {
      try {
        const res = await fetch("/api/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ formule }),
        });
        const data = (await res.json()) as { ready?: boolean; url?: string };

        if (data.url) {
          window.location.href = data.url;
          return; // redirection en cours
        }
        // ready:false → paiement pas encore branché.
        setMessage("Le paiement en ligne sera bientôt disponible.");
      } catch {
        setMessage("Une erreur est survenue. Réessayez.");
      } finally {
        setEnCours(null);
      }
    });
  }

  return (
    <section
      className="rounded-[4px] border border-border bg-surface/60 p-6"
      aria-labelledby="buy-tickets-title"
    >
      <h2
        id="buy-tickets-title"
        className="font-display text-xl text-text"
      >
        {title}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-text-secondary">
        Achetez vos tickets pour réserver vos séances quand vous voulez. Montants
        indicatifs.
      </p>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {FORMULES.map((f) => {
          const enAvant = highlightType !== null && f.type === highlightType;
          const busy = pending && enCours === f.formule;
          return (
            <div
              key={f.formule}
              className={`flex flex-col rounded-[4px] border p-4 transition-colors ${
                enAvant
                  ? "border-accent/70 bg-accent/5"
                  : "border-border bg-surface"
              }`}
            >
              <p className="font-display text-base text-text">{f.titre}</p>
              <p className="mt-1 text-2xl font-semibold text-accent">{f.prix}</p>
              <p className="mt-1 flex-1 text-xs text-text-secondary">
                {f.detail}
              </p>
              <button
                type="button"
                onClick={() => acheter(f.formule)}
                disabled={pending}
                className="mt-4 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-[4px] bg-accent px-4 py-2.5 text-sm font-medium text-[#0e0e0e] transition-colors hover:bg-accent-dark disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                aria-label={`Acheter ${f.titre} (${f.prix})`}
              >
                {busy ? (
                  <>
                    <Spinner />
                    Un instant…
                  </>
                ) : (
                  "Acheter"
                )}
              </button>
            </div>
          );
        })}
      </div>

      {message && (
        <p className="mt-4 text-sm text-text-secondary" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
