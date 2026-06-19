import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { AuthBackground } from "@/components/AuthBackground";
import { sanitizeOnboardingDraft } from "@/lib/onboarding";
import { OnboardingFlow } from "./OnboardingFlow";

export const metadata: Metadata = {
  title: "Bienvenue — Yoga Sculpt",
};

export default async function OnboardingPage() {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);

  // Défense en profondeur (le proxy protège déjà la route).
  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarding_completed, full_name, email, phone, onboarding_draft")
    .eq("id", user.id)
    .maybeSingle();

  // Déjà fait → on n'impose pas de refaire l'onboarding.
  if (profile?.onboarding_completed) {
    redirect("/espace");
  }

  // Brouillon de reprise (re-sanitizé côté serveur : on ne fait pas confiance
  // au contenu brut de la colonne jsonb même s'il vient de chez nous).
  const initialDraft = sanitizeOnboardingDraft(profile?.onboarding_draft);

  const fullName =
    profile?.full_name?.trim() ||
    (typeof user.user_metadata?.full_name === "string"
      ? user.user_metadata.full_name.trim()
      : null) ||
    null;

  const firstName = fullName?.split(/\s+/)[0] ?? null;

  // Pré-remplissage de l'écran de fin d'onboarding (transmis à OnboardingFlow).
  const prefill = {
    name: fullName,
    email: profile?.email ?? user.email ?? null,
    phone: profile?.phone ?? null,
  };

  return (
    <main className="relative flex min-h-dvh items-center justify-center px-5 py-6 sm:py-12">
      <AuthBackground />
      <div className="relative z-10 w-full flex justify-center">
        <OnboardingFlow
          firstName={firstName}
          prefill={prefill}
          initialDraft={initialDraft}
        />
      </div>
    </main>
  );
}
