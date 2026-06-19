import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { sanitizeRefCode } from "@/lib/ref-code";

/**
 * Durée de vie des cookies de parrainage (30 min) — couvre une inscription
 * complète, y compris un aller-retour OAuth, sans traîner sur l'appareil.
 */
const REF_COOKIE_MAX_AGE = 60 * 30;

/**
 * Parrainage (V2b) — capte le code `?ref=<CODE>` du lien d'invitation et le
 * dépose en cookie. DOIT se faire ici (middleware) et PAS dans le render de
 * `login/page.tsx` : écrire un cookie pendant le rendu d'une page (GET) est
 * interdit par Next 16 (« Cookies can only be modified in a Server Action or
 * Route Handler ») et lève un 500 sur le runtime Workers — ce qui cassait tout
 * lien de parrainage. Le middleware, lui, écrit légitimement sur la réponse.
 *
 * DEUX cookies, par design (cf. lib/ref-code.ts + auth/callback) :
 *   - `ys_ref`     httpOnly   → lu par le SERVEUR (auth/callback).
 *   - `ys_ref_pub` JS-lisible → lu par le CLIENT (FingerprintCollector) pour
 *                  POST /api/parrainage/completer avec le fingerprint device.
 */
function deposerCookieParrainage(request: NextRequest, response: Response) {
  const ref = request.nextUrl.searchParams.get("ref");
  const code = sanitizeRefCode(ref);
  if (!code) return;
  const isProd = process.env.NODE_ENV === "production";
  const base = {
    secure: isProd,
    sameSite: "lax" as const, // survit au redirect OAuth retour.
    path: "/",
    maxAge: REF_COOKIE_MAX_AGE,
  };
  // `response` est une NextResponse (retournée par updateSession) → .cookies.
  const res = response as unknown as {
    cookies: {
      set: (
        name: string,
        value: string,
        opts: Record<string, unknown>,
      ) => void;
    };
  };
  res.cookies.set("ys_ref", code, { ...base, httpOnly: true });
  res.cookies.set("ys_ref_pub", code, { ...base, httpOnly: false });
}

/**
 * Session-refresh + route-protection middleware.
 *
 * NOTE on naming: Next.js 16 renamed `middleware.ts` → `proxy.ts`, but the
 * new `proxy.ts` convention is *hard-pinned to the Node.js runtime* and
 * forbids `export const runtime`. OpenNext on Cloudflare Workers only
 * supports an EDGE middleware (it rejects Node.js middleware at build:
 * "Node.js middleware is not currently supported"). So we deliberately keep
 * the deprecated-but-still-functional `middleware.ts` convention, which DOES
 * allow an edge runtime export and emits an edge entry in
 * `middleware-manifest.json` that OpenNext can bundle. Next 16 requires the
 * value `"experimental-edge"` (plain `"edge"` is rejected for middleware).
 * Ref: cloudflare/workers-sdk#13755 (Next 16 proxy <-> OpenNext version trap).
 *
 * Only fetch-based Supabase REST calls + cookie writes run here — no Node-only
 * APIs — so the edge runtime is safe.
 */
export const runtime = "experimental-edge";

export async function middleware(request: NextRequest) {
  const response = await updateSession(request);
  // Capte un éventuel `?ref=` (lien de parrainage) et pose les cookies sur la
  // réponse — jamais dans le render de la page (cf. deposerCookieParrainage).
  deposerCookieParrainage(request, response);
  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, robots.txt, sitemap.xml (metadata)
     * - any path with a file extension (images, fonts, etc.)
     */
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.[\\w]+$).*)",
  ],
};
