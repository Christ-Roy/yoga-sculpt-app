import type { TicketSource } from "@/lib/db-types";
import {
  categoriserSourceTicket,
  detailSourceTicket,
} from "@/lib/reservation";

/**
 * Badge d'origine du ticket consommé par une réservation, pour le back-office.
 *
 *   - « Payé »   (OR plein)  → place achetée via Stripe (`source = 'paid'`).
 *   - « Offert » (variante)  → place gratuite : séance d'essai / parrainage /
 *                              geste commercial (`welcome` | `referral` | `admin`).
 *   - « Ticket inconnu »     → booking sans ticket rattaché ou carnet historique.
 *
 * Le texte porte l'info (pas seulement la couleur) → lisible en AA. Un sous-
 * libellé fin (« Parrainage », « Séance d'essai »…) est ajouté en `title` pour
 * Alice qui veut le détail au survol.
 */
export function SourceBadge({ source }: { source: TicketSource | null }) {
  const categorie = categoriserSourceTicket(source);
  const detail = detailSourceTicket(source);

  if (categorie === "paye") {
    return (
      <span
        title={detail ?? undefined}
        className="inline-flex items-center gap-1.5 rounded-[4px] border border-accent/50 bg-accent/10 px-2 py-0.5 text-[11px] uppercase tracking-wide text-accent"
      >
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent" />
        Payé
      </span>
    );
  }

  if (categorie === "offert") {
    return (
      <span
        title={detail ?? undefined}
        className="inline-flex items-center gap-1.5 rounded-[4px] border border-border bg-surface-2 px-2 py-0.5 text-[11px] uppercase tracking-wide text-text-secondary"
      >
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 rounded-full bg-text-secondary"
        />
        Offert{detail ? ` · ${detail}` : ""}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center rounded-[4px] border border-dashed border-border px-2 py-0.5 text-[11px] uppercase tracking-wide text-text-secondary">
      Ticket inconnu
    </span>
  );
}
