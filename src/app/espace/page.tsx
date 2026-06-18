import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProfileCard } from "./ProfileCard";
import { onboardingLabel } from "@/lib/onboarding";
import type { Booking } from "@/lib/db-types";
import { calculerSolde, type LigneSolde } from "@/components/espace/solde";
import { DashboardGrid } from "@/components/espace/DashboardGrid";
import {
  SeancesAVenirWidget,
  type SeanceWidget,
} from "@/components/espace/SeancesAVenirWidget";
import { TicketsWidget } from "@/components/espace/TicketsWidget";
import { ReserverWidget } from "@/components/espace/ReserverWidget";
import { ParrainageWidget } from "@/components/espace/ParrainageWidget";
import { WelcomeTicketBanner } from "@/components/espace/WelcomeTicketBanner";

export const metadata: Metadata = {
  title: "Mon espace — Yoga Sculpt",
};

/**
 * Tableau de bord de l'espace client — home à WIDGETS.
 *
 * Server Component : auth + redirections métier (onboarding), puis lecture
 * RLS-scopée des données affichées (profil, onboarding, solde de tickets, séances
 * confirmées à venir). Les widgets eux-mêmes vivent dans `src/components/espace/*`.
 *
 * Le parrainage est le SEUL widget qui charge sa donnée côté navigateur
 * (`/api/parrainage`) : le fetch SSR worker→worker est peu fiable sur l'edge
 * Cloudflare (cf. note `ParrainerPage`). Il dégrade proprement.
 *
 * Lieu des cours = « Parc de la Tête d'Or » (cours en plein air) : on l'applique
 * par défaut sur les séances, le booking ne stockant pas le lieu en base.
 */

const LIEU_COURS = "Parc de la Tête d'Or";

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
  const nowIso = new Date().toISOString();

  // ── Solde de tickets (RLS user-scopée). ────────────────────────────────────
  // On lit aussi `source` pour repérer le ticket de bienvenue encore disponible
  // (« 1ère séance offerte ») et afficher l'encart d'incitation à la 1re résa.
  const { data: tickets, error: ticketsErr } = await supabase
    .from("tickets")
    .select("type, quantite_restante, expires_at, source")
    .gt("quantite_restante", 0)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`);
  const solde = calculerSolde((tickets ?? []) as LigneSolde[]);

  // Ticket de bienvenue encore consommable → on pousse fortement la 1re résa
  // (moment d'activation clé). Vrai uniquement s'il reste une séance welcome.
  const aTicketBienvenue = (tickets ?? []).some(
    (t) => (t as { source?: string | null }).source === "welcome",
  );

  // ── Séances confirmées à venir (RLS user-scopée). ──────────────────────────
  const { data: bookingRows } = await supabase
    .from("bookings")
    .select("id, type, starts_at, ends_at")
    .eq("status", "confirmed")
    .gte("starts_at", nowIso)
    .order("starts_at", { ascending: true });

  const seances: SeanceWidget[] = (
    (bookingRows ?? []) as Pick<
      Booking,
      "id" | "type" | "starts_at" | "ends_at"
    >[]
  ).map((b) => ({
    id: b.id,
    type: b.type,
    starts_at: b.starts_at,
    ends_at: b.ends_at,
    lieu: LIEU_COURS,
  }));

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:py-10">
      <div className="mb-8 animate-fade-in-up">
        <p className="text-sm text-text-secondary">Bienvenue</p>
        <h1 className="font-display text-3xl text-text">
          {profile?.full_name || "Votre espace"}
        </h1>
      </div>

      {aTicketBienvenue && <WelcomeTicketBanner />}

      <DashboardGrid>
        {/* Séances à venir — widget « héros », plus large sur grand écran. */}
        <div className="md:col-span-2 xl:col-span-2">
          <SeancesAVenirWidget seancesInitiales={seances} />
        </div>

        <TicketsWidget solde={solde} error={Boolean(ticketsErr)} />

        <ReserverWidget />

        <ParrainageWidget />

        {/* Profil — la carte existante (édition inline), élargie sur 2 colonnes. */}
        <div className="md:col-span-2 xl:col-span-2">
          <ProfileCard
            email={email}
            fullName={profile?.full_name ?? null}
            phone={profile?.phone ?? null}
            goal={onboardingLabel("goal", onboarding?.goal)}
            level={onboardingLabel("level", onboarding?.level)}
          />
        </div>
      </DashboardGrid>
    </div>
  );
}
