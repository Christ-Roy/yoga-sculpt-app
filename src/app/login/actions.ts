"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type AuthState = {
  ok?: boolean;
  message?: string;
  error?: string;
};

const emailSchema = z.email({ error: "Adresse e-mail invalide." });

/** Resolve the public origin (works in dev and behind a proxy/CDN). */
async function getOrigin() {
  const h = await headers();
  const envUrl = process.env.NEXT_PUBLIC_APP_URL;
  // In production we trust the configured app URL; in dev fall back to host.
  if (process.env.NODE_ENV === "production" && envUrl) return envUrl;
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

/**
 * Magic-link sign-in. Works out of the box (no external OAuth provider needed)
 * so the whole flow is testable today. Creates the user on first use.
 */
export async function signInWithMagicLink(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const raw = String(formData.get("email") ?? "").trim();
  const parsed = emailSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "E-mail invalide." };
  }

  const origin = await getOrigin();
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: {
      emailRedirectTo: `${origin}/auth/callback`,
      shouldCreateUser: true,
    },
  });

  if (error) {
    return { error: "Envoi impossible pour le moment. Réessayez." };
  }

  return {
    ok: true,
    message:
      "Lien de connexion envoyé. Consultez votre boîte mail (pensez aux spams).",
  };
}

/**
 * OAuth sign-in (Google / Microsoft-azure). Returns a redirect to the
 * provider's consent screen. Requires the provider to be configured in the
 * Supabase dashboard (see SETUP.md) — until then it returns a friendly error.
 */
export async function signInWithOAuth(
  provider: "google" | "azure",
): Promise<AuthState> {
  const origin = await getOrigin();
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${origin}/auth/callback`,
      ...(provider === "google"
        ? { queryParams: { access_type: "offline", prompt: "consent" } }
        : {}),
    },
  });

  if (error || !data?.url) {
    return {
      error:
        "Cette méthode n'est pas encore activée. Utilisez l'e-mail pour l'instant.",
    };
  }

  redirect(data.url);
}

/** Sign out and return to /login. */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
