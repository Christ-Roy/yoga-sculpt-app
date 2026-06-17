import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/AppHeader";
import { BuyTicketButton } from "@/components/BuyTicketButton";
import { ProfileCard } from "./ProfileCard";
import { onboardingLabel } from "@/lib/onboarding";
import { CALCOM_BOOKING_URL } from "@/lib/booking";

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
  const userLabel = profile?.full_name || email;

  return (
    <>
      <AppHeader userLabel={userLabel} />

      <main className="mx-auto max-w-3xl px-5 py-8 sm:py-10">
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

          {/* Réserver une séance */}
          <section className="rounded-[4px] border border-border bg-surface/60 p-6">
            <h2 className="font-display text-xl text-text">
              Réserver une séance
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-text-secondary">
              Choisissez un créneau avec Alice, ou prenez un ticket pour
              pratiquer quand vous voulez.
            </p>

            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <a
                href={CALCOM_BOOKING_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-[4px] border border-border bg-surface px-5 py-3 text-sm font-medium tracking-wide text-text transition-colors hover:border-accent/60 hover:bg-surface-2"
              >
                Voir les créneaux
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M7 17L17 7M17 7H8M17 7v9"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </a>
              <BuyTicketButton />
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
