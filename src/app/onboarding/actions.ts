"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { isAllowedOnboardingValue, sanitizeOnboardingDraft } from "@/lib/onboarding";
import { logEvent } from "@/lib/events";

const answersSchema = z.object({
  goal: z.string().min(1).max(64),
  level: z.string().min(1).max(64),
  availability: z.string().min(1).max(64),
  format: z.string().min(1).max(64),
});

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

  const { goal, level, availability, format } = parsed.data;

  // Validation stricte des valeurs contre la liste autorisée.
  if (
    !isAllowedOnboardingValue("goal", goal) ||
    !isAllowedOnboardingValue("level", level) ||
    !isAllowedOnboardingValue("availability", availability) ||
    !isAllowedOnboardingValue("format", format)
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
      availability,
      format,
    });

  if (insertError) {
    return { ok: false, error: "Enregistrement impossible. Réessayez." };
  }

  // Complétion : marque le profil + nettoie le brouillon de reprise (plus utile).
  const { error: updateError } = await supabase
    .from("profiles")
    .update({ onboarding_completed: true, onboarding_draft: null })
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
    { goal, level, availability, format },
    { source: "onboarding" },
  );

  // NB : AUCUN ticket offert par défaut à l'inscription/onboarding.
  // Les seuls tickets gratuits proviennent du PARRAINAGE (le parrain est crédité
  // 1 ticket par filleul, plafond 3). Décision Robert 2026-06-19.

  return { ok: true };
}

/**
 * Sauvegarde BEST-EFFORT du brouillon d'onboarding (reprise d'avancement).
 *
 * Appelée en fire-and-forget à chaque sélection / changement de phase côté
 * client. Ne bloque JAMAIS l'UX : on avale toute erreur (session expirée, write
 * RLS échoué, table indispo…) et on renvoie `{ ok: false }` sans throw.
 *
 * Le brouillon est nettoyé/validé contre le barème (`sanitizeOnboardingDraft`)
 * avant écriture : aucune valeur arbitraire ne finit en base. RLS garantit qu'on
 * n'écrit que pour soi (`profiles.id = auth.uid()`).
 */
export async function saveOnboardingProgress(
  partial: unknown,
): Promise<{ ok: boolean }> {
  try {
    const draft = sanitizeOnboardingDraft(partial);

    const supabase = await createClient();
    const user = await getCurrentUser(supabase);
    if (!user) return { ok: false };

    const { error } = await supabase
      .from("profiles")
      .update({ onboarding_draft: draft })
      .eq("id", user.id);

    return { ok: !error };
  } catch {
    // Best-effort : la reprise est un confort, jamais un bloquant.
    return { ok: false };
  }
}
