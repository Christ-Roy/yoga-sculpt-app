import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

/**
 * Next.js 16 renamed `middleware.ts` → `proxy.ts` (function `middleware`
 * → `proxy`). This runs on every matched request to refresh the Supabase
 * session cookies and enforce route protection on /espace and /onboarding.
 *
 * Proxy defaults to the Node.js runtime in Next 16; it also runs fine on
 * the Cloudflare Workers runtime via OpenNext (only fetch-based Supabase
 * REST calls are used here — no Node-only APIs).
 */
export async function proxy(request: NextRequest) {
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
