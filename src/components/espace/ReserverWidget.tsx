import Link from "next/link";
import { CalendarPlus } from "lucide-react";

import { WidgetCard } from "@/components/espace/WidgetCard";

/**
 * Widget « Réserver » — accès rapide au calendrier de réservation maison.
 *
 * Composant statique (pas de `"use client"`) : un simple raccourci vers
 * `/espace/reserver`. Accroche VOLONTAIREMENT générique : le lieu précis d'une
 * séance n'est pas figé ici (il peut varier été/hiver) — il est affiché par
 * créneau depuis le vrai champ « Lieu » Google (cf. `LieuMaps`), pas en dur.
 */
export function ReserverWidget() {
  return (
    <WidgetCard title="Réserver" titleId="widget-reserver-title" icon={CalendarPlus}>
      <p className="text-sm leading-relaxed text-text-secondary">
        Choisissez un créneau parmi les dates proposées par Alice. Le lieu exact
        est précisé sur chaque séance.
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
