import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/AppHeader";
import { BuyTicketButton } from "@/components/BuyTicketButton";
import { CalEmbed } from "@/components/CalEmbed";
import { ProfileCard } from "./ProfileCard";
import { onboardingLabel } from "@/lib/onboarding";

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
              Choisissez un créneau avec Alice ci-dessous — vos coordonnées sont
              déjà pré-remplies. Ou prenez un ticket pour pratiquer quand vous
              voulez.
            </p>

            {/* Widget Cal.com embarqué, pré-rempli depuis le profil. */}
            <div className="mt-5">
              <CalEmbed
                prefill={{
                  name: profile?.full_name ?? null,
                  email,
                  phone: profile?.phone ?? null,
                }}
              />
            </div>

            <div className="mt-5">
              <BuyTicketButton />
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
