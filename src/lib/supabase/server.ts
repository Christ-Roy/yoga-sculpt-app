import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { DEV_AUTH_BYPASS } from "@/lib/dev-auth";
import { createServiceClient } from "@/lib/supabase/service";
import { authCookieDomainOptions } from "@/lib/supabase/cookie-domain";

/**
 * Supabase client for the server (Server Components, Route Handlers,
 * Server Actions). Reads/writes the session cookies via next/headers.
 *
 * In Next.js 16 `cookies()` is async, hence the `await` below.
 * Uses only the REST/PostgREST API under the hood (fetch) — fully
 * compatible with the Cloudflare Workers (edge) runtime via OpenNext.
 *
 * ⚠️ BYPASS DEV (cf `src/lib/dev-auth.ts`, garde env + NODE_ENV, DEV LOCAL
 * UNIQUEMENT) : il n'y a pas de session cookie quand on bypasse l'auth, donc
 * les lectures RLS-scopées (`auth.uid()`) renverraient vide. On retourne alors
 * le SERVICE CLIENT (service_role) pour que les pages affichent de vraies
 * données du compte de test. NB : sur les tables protégées uniquement par RLS
 * (tickets/bookings : pas de filtre `user_id` explicite, on s'appuie sur
 * `auth.uid()`), le service_role contourne RLS → sur-lecture possible en dev.
 * C'est un compromis ASSUMÉ et DEV-ONLY (itération UI) ; en prod ce code est
 * mort (DEV_AUTH_BYPASS=false, éliminé au build).
 */
export async function createClient() {
  if (DEV_AUTH_BYPASS) {
    return createServiceClient();
  }

  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // ⚠️ PROD : scope le cookie de session sur le domaine parent
      // (`Domain=.yoga-sculpt.fr`) → partagé apex (vitrine) + `app.` (espace
      // client), sans `SameSite=None`. En dev/local : objet vide → host-only
      // (sinon le cookie casse en `localhost`). Cf src/lib/supabase/cookie-domain.
      ...authCookieDomainOptions(),
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
