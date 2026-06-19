import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { sanitizeRefCode } from "@/lib/ref-code";
import { appliquerHeadersSecurite } from "@/lib/security-headers";
import { getClientIpFromHeaders } from "@/lib/anti-abuse";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Durée de vie des cookies de parrainage (30 min) — couvre une inscription
 * complète, y compris un aller-retour OAuth, sans traîner sur l'appareil.
 */
const REF_COOKIE_MAX_AGE = 60 * 30;

/**
 * Rate-limit (best-effort, edge-safe) de la landing PUBLIQUE `/invitation`.
 *
 * `/invitation?ref=<CODE>` résout, via service_role, prénom + avatar + e-mail du
 * parrain. Sans limite, un attaquant pourrait flooder des codes pour énumérer /
 * DoS (sévérité BASSE : 31^8 combinaisons, sanitizeRefCode rejette les codes
 * hors-format avant toute DB — cf. ticket). On pose ici un garde-fou anti-flood
 * NAÏF par IP, à coût ~nul, SANS binding/dépendance.
 *
 * ⚠️ In-memory isolate-local → best-effort uniquement (cf. lib/rate-limit.ts).
 * La protection durable d'une route publique reste une règle Cloudflare Rate
 * Limiting / WAF côté dashboard (Option A du ticket invitation-rate-limit).
 *
 * 30 req / 60 s / IP : large pour un humain (recharges, retours OAuth), serré
 * pour un script qui balaie des codes.
 */
const INVITATION_RL_LIMIT = 30;
const INVITATION_RL_WINDOW_MS = 60_000;

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
 * Applique le rate-limit anti-flood SUR `/invitation` uniquement. Renvoie une
 * réponse `429` (avec `Retry-After` + en-têtes de sécurité) si la limite est
 * dépassée, sinon `null` (le middleware poursuit normalement).
 *
 * Best-effort : sans IP exploitable, on n'applique pas de limite (on ne bloque
 * jamais un visiteur légitime faute d'IP).
 */
function appliquerRateLimitInvitation(
  request: NextRequest,
): NextResponse | null {
  if (request.nextUrl.pathname !== "/invitation") return null;

  const ip = getClientIpFromHeaders(request.headers);
  const verdict = checkRateLimit(
    ip ? `invitation:${ip}` : null,
    INVITATION_RL_LIMIT,
    INVITATION_RL_WINDOW_MS,
  );
  if (verdict.allowed) return null;

  const res = new NextResponse("Trop de requêtes. Réessayez dans un instant.", {
    status: 429,
    headers: {
      "Retry-After": String(verdict.retryAfterSec),
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
  appliquerHeadersSecurite(res.headers);
  return res;
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
  // ── Rate-limit anti-flood de /invitation (AVANT tout I/O session). ──────────
  // On limite par IP réelle (CF-Connecting-IP). Sans IP exploitable → pas de
  // limite (le rate-limit est une protection DoS, pas un contrôle d'accès).
  const rl = appliquerRateLimitInvitation(request);
  if (rl) return rl;

  const response = await updateSession(request);
  // Capte un éventuel `?ref=` (lien de parrainage) et pose les cookies sur la
  // réponse — jamais dans le render de la page (cf. deposerCookieParrainage).
  deposerCookieParrainage(request, response);
  // En-têtes de sécurité (HSTS / X-Frame / nosniff / Referrer / Permissions +
  // CSP en report-only) posés globalement ici — c'est la seule couche traversée
  // par TOUTES les routes/pages sur ce runtime (Workers/OpenNext n'évalue pas
  // `next.config.ts#headers()` au build d'un export edge). Cf. security-headers.ts.
  appliquerHeadersSecurite(response.headers);
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
