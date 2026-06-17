import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * OAuth / magic-link callback.
 *
 * - PKCE / OAuth flow → Supabase sends `?code=...`, we exchange it for a session.
 * - After exchange we route the user based on onboarding state.
 *
 * Runs on the default runtime (edge-compatible via OpenNext): only fetch-based
 * Supabase calls + cookie writes, no Node-only APIs.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");
  // Optional path the user was trying to reach before auth.
  const redirectTo = searchParams.get("redirectTo");

  if (error) {
    const url = new URL("/login", origin);
    url.searchParams.set("error", errorDescription || error);
    return NextResponse.redirect(url);
  }

  if (!code) {
    const url = new URL("/login", origin);
    url.searchParams.set("error", "Lien invalide ou expiré.");
    return NextResponse.redirect(url);
  }

  const supabase = await createClient();
  const { error: exchangeError } =
    await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    const url = new URL("/login", origin);
    url.searchParams.set("error", "Impossible de vous connecter. Réessayez.");
    return NextResponse.redirect(url);
  }

  // Decide destination: onboarding if not completed, else the espace.
  let destination = "/espace";
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("onboarding_completed")
      .eq("id", user.id)
      .maybeSingle();

    if (!profile?.onboarding_completed) {
      destination = "/onboarding";
    }
  }

  // A safe explicit redirectTo (relative path) takes precedence when present.
  if (redirectTo && redirectTo.startsWith("/")) {
    destination = redirectTo;
  }

  return NextResponse.redirect(new URL(destination, origin));
}
