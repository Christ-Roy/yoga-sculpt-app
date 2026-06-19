import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import type { Cookie } from "@playwright/test";
import { e2eEnv } from "./env";

/**
 * Helpers Supabase pour le harnais E2E — exécutés CÔTÉ NODE (fixtures), jamais
 * dans le navigateur. Trois responsabilités :
 *
 *   1. admin() : client service_role (bypass RLS) pour fabriquer/nettoyer les
 *      comptes de test et VÉRIFIER l'état de la DB (table `tickets`, `bookings`…).
 *   2. createConfirmedUser() : crée un compte e-mail CONFIRMÉ jetable.
 *   3. sessionCookies() : ouvre une vraie session pour ce compte et renvoie les
 *      cookies `@supabase/ssr` à injecter dans le contexte Playwright — exactement
 *      le format que lit `src/lib/supabase/server.ts` (createServerClient).
 *
 * POURQUOI cette voie d'auth ? Le login normal passe par un magic-link e-mail
 * (verifyOtp au clic humain, anti-prefetch). En E2E on ne veut pas dépendre d'une
 * boîte mail : on génère le token via l'Admin API (generateLink), on l'échange en
 * session côté Node (verifyOtp avec le client anon), puis on POSE les cookies SSR
 * via le MÊME `createServerClient` que l'app → garantie de compatibilité de format
 * (chunking, base64-, noms `sb-<ref>-auth-token`). Aucun secret hardcodé.
 */

let adminClient: SupabaseClient | null = null;

/** Client service_role (bypass RLS) — vérification DB + admin auth. */
export function admin(): SupabaseClient {
  if (!adminClient) {
    adminClient = createClient(
      e2eEnv.supabaseUrl(),
      e2eEnv.supabaseServiceKey(),
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  }
  return adminClient;
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
}

/** Crée un compte e-mail CONFIRMÉ jetable (préfixe e2e- pour le repérer/nettoyer). */
export async function createConfirmedUser(
  prefix = "e2e",
): Promise<TestUser> {
  const rand = Math.random().toString(36).slice(2, 10);
  const email = `${prefix}-${Date.now()}-${rand}@e2e.yoga-sculpt.test`;
  const password = `Pw-${rand}-${Math.random().toString(36).slice(2, 10)}`;

  const { data, error } = await admin().auth.admin.createUser({
    email,
    password,
    email_confirm: true, // pas de mail à valider : compte directement utilisable.
  });
  if (error || !data.user) {
    throw new Error(`[e2e] createConfirmedUser a échoué : ${error?.message}`);
  }
  return { id: data.user.id, email, password };
}

/**
 * Ouvre une session pour `user` et renvoie les cookies `@supabase/ssr` prêts à
 * être injectés dans le contexte navigateur Playwright.
 *
 * On échange un magic-link (Admin generateLink) en session via le client anon
 * (verifyOtp), puis on rejoue cette session dans un `createServerClient` à jar de
 * cookies en mémoire : ce client SÉRIALISE la session au format EXACT attendu par
 * l'app. On convertit ces cookies en `Cookie[]` Playwright pour le `baseUrl`.
 */
export async function sessionCookies(
  user: TestUser,
  baseUrl: string,
): Promise<Cookie[]> {
  // 1) Génère un token magiclink via l'Admin API (pas d'e-mail réel envoyé).
  const { data: linkData, error: linkErr } = await admin().auth.admin.generateLink({
    type: "magiclink",
    email: user.email,
  });
  if (linkErr || !linkData?.properties?.hashed_token) {
    throw new Error(`[e2e] generateLink a échoué : ${linkErr?.message}`);
  }
  const tokenHash = linkData.properties.hashed_token;

  // 2) Échange le token en SESSION via le client anon (comme le ferait le navigateur).
  const anon = createClient(e2eEnv.supabaseUrl(), e2eEnv.supabaseAnonKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: otpData, error: otpErr } = await anon.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });
  if (otpErr || !otpData.session) {
    throw new Error(`[e2e] verifyOtp a échoué : ${otpErr?.message}`);
  }
  const session = otpData.session;

  // 3) Rejoue la session dans un createServerClient à jar mémoire → il produit les
  //    cookies au FORMAT de l'app (le même module @supabase/ssr).
  const jar = new Map<string, string>();
  const setCookies: { name: string; value: string }[] = [];
  const ssr = createServerClient(
    e2eEnv.supabaseUrl(),
    e2eEnv.supabaseAnonKey(),
    {
      cookies: {
        getAll() {
          return [...jar.entries()].map(([name, value]) => ({ name, value }));
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            jar.set(name, value);
            setCookies.push({ name, value });
          }
        },
      },
    },
  );
  await ssr.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });

  if (setCookies.length === 0) {
    throw new Error("[e2e] setSession n'a produit aucun cookie SSR.");
  }

  const { hostname } = new URL(baseUrl);
  return setCookies.map(({ name, value }) => ({
    name,
    value,
    domain: hostname,
    path: "/",
    httpOnly: false,
    secure: baseUrl.startsWith("https"),
    sameSite: "Lax" as const,
    expires: -1,
  }));
}

/** Solde total (somme quantite_restante) d'un type de ticket pour un user. */
export async function ticketBalance(
  userId: string,
  type?: "collectif" | "particulier",
): Promise<number> {
  let q = admin()
    .from("tickets")
    .select("quantite_restante, type")
    .eq("user_id", userId);
  if (type) q = q.eq("type", type);
  const { data, error } = await q;
  if (error) throw new Error(`[e2e] lecture tickets : ${error.message}`);
  return (data ?? []).reduce(
    (acc, t: { quantite_restante: number }) => acc + (Number(t.quantite_restante) || 0),
    0,
  );
}

/** Insère directement N tickets pour un user (raccourci de mise en condition). */
export async function grantTickets(
  userId: string,
  type: "collectif" | "particulier",
  quantite: number,
): Promise<void> {
  const { error } = await admin().from("tickets").insert({
    user_id: userId,
    type,
    quantite_initiale: quantite,
    quantite_restante: quantite,
    source: "e2e-seed",
  });
  if (error) throw new Error(`[e2e] grantTickets : ${error.message}`);
}

/**
 * Sème un ticket DÉJÀ CONSOMMÉ (quantite_initiale=1, quantite_restante=0) + un
 * booking `confirmed` qui le lie, AU FORMAT DB exact — la mise en condition du
 * cycle d'annulation, sans rejouer toute la réservation Google.
 *
 * Renvoie `{ bookingId, ticketId }`. On contrôle `startsAt` à la seconde près :
 * c'est la VARIABLE du test (>24h → restitution autorisée, <24h → refusée). Le
 * `google_event_id` est un placeholder `pending-e2e-…` → la route `/api/annuler`
 * NE touche PAS l'agenda Google (elle ignore les ids `pending-`), donc le test
 * reste hermétique aux aléas réseau/quota Google : on valide la VÉRITÉ MÉTIER
 * (statut booking + recrédit ticket), pas l'effet de bord agenda.
 */
export async function seedConsumedBooking(
  userId: string,
  opts: {
    type: "collectif" | "particulier";
    startsAt: Date;
    /** Durée du créneau (défaut 60 min). */
    durationMinutes?: number;
  },
): Promise<{ bookingId: string; ticketId: string }> {
  const startsAt = opts.startsAt.toISOString();
  const endsAt = new Date(
    opts.startsAt.getTime() + (opts.durationMinutes ?? 60) * 60_000,
  ).toISOString();

  // Ticket consommé : initiale=1, restante=0 → après annulation >24h on attend 1.
  const { data: ticketRow, error: ticketErr } = await admin()
    .from("tickets")
    .insert({
      user_id: userId,
      type: opts.type,
      quantite_initiale: 1,
      quantite_restante: 0,
      source: "e2e-seed",
    })
    .select("id")
    .single();
  if (ticketErr || !ticketRow) {
    throw new Error(`[e2e] seedConsumedBooking ticket : ${ticketErr?.message}`);
  }
  const ticketId = ticketRow.id as string;

  // Booking confirmé lié au ticket. google_event_id `pending-e2e-…` (jamais créé
  // dans Google) → annuler() saute la partie agenda.
  const rand = Math.random().toString(36).slice(2, 10);
  const { data: bookingRow, error: bookingErr } = await admin()
    .from("bookings")
    .insert({
      user_id: userId,
      type: opts.type,
      google_event_id: `pending-e2e-${rand}`,
      google_calendar_creneau_id: null,
      starts_at: startsAt,
      ends_at: endsAt,
      status: "confirmed",
      ticket_id: ticketId,
    })
    .select("id")
    .single();
  if (bookingErr || !bookingRow) {
    throw new Error(`[e2e] seedConsumedBooking booking : ${bookingErr?.message}`);
  }
  return { bookingId: bookingRow.id as string, ticketId };
}

/** Statut courant d'un booking précis ('confirmed' | 'cancelled' | null si absent). */
export async function bookingStatus(bookingId: string): Promise<string | null> {
  const { data, error } = await admin()
    .from("bookings")
    .select("status")
    .eq("id", bookingId)
    .maybeSingle();
  if (error) throw new Error(`[e2e] bookingStatus : ${error.message}`);
  return (data?.status as string | undefined) ?? null;
}

/** `quantite_restante` d'un ticket précis (pour vérifier le recrédit à l'annulation). */
export async function ticketRestante(ticketId: string): Promise<number> {
  const { data, error } = await admin()
    .from("tickets")
    .select("quantite_restante")
    .eq("id", ticketId)
    .maybeSingle();
  if (error) throw new Error(`[e2e] ticketRestante : ${error.message}`);
  return Number(data?.quantite_restante ?? NaN);
}

/** Nombre de bookings confirmés d'un user (pour vérifier une réservation). */
export async function confirmedBookings(userId: string): Promise<number> {
  const { count, error } = await admin()
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "confirmed");
  if (error) throw new Error(`[e2e] count bookings : ${error.message}`);
  return count ?? 0;
}

/** Supprime un compte de test + ses données (best-effort, nettoyage post-test). */
export async function deleteUser(userId: string): Promise<void> {
  // Les FK ON DELETE CASCADE devraient nettoyer tickets/bookings/referrals ;
  // on supprime quand même explicitement par sécurité (best-effort).
  await admin().from("bookings").delete().eq("user_id", userId);
  await admin().from("tickets").delete().eq("user_id", userId);
  await admin().from("referrals").delete().eq("filleul_user_id", userId);
  await admin().auth.admin.deleteUser(userId).catch(() => {});
}
