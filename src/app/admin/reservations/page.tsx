import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin";
import { chargerReservationsAdmin } from "./_data";
import { ReservationsManager } from "./ReservationsManager";

export const metadata: Metadata = {
  title: "Réservations — Yoga Sculpt",
};

// Page dynamique : données live (réservations / créneaux), jamais mises en cache
// statiquement. Évite aussi qu'un build prérende une page admin sans session.
export const dynamic = "force-dynamic";

/**
 * Back-office « Gestion des réservations » (Alice).
 *
 * Server Component. PREMIÈRE chose : `requireAdmin()` (garde serveur, défense en
 * profondeur indépendante du middleware) — aucune donnée chargée via
 * `service_role` tant que l'accès admin n'est pas confirmé.
 *
 * Charge TOUTES les réservations (à venir + passées) + les créneaux Google à
 * venir (cibles de déplacement), puis délègue l'affichage + les filtres + les
 * actions au composant client `ReservationsManager`. Les actions sensibles
 * (annuler / déplacer) passent par les routes `/api/admin/bookings/*` qui
 * re-vérifient `requireAdmin()` côté serveur.
 */
export default async function AdminReservationsPage() {
  await requireAdmin();

  const { reservations, creneauxCibles } = await chargerReservationsAdmin();

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:py-10">
      <div className="mb-8 animate-fade-in-up">
        <p className="text-sm text-text-secondary">Gestion</p>
        <h1 className="font-display text-3xl text-text">Réservations</h1>
        <p className="mt-2 max-w-2xl text-sm text-text-secondary">
          Toutes les réservations de vos clientes — à venir et passées. Filtrez,
          consultez les inscrits par créneau, annulez ou déplacez au nom d&apos;une
          cliente, et pointez la présence après chaque séance.
        </p>
      </div>

      <ReservationsManager
        reservations={reservations}
        creneauxCibles={creneauxCibles}
      />
    </div>
  );
}
