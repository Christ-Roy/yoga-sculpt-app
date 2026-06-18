import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin";
import { chargerDashboard } from "@/lib/admin-data";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { KpiGrid } from "@/components/admin/KpiGrid";
import { CreneauxList } from "@/components/admin/CreneauxList";
import { ReservationsRecentes } from "@/components/admin/ReservationsRecentes";

export const metadata: Metadata = {
  title: "Dashboard — Yoga Sculpt",
};

// Page dynamique : données live (réservations / créneaux), jamais mises en cache
// statiquement. Évite aussi qu'un build prérende une page admin sans session.
export const dynamic = "force-dynamic";

/**
 * Dashboard d'Alice (la prof) — vue d'admin sur ses cours et réservations.
 *
 * Server Component. La PREMIÈRE chose faite est `requireAdmin()` : garde serveur
 * (défense en profondeur, indépendante du middleware) qui redirige tout non-admin
 * AVANT toute lecture de données via `service_role`. Aucune donnée n'est chargée
 * tant que l'accès n'est pas confirmé.
 */
export default async function AdminDashboardPage() {
  const admin = await requireAdmin();

  const { kpis, creneaux, reservationsRecentes } = await chargerDashboard();

  return (
    <>
      <AdminHeader userLabel={admin.email} />

      <main className="mx-auto max-w-6xl px-5 py-8 sm:py-10">
        <div className="mb-8 animate-fade-in-up">
          <p className="text-sm text-text-secondary">Tableau de bord</p>
          <h1 className="font-display text-3xl text-text">
            Vue d&apos;ensemble
          </h1>
        </div>

        <div className="flex flex-col gap-10">
          <KpiGrid kpis={kpis} />
          <CreneauxList creneaux={creneaux} />
          <ReservationsRecentes reservations={reservationsRecentes} />
        </div>
      </main>
    </>
  );
}
