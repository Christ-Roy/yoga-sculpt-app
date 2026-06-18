import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for the browser (Client Components).
 * Uses the public anon key — safe to expose.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        // Les magic-links / liens admin renvoient la session dans le fragment
        // d'URL (`#access_token=...`). `detectSessionInUrl` fait que le client
        // browser lit ce fragment au chargement et établit la session (puis
        // nettoie l'URL). Sans ça, un magic-link laisse l'utilisateur sur /login.
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
      },
    },
  );
}
