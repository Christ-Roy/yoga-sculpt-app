import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Supabase client for the server (Server Components, Route Handlers,
 * Server Actions). Reads/writes the session cookies via next/headers.
 *
 * In Next.js 16 `cookies()` is async, hence the `await` below.
 * Uses only the REST/PostgREST API under the hood (fetch) — fully
 * compatible with the Cloudflare Workers (edge) runtime via OpenNext.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // `setAll` was called from a Server Component (where cookies
            // are read-only). Safe to ignore: the proxy (middleware) is
            // responsible for refreshing the session cookies on each request.
          }
        },
      },
    },
  );
}
