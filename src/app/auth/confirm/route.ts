import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /auth/confirm — confirmation d'un lien e-mail (magic-link / signup / recovery).
 *
 * Pattern officiel Supabase SSR pour les liens e-mail : le lien pointe ici avec
 * `?token_hash=...&type=magiclink` et on appelle `verifyOtp`, qui établit la
 * session DANS LES COOKIES SERVEUR (createClient SSR). C'est indispensable car
 * le reste de l'app (middleware, Server Components) lit la session via cookies —
 * un `#access_token` en fragment d'URL n'est JAMAIS vu côté serveur.
 *
 * (Le flow OAuth/PKCE, lui, passe par /auth/callback avec `?code=`.)
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const redirectTo = searchParams.get("redirectTo");

  if (!tokenHash || !type) {
    const url = new URL("/login", origin);
    url.searchParams.set("error", "Lien invalide ou expiré.");
    return NextResponse.redirect(url);
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });

    if (error) {
      const url = new URL("/login", origin);
      url.searchParams.set("error", "Impossible de vous connecter. Réessayez.");
      return NextResponse.redirect(url);
    }

    // Onboarding si non complété, sinon l'espace.
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
      if (!profile?.onboarding_completed) destination = "/onboarding";
    }

    if (redirectTo && redirectTo.startsWith("/")) destination = redirectTo;

    return NextResponse.redirect(new URL(destination, origin));
  } catch (err) {
    console.error("[auth/confirm] Échec verifyOtp :", err);
    const url = new URL("/login", origin);
    url.searchParams.set("error", "Erreur de connexion. Réessayez.");
    return NextResponse.redirect(url);
  }
}
