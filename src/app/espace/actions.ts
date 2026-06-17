"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const profileSchema = z.object({
  full_name: z
    .string()
    .trim()
    .max(120, { error: "Nom trop long." })
    .optional()
    .or(z.literal("")),
  phone: z
    .string()
    .trim()
    .max(30, { error: "Téléphone trop long." })
    .regex(/^[0-9 +().-]*$/, { error: "Téléphone invalide." })
    .optional()
    .or(z.literal("")),
});

export type ProfileState = { ok?: boolean; error?: string };

/** Met à jour le profil de l'utilisateur courant (nom, téléphone). */
export async function updateProfile(
  _prev: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  const parsed = profileSchema.safeParse({
    full_name: formData.get("full_name") ?? "",
    phone: formData.get("phone") ?? "",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Données invalides." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Session expirée. Reconnectez-vous." };
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: parsed.data.full_name || null,
      phone: parsed.data.phone || null,
    })
    .eq("id", user.id);

  if (error) {
    return { error: "Mise à jour impossible. Réessayez." };
  }

  revalidatePath("/espace");
  return { ok: true };
}
