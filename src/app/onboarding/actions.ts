"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { ONBOARDING_STEPS } from "@/lib/onboarding";
import { logEvent } from "@/lib/events";

const answersSchema = z.object({
  goal: z.string().min(1).max(64),
  level: z.string().min(1).max(64),
  frequency: z.string().min(1).max(64),
  availability: z.string().min(1).max(64),
});

/** Valeurs autorisées par question (anti-injection : on n'accepte que la liste connue). */
function isAllowed(key: string, value: string) {
  const step = ONBOARDING_STEPS.find((s) => s.key === key);
  return Boolean(step?.options.some((o) => o.value === value));
}

export type SaveOnboardingResult = { ok: boolean; error?: string };

/**
 * Enregistre les réponses d'onboarding puis marque le profil comme complété.
 * Server Action : s'exécute côté serveur, RLS garantit qu'on n'écrit que pour soi.
 */
export async function saveOnboarding(
  answers: unknown,
): Promise<SaveOnboardingResult> {
  const parsed = answersSchema.safeParse(answers);
  if (!parsed.success) {
    return { ok: false, error: "Réponses incomplètes." };
  }

  const { goal, level, frequency, availability } = parsed.data;

  // Validation stricte des valeurs contre la liste autorisée.
  if (
    !isAllowed("goal", goal) ||
    !isAllowed("level", level) ||
    !isAllowed("frequency", frequency) ||
    !isAllowed("availability", availability)
  ) {
    return { ok: false, error: "Réponse invalide." };
  }

  const supabase = await createClient();
  const user = await getCurrentUser(supabase);

  if (!user) {
    return { ok: false, error: "Session expirée. Reconnectez-vous." };
  }

  const { error: insertError } = await supabase
    .from("onboarding_responses")
    .insert({
      user_id: user.id,
      goal,
      level,
      frequency,
      availability,
    });

  if (insertError) {
    return { ok: false, error: "Enregistrement impossible. Réessayez." };
  }

  const { error: updateError } = await supabase
    .from("profiles")
    .update({ onboarding_completed: true })
    .eq("id", user.id);

  if (updateError) {
    return { ok: false, error: "Enregistrement impossible. Réessayez." };
  }

  // ── Tracking : onboarding_completed. ────────────────────────────────────────
  // best-effort (l'onboarding — métier — est déjà enregistré en base). Écriture
  // via service_role (logEvent), indépendante de la session user de cette action.
  await logEvent(
    user.id,
    "onboarding_completed",
    { goal, level, frequency, availability },
    { source: "onboarding" },
  );

  return { ok: true };
}
