import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

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
  return updateSession(request);
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
