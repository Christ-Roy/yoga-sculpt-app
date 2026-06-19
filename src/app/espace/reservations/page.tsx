import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import {
  MesReservations,
  type BookingAffichage,
} from "@/components/MesReservations";
import type { Booking } from "@/lib/db-types";
import { resoudreLieuxParEvent } from "@/lib/booking-lieu";

export const metadata: Metadata = {
  title: "Mes réservations — Yoga Sculpt",
};

/**
 * « Mes réservations » — séances confirmées À VENIR du user.
 *
 * Server Component : auth + lecture RLS-scopée des bookings `confirmed` dont
 * `starts_at >= now`, triés par date. L'interactivité (annuler, ajout agenda)
 * est dans `MesReservations`.
 */
export default async function ReservationsPage() {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);

  if (!user) {
    redirect("/login");
  }

  const nowIso = new Date().toISOString();
  const { data: rows } = await supabase
    .from("bookings")
    .select("id, type, starts_at, ends_at, google_event_id")
    .eq("status", "confirmed")
    .gte("starts_at", nowIso)
    .order("starts_at", { ascending: true });

  const rowsTyped = (rows ?? []) as Pick<
    Booking,
    "id" | "type" | "starts_at" | "ends_at" | "google_event_id"
  >[];

  // Lieu RÉEL relu depuis Google par `google_event_id` (UN seul listEvents) —
  // cohérent avec le dashboard. Lieu inconnu → on ne l'affiche pas (la pastille
  // « Lieu à confirmer » est réservée aux écrans qui chargent le lieu).
  const lieuxParEvent = await resoudreLieuxParEvent(rowsTyped);

  const bookings: BookingAffichage[] = rowsTyped.map((b) => ({
    id: b.id,
    type: b.type,
    starts_at: b.starts_at,
    ends_at: b.ends_at,
    titre: null, // le titre est dérivé du type côté UI / enrichi par /api/ics
    lieu: lieuxParEvent.get(b.google_event_id) ?? null,
  }));

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
              Mes réservations
            </h1>
          </div>
          <Link
            href="/espace/reserver"
            className="text-sm text-accent transition-colors hover:text-accent-dark"
          >
            Réserver une séance →
          </Link>
        </div>

      <MesReservations bookingsInitiaux={bookings} />
    </div>
  );
}
