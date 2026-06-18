import { KpiCard } from "@/components/admin/KpiCard";
import { formatEuro } from "@/lib/admin-format";
import type { AdminKpis } from "@/lib/admin-data";

/**
 * Grille des indicateurs clés de la vue d'ensemble.
 * Responsive : 1 colonne mobile → 2 (sm) → 4 (lg).
 */
export function KpiGrid({ kpis }: { kpis: AdminKpis }) {
  return (
    <section aria-label="Indicateurs clés">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Réservations à venir"
          value={kpis.resaAVenir}
          hint="cours confirmés à partir d'aujourd'hui"
        />
        <KpiCard
          label="Cette semaine"
          value={kpis.resaCetteSemaine}
          hint="dans les 7 prochains jours"
        />
        <KpiCard
          label="Ce mois-ci"
          value={kpis.resaCeMois}
          hint="d'ici la fin du mois"
        />
        <KpiCard
          label="CA indicatif"
          value={formatEuro(kpis.caIndicatifEur)}
          hint="estimé (tarifs de référence, hors Stripe réel)"
          accent
        />
        <KpiCard
          label="Clients"
          value={kpis.clientsTotal}
          hint={`+${kpis.clientsNouveauxCeMois} ce mois-ci`}
        />
        <KpiCard
          label="Séances vendues"
          value={kpis.ticketsVendus}
          hint={`${kpis.ticketsParType.collectif} collectif · ${kpis.ticketsParType.particulier} particulier`}
        />
      </div>
    </section>
  );
}
