import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OnboardingFlow } from "./OnboardingFlow";

export const metadata: Metadata = {
  title: "Bienvenue — Yoga Sculpt",
};

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Défense en profondeur (le proxy protège déjà la route).
  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarding_completed, full_name")
    .eq("id", user.id)
    .maybeSingle();

  // Déjà fait → on n'impose pas de refaire l'onboarding.
  if (profile?.onboarding_completed) {
    redirect("/espace");
  }

  const firstName =
    profile?.full_name?.trim().split(/\s+/)[0] ??
    user.user_metadata?.full_name?.trim().split(/\s+/)[0] ??
    null;

  return (
    <main className="flex min-h-dvh items-center justify-center px-5 py-12">
      <OnboardingFlow firstName={firstName} />
    </main>
  );
}
