import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { enregistrerSignaux, completerReferral } from "@/lib/referral";
import { getClientIp } from "@/lib/anti-abuse";
import {
  captureGclidOnProfile,
  parseGclidCookie,
  parseGclidFromParams,
} from "@/lib/ads-attribution";
import { logEvent } from "@/lib/events";
import { safeInternalRedirect } from "@/lib/auth-redirect";
import { createLogger, serializeError } from "@/lib/log";

const log = createLogger("auth/callback");

/**
 * OAuth / magic-link callback.
 *
 * - PKCE / OAuth flow → Supabase sends `?code=...`, we exchange it for a session.
 * - After exchange we route the user based on onboarding state.
 *
 * Runs on the default runtime (edge-compatible via OpenNext): only fetch-based
 * Supabase calls + cookie writes, no Node-only APIs.
 *
 * PARRAINAGE (V2b) : c'est ICI que le compte d'un filleul devient effectif. On
 * en profite pour (a) capter l'IP de création (signal anti-abus) et (b) tenter
 * de compléter un parrainage si un code a été suivi (cookie `ys_ref` déposé par
 * le front avant le login). Ces deux opérations sont BEST-EFFORT et n'altèrent
 * JAMAIS le flux d'auth : toute erreur est avalée (le filet de sécurité fiable
 * reste POST /api/parrainage/completer, qui apporte aussi le fingerprint client
 * — non captable dans ce redirect serveur sans JS).
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");
  // Optional path the user was trying to reach before auth.
  const redirectTo = searchParams.get("redirectTo");

  // The provider (or Supabase) bounced back with an explicit error
  // (e.g. Microsoft returning `server_error` when the email claim is missing).
  // Surface a readable message on /login instead of leaking it to the user.
  if (error) {
    const url = new URL("/login", origin);
    url.searchParams.set(
      "error",
      readableProviderError(error, errorDescription),
    );
    return NextResponse.redirect(url);
  }

  if (!code) {
    const url = new URL("/login", origin);
    url.searchParams.set("error", "Lien invalide ou expiré.");
    return NextResponse.redirect(url);
  }

  // Wrap the whole exchange + routing in a try/catch so that ANY throw
  // (network blip, edge runtime quirk, unexpected SDK error) results in a
  // clean redirect to /login with a message — never a raw 500 "server error".
  try {
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

      // ── PARRAINAGE (V2b) — best-effort, n'interrompt JAMAIS l'auth. ─────────
      // (a) Capter l'IP de création comme signal anti-abus. Le fingerprint, lui,
      //     n'est pas captable ici (pas de JS dans ce redirect) → il arrivera via
      //     POST /api/parrainage/completer.
      // (b) Si un code de parrainage a été suivi (cookie `ys_ref` posé par le
      //     front avant le login), tenter de compléter le parrainage. Le crédit
      //     reste soumis à l'anti-abus et SILENCIEUX en cas de refus.
      try {
        const service = createServiceClient();
        const ip = getClientIp(request);
        await enregistrerSignaux(service, { userId: user.id, ip });

        const cookieStore = await cookies();

        // ── ATTRIBUTION ADS — capter le gclid first-touch. Deux sources, dans
        //    l'ordre de fiabilité :
        //    1. cookie `ys_gclid` (posé par la vitrine, scope .yoga-sculpt.fr) —
        //       présent quand l'auth se fait sur le MÊME navigateur que le clic
        //       d'annonce (Google OAuth / One Tap / magic-link même device).
        //    2. FALLBACK query `?gclid=` — propagé DANS le lien magic-link par
        //       signInWithMagicLink, pour survivre à un magic-link ouvert sur un
        //       AUTRE device/navigateur (cas cross-device). Cf todo trou-attribution.
        //    Best-effort, n'écrase pas une attribution déjà posée (first-touch).
        await captureGclidOnProfile(
          service,
          user.id,
          parseGclidCookie(cookieStore.get("ys_gclid")?.value) ??
            parseGclidFromParams(searchParams),
        );

        const refCode = cookieStore.get("ys_ref")?.value;
        if (refCode) {
          // ANTI-FARMING : completerReferral LIE le filleul au parrain en
          // `pending` SANS créditer. Le ticket du parrain ne tombera qu'à la 1re
          // séance HONORÉE du filleul (cf. lib/referral + route admin attendance).
          const result = await completerReferral(service, {
            code: refCode,
            filleulUserId: user.id,
            filleulEmail: user.email ?? "",
            ip,
            // Fingerprint indisponible côté serveur ici → null (le POST
            // /completer le fournira et complétera si besoin, idempotent).
            fingerprint: null,
          });
          // On ne consomme plus le cookie httpOnly : le client (Fingerprint
          // collector) a besoin du jumeau `ys_ref_pub` pour rejouer /completer
          // AVEC le fingerprint. `ys_ref` expirera seul (maxAge ~30 min).
          // Tracking best-effort (ne casse jamais l'auth) : on journalise
          // l'ARRIVÉE du filleul via un lien (referral_signup). Le crédit, lui,
          // sera journalisé plus tard, au pointage de présence (referral_credited).
          if (result.linked) {
            void logEvent(
              user.id,
              "referral_signup",
              { code: refCode },
              { service },
            );
          }
        }
      } catch (referralErr) {
        // Le parrainage est secondaire : on ne casse pas la connexion pour ça.
        log.error("Parrainage best-effort échoué", {
          user_id: user.id,
          err: serializeError(referralErr),
        });
      }
    }

    // A safe explicit redirectTo takes precedence when present. `redirectTo` is
    // client-controlled → on le passe par `safeInternalRedirect` (rejette
    // `//evil.com` / `/\evil.com` : open-redirect protocol-relative).
    destination = safeInternalRedirect(redirectTo, destination);

    return NextResponse.redirect(new URL(destination, origin));
  } catch {
    const url = new URL("/login", origin);
    url.searchParams.set("error", "Impossible de vous connecter. Réessayez.");
    return NextResponse.redirect(url);
  }
}

/**
 * Maps raw OAuth error codes to a human-friendly French message.
 * Microsoft notably returns a bare `server_error` (often with an empty
 * description) when Supabase cannot resolve the account's email — surface
 * something actionable rather than the opaque code.
 */
function readableProviderError(
  error: string,
  description: string | null,
): string {
  if (description && description.trim().length > 0) return description;
  if (error === "server_error") {
    return "Connexion impossible avec ce compte. Vérifiez qu'il possède une adresse e-mail, ou utilisez l'e-mail ci-dessous.";
  }
  return error;
}
