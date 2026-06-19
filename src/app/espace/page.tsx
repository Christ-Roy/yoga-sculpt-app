import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
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
import { resoudreLieuxParEvent } from "@/lib/booking-lieu";
import { maxParrainagesCredites } from "@/lib/referral";

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
 * Lieu des cours = LE VRAI lieu de l'event Google (champ « Lieu » saisi par
 * Alice, qui peut varier été/hiver). On le RELIT depuis Google par
 * `google_event_id` (cf. `resoudreLieuxParEvent`) — plus de constante en dur. Si
 * Google est indisponible ou le lieu non saisi, l'UI affiche « Lieu à confirmer ».
 */

export default async function EspacePage() {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);

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

  // Bannière parrainage : affichée tant qu'il reste des séances offertes à
  // gagner (le parrain est crédité 1 ticket/filleul, plafond = celui appliqué au
  // serveur via maxParrainagesCredites — plus de magie « 3 » dupliquée ici).
  const { count: filleulsCredites } = await supabase
    .from("referrals")
    .select("id", { count: "exact", head: true })
    .eq("parrain_user_id", user.id)
    .eq("ticket_credite", true);
  const resteSeancesAGagner =
    (filleulsCredites ?? 0) < maxParrainagesCredites();

  // ── Séances confirmées à venir (RLS user-scopée). ──────────────────────────
  const { data: bookingRows } = await supabase
    .from("bookings")
    .select("id, type, starts_at, ends_at, google_event_id")
    .eq("status", "confirmed")
    .gte("starts_at", nowIso)
    .order("starts_at", { ascending: true });

  const bookings = (bookingRows ?? []) as Pick<
    Booking,
    "id" | "type" | "starts_at" | "ends_at" | "google_event_id"
  >[];

  // Lieu RÉEL des séances : relu depuis Google par `google_event_id` (UN seul
  // listEvents). Google KO / lieu non saisi → `undefined` → « Lieu à confirmer ».
  const lieuxParEvent = await resoudreLieuxParEvent(bookings);

  const seances: SeanceWidget[] = bookings.map((b) => ({
    id: b.id,
    type: b.type,
    starts_at: b.starts_at,
    ends_at: b.ends_at,
    lieu: lieuxParEvent.get(b.google_event_id),
  }));

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:py-10">
      <div className="mb-8 animate-fade-in-up">
        <p className="text-sm text-text-secondary">Bienvenue</p>
        <h1 className="font-display text-3xl text-text">
          {profile?.full_name || "Votre espace"}
        </h1>
      </div>

      {resteSeancesAGagner && <WelcomeTicketBanner />}

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
