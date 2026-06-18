import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/AppHeader";
import {
  MesReservations,
  type BookingAffichage,
} from "@/components/MesReservations";
import type { Booking } from "@/lib/db-types";

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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", user.id)
    .maybeSingle();

  const userLabel = profile?.full_name || profile?.email || user.email || "";

  const nowIso = new Date().toISOString();
  const { data: rows } = await supabase
    .from("bookings")
    .select("id, type, starts_at, ends_at")
    .eq("status", "confirmed")
    .gte("starts_at", nowIso)
    .order("starts_at", { ascending: true });

  const bookings: BookingAffichage[] = (
    (rows ?? []) as Pick<Booking, "id" | "type" | "starts_at" | "ends_at">[]
  ).map((b) => ({
    id: b.id,
    type: b.type,
    starts_at: b.starts_at,
    ends_at: b.ends_at,
    titre: null, // le titre est dérivé du type côté UI / enrichi par /api/ics
  }));

  return (
    <>
      <AppHeader userLabel={userLabel} />

      <main className="mx-auto max-w-3xl px-5 py-8 sm:py-10">
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
      </main>
    </>
  );
}
