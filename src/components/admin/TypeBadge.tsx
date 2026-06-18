import type { TicketType } from "@/lib/db-types";

/** Petit badge de type de cours (collectif / particulier), charte sobre. */
export function TypeBadge({ type }: { type: TicketType }) {
  const label = type === "particulier" ? "Particulier" : "Collectif";
  return (
    <span className="inline-flex items-center rounded-[4px] border border-border bg-surface-2 px-2 py-0.5 text-[11px] uppercase tracking-wide text-text-secondary">
      {label}
    </span>
  );
}
