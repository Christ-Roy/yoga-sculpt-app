import type { BookingStatus } from "@/lib/db-types";

/**
 * Badge de statut d'une réservation. Confirmé = or, Annulé = gris atténué.
 * Le texte porte l'information (pas seulement la couleur) → accessible AA.
 */
export function StatusBadge({ status }: { status: BookingStatus }) {
  const confirmed = status === "confirmed";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[4px] border px-2 py-0.5 text-[11px] uppercase tracking-wide ${
        confirmed
          ? "border-accent/40 text-accent"
          : "border-border text-text-secondary"
      }`}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${
          confirmed ? "bg-accent" : "bg-text-secondary"
        }`}
      />
      {confirmed ? "Confirmé" : "Annulé"}
    </span>
  );
}
