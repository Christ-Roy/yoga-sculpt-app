"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { ONBOARDING_STEPS } from "@/lib/onboarding";
import { logEvent } from "@/lib/events";
import { getClientIpFromHeaders } from "@/lib/anti-abuse";
import { grantWelcomeTicket } from "@/lib/welcome-ticket";

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
  const {
    data: { user },
  } = await supabase.auth.getUser();

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

  // ── Ticket de bienvenue (« 1ère séance offerte » — pivot Essai gratuit). ────
  // À la 1ère complétion d'onboarding, on crédite 1 ticket collectif offert.
  // Idempotent (flag profil + index unique DB), anti-abus (e-mail jetable /
  // IP / fingerprint partagés) et SILENCIEUX en cas de refus. BEST-EFFORT :
  // toute erreur est avalée — ne JAMAIS faire échouer l'onboarding pour ça
  // (le métier — réponses + onboarding_completed — est déjà persisté).
  try {
    const service = createServiceClient();
    const ip = getClientIpFromHeaders(await headers());
    await grantWelcomeTicket(service, {
      userId: user.id,
      email: user.email ?? "",
      ip,
      // Fingerprint indisponible dans une Server Action (collecté côté client,
      // poussé via /api/parrainage/completer au login). L'IP + l'e-mail jetable
      // restent les signaux portants ici.
      fingerprint: null,
    });
  } catch (welcomeErr) {
    console.error("[onboarding] Ticket de bienvenue best-effort échoué :", welcomeErr);
  }

  return { ok: true };
}
