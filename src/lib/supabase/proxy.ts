import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase session on every matched request and enforces
 * route protection. Called from `src/proxy.ts` (the Next.js 16 rename of
 * `middleware.ts`).
 *
 * IMPORTANT (per Supabase SSR docs): do not run any logic between creating
 * the client and calling `getClaims()` / `getUser()`. Always return the
 * `supabaseResponse` object as-is (so refreshed cookies are propagated),
 * unless you build a brand-new redirect response copying its cookies.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Refresh the session. Do NOT remove — required to keep tokens fresh.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  const isProtected =
    pathname.startsWith("/espace") || pathname.startsWith("/onboarding");
  const isAuthPage = pathname === "/login";

  // Not logged in + trying to reach a protected route → /login
  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirectTo", pathname);
    return redirectKeepingCookies(url, supabaseResponse);
  }

  // Logged in + on /login → send to the app entrypoint
  if (user && isAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/espace";
    url.search = "";
    return redirectKeepingCookies(url, supabaseResponse);
  }

  return supabaseResponse;
}

/**
 * Builds a redirect that preserves the cookies set on `supabaseResponse`
 * (so the refreshed Supabase session is not dropped during the redirect).
 */
function redirectKeepingCookies(url: URL, supabaseResponse: NextResponse) {
  const redirect = NextResponse.redirect(url);
  supabaseResponse.cookies.getAll().forEach((cookie) => {
    redirect.cookies.set(cookie);
  });
  return redirect;
}
