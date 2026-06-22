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
 * @deprecated NE PLUS UTILISER pour déclencher l'OAuth. Conservée pour référence.
 *
 * ⚠️ Cette server action + `redirect(data.url)` PERD le cookie PKCE `code_verifier`
 * sur Cloudflare Workers : `redirect()` jette NEXT_REDIRECT avant que le Set-Cookie
 * soit committé (cf supabase/ssr#55). Résultat : Supabase retombe en flux IMPLICIT,
 * renvoie les tokens dans le fragment `#access_token` sur le Site URL (/login), et
 * `/auth/callback` (qui attend `?code=`) échoue → login Google CASSÉ. Bug réglé le
 * 2026-06-22 en déclenchant l'OAuth CÔTÉ CLIENT (browser client) dans
 * `AuthMethods.tsx#handleOAuth` — le navigateur pose le cookie code_verifier de
 * façon fiable. Voir le skill `oauth`.
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
      // Explicit scopes per provider.
      // - Google: offline access + force consent to always get a refresh token.
      // - Azure/Microsoft: `email` is REQUIRED. Microsoft (esp. personal MSA
      //   accounts and the /common endpoint) does NOT return an `email` claim
      //   unless it is explicitly requested. Supabase rejects the callback with
      //   a generic `server_error` 500 when no email is present, which is the
      //   exact failure we saw at the end of the Microsoft sign-in flow. The
      //   `openid email profile` set guarantees Microsoft includes the email
      //   claim in the id_token whenever the account has one.
      ...(provider === "google"
        ? {
            scopes: "openid email profile",
            queryParams: { access_type: "offline", prompt: "consent" },
          }
        : { scopes: "openid email profile" }),
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
