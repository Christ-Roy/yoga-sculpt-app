import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ReserverClient } from "@/components/ReserverClient";
import type { Ticket, TicketType } from "@/lib/db-types";

export const metadata: Metadata = {
  title: "Réserver une séance — Yoga Sculpt",
};

/**
 * Page de réservation — calendrier MAISON (remplace l'embed Cal.com).
 *
 * Server Component : auth + lecture du solde de tickets (RLS user-scopée) ;
 * délègue toute l'interactivité (liste des créneaux, réserver, achat) à
 * `ReserverClient`. Les créneaux eux-mêmes sont chargés côté client depuis
 * `GET /api/creneaux` (données temps réel du Google Agenda d'Alice).
 */
export default async function ReserverPage({
  searchParams,
}: {
  // Next 16 : searchParams est une Promise.
  searchParams: Promise<{ status?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Solde de tickets (RLS : le user ne voit que les siens). On agrège les
  // quantités restantes valides par type.
  const nowIso = new Date().toISOString();
  const { data: tickets } = await supabase
    .from("tickets")
    .select("type, quantite_restante, expires_at")
    .gt("quantite_restante", 0)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`);

  const solde = { collectif: 0, particulier: 0 };
  for (const t of (tickets ?? []) as Pick<
    Ticket,
    "type" | "quantite_restante"
  >[]) {
    const type = t.type as TicketType;
    if (type === "collectif" || type === "particulier") {
      solde[type] += t.quantite_restante;
    }
  }

  const { status } = await searchParams;
  const statusParam =
    status === "success" || status === "cancel" ? status : null;

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 animate-fade-in-up">
          <div>
            <Link
              href="/espace"
              className="text-sm text-text-secondary transition-colors hover:text-text"
            >
              ← Mon espace
            </Link>
            <h1 className="mt-2 font-display text-3xl text-text">
              Réserver une séance
            </h1>
          </div>
          <Link
            href="/espace/reservations"
            className="text-sm text-accent transition-colors hover:text-accent-dark"
          >
            Mes réservations →
          </Link>
        </div>

      <ReserverClient soldeInitial={solde} statusParam={statusParam} />
    </div>
  );
}
