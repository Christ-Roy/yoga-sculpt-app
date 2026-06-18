import Link from "next/link";
import { CalendarPlus } from "lucide-react";

import { WidgetCard } from "@/components/espace/WidgetCard";

/**
 * Widget « Réserver » — accès rapide au calendrier de réservation maison.
 *
 * Composant statique (pas de `"use client"`) : un simple raccourci vers
 * `/espace/reserver`. Rappelle le contexte (cours en plein air au Parc de la
 * Tête d'Or, collectif le vendredi soir) pour donner envie.
 */
export function ReserverWidget() {
  return (
    <WidgetCard title="Réserver" titleId="widget-reserver-title" icon={CalendarPlus}>
      <p className="text-sm leading-relaxed text-text-secondary">
        Choisissez un créneau parmi les dates proposées par Alice. Cours en plein
        air au{" "}
        <span className="text-text">Parc de la Tête d&apos;Or</span> — collectif le
        vendredi soir.
      </p>
      <div className="mt-5">
        <Link
          href="/espace/reserver"
          className="inline-flex min-h-[44px] w-full items-center justify-center rounded-[4px] bg-accent px-5 py-2.5 text-sm font-medium text-[#0e0e0e] transition-colors hover:bg-accent-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:w-auto"
        >
          Voir les créneaux
        </Link>
      </div>
    </WidgetCard>
  );
}
