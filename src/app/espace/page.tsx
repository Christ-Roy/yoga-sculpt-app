import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProfileCard } from "./ProfileCard";
import { onboardingLabel } from "@/lib/onboarding";
import type { Ticket, TicketType } from "@/lib/db-types";

export const metadata: Metadata = {
  title: "Mon espace — Yoga Sculpt",
};

export default async function EspacePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, phone, email, onboarding_completed")
    .eq("id", user.id)
    .maybeSingle();

  // Pas encore onboardé → on l'envoie sur l'onboarding.
  if (profile && !profile.onboarding_completed) {
    redirect("/onboarding");
  }

  // Dernières réponses d'onboarding (pour afficher objectif / niveau).
  const { data: onboarding } = await supabase
    .from("onboarding_responses")
    .select("goal, level")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const email = profile?.email ?? user.email ?? "";

  // Solde de tickets (RLS user-scopée) — affiché en aperçu sur l'espace.
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
  const totalTickets = solde.collectif + solde.particulier;

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:py-10">
        <div className="mb-8 animate-fade-in-up">
          <p className="text-sm text-text-secondary">Bienvenue</p>
          <h1 className="font-display text-3xl text-text">
            {profile?.full_name || "Votre espace"}
          </h1>
        </div>

        <div className="flex flex-col gap-6">
          <ProfileCard
            email={email}
            fullName={profile?.full_name ?? null}
            phone={profile?.phone ?? null}
            goal={onboardingLabel("goal", onboarding?.goal)}
            level={onboardingLabel("level", onboarding?.level)}
          />

          {/* Réserver une séance — renvoie vers le calendrier maison. */}
          <section className="rounded-[4px] border border-border bg-surface/60 p-6">
            <h2 className="font-display text-xl text-text">
              Réserver une séance
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-text-secondary">
              Choisissez un créneau parmi les dates proposées par Alice, et
              gérez vos réservations à venir.
            </p>

            <p className="mt-4 text-sm text-text">
              {totalTickets > 0 ? (
                <>
                  <span className="font-semibold text-accent">
                    {solde.collectif}
                  </span>{" "}
                  ticket{solde.collectif > 1 ? "s" : ""} collectif
                  <span className="mx-2 text-text-secondary">·</span>
                  <span className="font-semibold text-accent">
                    {solde.particulier}
                  </span>{" "}
                  particulier
                </>
              ) : (
                <span className="text-text-secondary">
                  Vous n&apos;avez pas encore de ticket.
                </span>
              )}
            </p>

            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/espace/reserver"
                className="inline-flex min-h-[44px] items-center justify-center rounded-[4px] bg-accent px-5 py-2.5 text-sm font-medium text-[#0e0e0e] transition-colors hover:bg-accent-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                Voir les créneaux
              </Link>
              <Link
                href="/espace/reservations"
                className="inline-flex min-h-[44px] items-center justify-center rounded-[4px] border border-border bg-surface px-5 py-2.5 text-sm font-medium text-text transition-colors hover:border-accent/60 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                Mes réservations
              </Link>
            </div>
          </section>
        </div>
    </div>
  );
}
