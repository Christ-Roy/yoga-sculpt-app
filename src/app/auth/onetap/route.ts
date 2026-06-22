import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { enregistrerSignaux, completerReferral } from "@/lib/referral";
import { getClientIp } from "@/lib/anti-abuse";
import { captureGclidOnProfile, parseGclidCookie } from "@/lib/ads-attribution";
import { logEvent } from "@/lib/events";
import { safeInternalRedirect } from "@/lib/auth-redirect";
import { createLogger, serializeError } from "@/lib/log";

const log = createLogger("auth/onetap");

/**
 * RELAIS One Tap CROSS-DOMAIN (vitrine → app).
 *
 * Le Google One Tap du VITRINE (`yoga-sculpt.fr`, repo `alice-gaudry`,
 * `site/src/components/GoogleOneTap.tsx`) ne peut PAS ouvrir la session
 * Supabase lui-même : la session vit sur `app.yoga-sculpt.fr`, pas sur le
 * vitrine (cross-origin). Au clic, le vitrine relaie donc le credential Google
 * (id_token JWT) vers :
 *
 *     https://app.yoga-sculpt.fr/auth/onetap?credential=<JWT_GOOGLE>
 *
 * Cette route échange ce credential contre une vraie session Supabase
 * (`signInWithIdToken`), pose les cookies de session SAME-ORIGIN, puis redirige
 * vers `/` (qui route ensuite vers `/onboarding` ou `/espace` selon le profil).
 *
 * À DISTINGUER du One Tap INTERNE de l'app (`AuthMethods.tsx`, sur `/login` et
 * `/invitation`) : celui-là appelle `signInWithIdToken` côté client, sans relai.
 * Ici c'est le relai serveur du vitrine, distinct.
 *
 * Runtime : runtime par défaut (edge-compatible via OpenNext), comme
 * `auth/callback/route.ts` — uniquement des appels Supabase fetch + écriture de
 * cookies, aucune API Node-only. Pas d'`export const runtime` (cohérent avec
 * les autres routes auth).
 *
 * FAIL-SAFE : credential absent/malformé OU `signInWithIdToken` en erreur
 * (provider Google non configuré en staging, token expiré, refus) → redirect
 * propre vers `/login?error=...`, JAMAIS un 500 nu. Le vitrine compte sur ce
 * fallback (« au pire, login Google normal sur l'app »).
 *
 * PARRAINAGE (V2b) : comme au callback, c'est ICI qu'un compte filleul peut
 * devenir effectif (1re connexion via One Tap). On y rejoue donc la même
 * mécanique BEST-EFFORT — capter l'IP de création (anti-abus), capter le gclid
 * first-touch (attribution Ads), et tenter de compléter un parrainage si le
 * cookie `ys_ref` (posé par le vitrine, scope `.yoga-sculpt.fr`) est présent.
 * Le cookie `ys_ref` est lisible ici car SAME-DOMAIN (`app.yoga-sculpt.fr` ⊂
 * `.yoga-sculpt.fr`). Toute erreur de cette mécanique est AVALÉE : elle ne
 * casse jamais l'auth (filet fiable : POST /api/parrainage/completer).
 */

// Filtre de forme JWT : trois segments base64url séparés par des points
// (header.payload.signature). On ne VÉRIFIE pas la signature ici (c'est le rôle
// de Supabase/Google côté `signInWithIdToken`) — on écarte juste un `credential`
// vide ou manifestement non-JWT avant de faire un appel réseau inutile.
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const credential = searchParams.get("credential");
  // Chemin éventuel demandé avant l'auth (client-contrôlé → validé plus bas).
  const redirectTo = searchParams.get("redirectTo");

  // Credential absent ou pas un JWT plausible → fallback login (jamais un 500).
  if (!credential || !JWT_SHAPE.test(credential)) {
    const url = new URL("/login", origin);
    url.searchParams.set("error", "Connexion Google impossible. Réessayez.");
    return NextResponse.redirect(url);
  }

  // Tout l'échange + le routing dans un try/catch : n'importe quel throw
  // (réseau, particularité edge, erreur SDK) doit produire un redirect propre
  // vers /login, jamais un 500 « server error » nu.
  try {
    const supabase = await createClient();
    const { error: signInError } = await supabase.auth.signInWithIdToken({
      provider: "google",
      token: credential,
    });

    if (signInError) {
      // ⚠️ NE PLUS avaler l'erreur en silence (piège skill `oauth`) : on logge la
      // cause RÉELLE du rejet Supabase pour pouvoir diagnostiquer "Connexion Google
      // impossible" via `wrangler tail`. Causes typiques : provider non configuré
      // (staging), nonce, audience du token, token expiré.
      log.error("signInWithIdToken (one tap) a échoué", {
        message: signInError.message,
        status: (signInError as { status?: number }).status ?? null,
        code: (signInError as { code?: string }).code ?? null,
      });
      const url = new URL("/login", origin);
      url.searchParams.set("error", "Connexion Google impossible. Réessayez.");
      return NextResponse.redirect(url);
    }

    // Destination : onboarding si pas complété, sinon l'espace. On calcule la
    // cible directement (comme `auth/callback`) plutôt que de rebondir par `/`,
    // pour éviter un aller-retour ; `/` router vers la même chose de toute façon.
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
      // Identique au flux `auth/callback` : (a) IP de création (anti-abus),
      // (b) gclid first-touch (attribution Ads), (c) complétion parrainage si
      // cookie `ys_ref`. Le fingerprint client n'est pas captable dans ce
      // redirect serveur (pas de JS) → il arrivera via POST /completer.
      try {
        const service = createServiceClient();
        const ip = getClientIp(request);
        await enregistrerSignaux(service, { userId: user.id, ip });

        const cookieStore = await cookies();

        await captureGclidOnProfile(
          service,
          user.id,
          parseGclidCookie(cookieStore.get("ys_gclid")?.value),
        );

        const refCode = cookieStore.get("ys_ref")?.value;
        if (refCode) {
          // completerReferral LIE le filleul au parrain en `pending` SANS
          // créditer (anti-farming : le ticket parrain tombe à la 1re séance
          // honorée). On NE consomme PAS le cookie httpOnly : le jumeau
          // `ys_ref_pub` sert au collector fingerprint à rejouer /completer.
          const result = await completerReferral(service, {
            code: refCode,
            filleulUserId: user.id,
            filleulEmail: user.email ?? "",
            ip,
            fingerprint: null,
          });
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
        log.error("Parrainage best-effort échoué (one tap)", {
          user_id: user.id,
          err: serializeError(referralErr),
        });
      }
    }

    // `redirectTo` est client-contrôlé → liste blanche stricte anti
    // open-redirect (rejette `//evil.com` / `/\evil.com`).
    destination = safeInternalRedirect(redirectTo, destination);

    return NextResponse.redirect(new URL(destination, origin));
  } catch {
    const url = new URL("/login", origin);
    url.searchParams.set("error", "Connexion Google impossible. Réessayez.");
    return NextResponse.redirect(url);
  }
}
