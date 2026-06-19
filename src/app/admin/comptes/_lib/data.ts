/**
 * Couche DONNÉES du back-office « Comptes » (`/admin/comptes`).
 *
 * On croise plusieurs sources, toutes lues via le client `service_role`
 * (bypass RLS — l'admin voit TOUS les comptes) :
 *   - GoTrue admin `auth.admin.listUsers()` : la liste de vérité des comptes
 *     (id, e-mail, date d'inscription, provider d'auth, statut de suspension).
 *   - `profiles`  : nom, téléphone (+ e-mail de secours), code de parrainage.
 *   - `tickets`   : solde de séances restantes par type.
 *   - `bookings`  : nombre de séances passées / à venir (confirmées).
 *   - `referrals` : parrain éventuel (qui a parrainé ce compte).
 *
 * STRICTEMENT serveur (importe `createServiceClient`) — ne JAMAIS l'importer
 * dans un composant client. Les pages qui l'appellent sont des Server Components
 * gardés par `requireAdmin()`.
 *
 * RUNTIME — Cloudflare Workers (edge) : Supabase REST + GoTrue admin REST, via
 * `fetch` uniquement. Aucune API Node-only.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { createLogger } from "@/lib/log";
import type { TicketType, BookingStatus } from "@/lib/db-types";

const log = createLogger("comptes/data");

/** Provider d'authentification résolu pour l'affichage. */
export type AuthProvider = "google" | "azure" | "email" | "autre";

/** Solde de séances restantes par type. */
export interface SoldeTickets {
  collectif: number;
  particulier: number;
}

/** Une ligne de la liste des comptes (vue résumée). */
export interface CompteRow {
  id: string;
  /** E-mail (GoTrue prime ; fallback profil). */
  email: string;
  /** Nom complet (profil) ou « — ». */
  nom: string;
  /** Téléphone (profil) ou null. */
  telephone: string | null;
  /** ISO 8601 — date d'inscription (GoTrue). */
  createdAt: string;
  /** Provider d'auth principal. */
  provider: AuthProvider;
  /** Solde de séances restantes par type. */
  solde: SoldeTickets;
  /** Nb de réservations confirmées passées. */
  seancesPassees: number;
  /** Nb de réservations confirmées à venir. */
  seancesAVenir: number;
  /** True si le compte est suspendu (ban GoTrue actif). */
  suspendu: boolean;
  /** True si l'onboarding est complété (profil). */
  onboardingComplet: boolean;
  /** E-mail du parrain, si ce compte a été parrainé. */
  parrainEmail: string | null;
}

/** Détail complet d'un compte (fiche). */
export interface CompteDetail extends CompteRow {
  /** ISO 8601 — dernière connexion (GoTrue), si connue. */
  lastSignInAt: string | null;
  /** ISO 8601 — fin de suspension (GoTrue), si suspendu. */
  bannedUntil: string | null;
  /** Réponses d'onboarding (objectif/niveau/fréquence/dispo), si présentes. */
  onboarding: {
    goal: string | null;
    level: string | null;
    frequency: string | null;
    availability: string | null;
  } | null;
  /** Tickets détaillés (carnets) du compte. */
  tickets: Array<{
    id: string;
    type: TicketType;
    quantiteInitiale: number;
    quantiteRestante: number;
    expiresAt: string | null;
    createdAt: string;
    /** True s'il s'agit d'un ajustement admin (vs un achat Stripe). */
    ajustementAdmin: boolean;
  }>;
  /** Réservations du compte (confirmées + annulées), récentes d'abord. */
  bookings: Array<{
    id: string;
    type: TicketType;
    startsAt: string;
    status: BookingStatus;
    createdAt: string;
  }>;
  /** Filleuls que CE compte a parrainés (s'il est parrain). */
  filleuls: Array<{
    filleulEmail: string;
    status: string;
    ticketCredite: boolean;
    createdAt: string;
  }>;
}

/** Page de résultats de la liste (pagination). */
export interface CompteListePage {
  comptes: CompteRow[];
  /** Total de comptes (GoTrue). */
  total: number;
  /** Page courante (1-based). */
  page: number;
  /** Taille de page. */
  perPage: number;
}

/** Taille de page par défaut de la liste. */
export const PER_PAGE = 25;

/** Préfixe marquant un ticket d'ajustement admin (cf tickets-admin.ts). */
const ADMIN_ADJUST_PREFIX = "admin-adjust:";

// ============================================================================
// Résolution du provider d'auth
// ============================================================================

/**
 * Déduit le provider d'auth principal d'un user GoTrue.
 * `app_metadata.provider` est le plus fiable ; on retombe sur la 1re identité,
 * puis sur « email » (magic-link / mot de passe) par défaut.
 */
function resoudreProvider(user: {
  app_metadata?: { provider?: string } | null;
  identities?: Array<{ provider?: string }> | null;
}): AuthProvider {
  const brut =
    user.app_metadata?.provider ??
    user.identities?.[0]?.provider ??
    "email";
  if (brut === "google") return "google";
  if (brut === "azure" || brut === "microsoft") return "azure";
  if (brut === "email") return "email";
  return "autre";
}

/** Un compte est suspendu si `banned_until` est dans le futur. */
function estSuspendu(bannedUntil: string | null | undefined): boolean {
  if (!bannedUntil) return false;
  const t = new Date(bannedUntil).getTime();
  return Number.isFinite(t) && t > Date.now();
}

// ============================================================================
// Liste des comptes (paginée)
// ============================================================================

/**
 * Charge une page de comptes, enrichie de toutes les sources.
 *
 * @param page    page 1-based (défaut 1).
 * @param perPage taille de page (défaut PER_PAGE).
 */
export async function chargerComptes(
  page = 1,
  perPage = PER_PAGE,
): Promise<CompteListePage> {
  const supabase = createServiceClient();
  const pageSafe = Math.max(1, Math.floor(page));

  // 1) Liste de vérité = GoTrue (paginé). `page` GoTrue est 1-based.
  const { data, error } = await supabase.auth.admin.listUsers({
    page: pageSafe,
    perPage,
  });
  if (error) {
    log.error("listUsers a échoué", { db: error.message });
    return { comptes: [], total: 0, page: pageSafe, perPage };
  }

  const users = data.users ?? [];
  // GoTrue ne renvoie pas toujours `total` ; on retombe sur une estimation.
  const total =
    (data as { total?: number }).total ?? (pageSafe - 1) * perPage + users.length;

  if (users.length === 0) {
    return { comptes: [], total, page: pageSafe, perPage };
  }

  const ids = users.map((u) => u.id);
  const emailsParId = new Map<string, string>();
  for (const u of users) if (u.email) emailsParId.set(u.id, u.email);

  // 2) Enrichissements Supabase, en parallèle, restreints aux ids de la page.
  const [profilsRes, ticketsRes, bookingsRes, referralsRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, email, full_name, phone, onboarding_completed")
      .in("id", ids),
    supabase
      .from("tickets")
      .select("user_id, type, quantite_restante")
      .in("user_id", ids),
    supabase
      .from("bookings")
      .select("user_id, starts_at, status")
      .in("user_id", ids)
      .eq("status", "confirmed"),
    // Referrals où ces comptes sont FILLEULS (pour afficher leur parrain).
    supabase
      .from("referrals")
      .select("parrain_user_id, filleul_user_id")
      .in("filleul_user_id", ids),
  ]);

  // Index profils.
  const profilParId = new Map<
    string,
    { email: string | null; nom: string | null; phone: string | null; onboarding: boolean }
  >();
  for (const p of (profilsRes.data ?? []) as Array<{
    id: string;
    email: string | null;
    full_name: string | null;
    phone: string | null;
    onboarding_completed: boolean;
  }>) {
    profilParId.set(p.id, {
      email: p.email,
      nom: p.full_name,
      phone: p.phone,
      onboarding: !!p.onboarding_completed,
    });
  }

  // Solde de tickets par user/type.
  const soldeParId = new Map<string, SoldeTickets>();
  for (const t of (ticketsRes.data ?? []) as Array<{
    user_id: string;
    type: TicketType;
    quantite_restante: number;
  }>) {
    const s = soldeParId.get(t.user_id) ?? { collectif: 0, particulier: 0 };
    const type: TicketType = t.type === "particulier" ? "particulier" : "collectif";
    s[type] += Number(t.quantite_restante) || 0;
    soldeParId.set(t.user_id, s);
  }

  // Séances passées / à venir (confirmées).
  const nowIso = new Date().toISOString();
  const passeesParId = new Map<string, number>();
  const aVenirParId = new Map<string, number>();
  for (const b of (bookingsRes.data ?? []) as Array<{
    user_id: string;
    starts_at: string;
    status: BookingStatus;
  }>) {
    const futur = b.starts_at >= nowIso;
    const cible = futur ? aVenirParId : passeesParId;
    cible.set(b.user_id, (cible.get(b.user_id) ?? 0) + 1);
  }

  // Parrain de chaque filleul (résolu vers l'e-mail du parrain via la map page,
  // sinon via une lecture profils ciblée).
  const parrainIdParFilleul = new Map<string, string>();
  for (const r of (referralsRes.data ?? []) as Array<{
    parrain_user_id: string;
    filleul_user_id: string | null;
  }>) {
    if (r.filleul_user_id) parrainIdParFilleul.set(r.filleul_user_id, r.parrain_user_id);
  }
  const parrainEmailParId = await resoudreEmailsParrains(
    supabase,
    [...new Set(parrainIdParFilleul.values())],
    emailsParId,
  );

  const comptes: CompteRow[] = users.map((u) => {
    const profil = profilParId.get(u.id);
    const solde = soldeParId.get(u.id) ?? { collectif: 0, particulier: 0 };
    const parrainId = parrainIdParFilleul.get(u.id);
    return {
      id: u.id,
      email: u.email ?? profil?.email ?? "—",
      nom: profil?.nom?.trim() || "—",
      telephone: profil?.phone ?? null,
      createdAt: u.created_at,
      provider: resoudreProvider(u),
      solde,
      seancesPassees: passeesParId.get(u.id) ?? 0,
      seancesAVenir: aVenirParId.get(u.id) ?? 0,
      suspendu: estSuspendu(u.banned_until),
      onboardingComplet: profil?.onboarding ?? false,
      parrainEmail: parrainId ? parrainEmailParId.get(parrainId) ?? null : null,
    };
  });

  return { comptes, total, page: pageSafe, perPage };
}

/**
 * Résout les e-mails des parrains (ids) : d'abord depuis la map de la page
 * courante, sinon via une lecture ciblée de `profiles` (parrains hors page).
 */
async function resoudreEmailsParrains(
  supabase: ReturnType<typeof createServiceClient>,
  parrainIds: string[],
  dejaConnus: Map<string, string>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const aLire: string[] = [];
  for (const id of parrainIds) {
    const connu = dejaConnus.get(id);
    if (connu) out.set(id, connu);
    else aLire.push(id);
  }
  if (aLire.length > 0) {
    const { data } = await supabase
      .from("profiles")
      .select("id, email")
      .in("id", aLire);
    for (const p of (data ?? []) as Array<{ id: string; email: string | null }>) {
      if (p.email) out.set(p.id, p.email);
    }
  }
  return out;
}

// ============================================================================
// Fiche d'un compte
// ============================================================================

/**
 * Charge le détail complet d'un compte (fiche). Renvoie `null` si l'id est
 * inconnu côté GoTrue (compte inexistant → 404 côté page).
 */
export async function chargerCompte(userId: string): Promise<CompteDetail | null> {
  const supabase = createServiceClient();

  const { data: userRes, error: userErr } =
    await supabase.auth.admin.getUserById(userId);
  if (userErr || !userRes.user) return null;
  const user = userRes.user;

  const [profilRes, onboardingRes, ticketsRes, bookingsRes, parrainRes, filleulsRes] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("email, full_name, phone, onboarding_completed")
        .eq("id", userId)
        .maybeSingle(),
      supabase
        .from("onboarding_responses")
        .select("goal, level, frequency, availability, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("tickets")
        .select(
          "id, type, quantite_initiale, quantite_restante, stripe_payment_id, expires_at, created_at",
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),
      supabase
        .from("bookings")
        .select("id, type, starts_at, status, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(50),
      // Parrain de CE compte (s'il est filleul).
      supabase
        .from("referrals")
        .select("parrain_user_id")
        .eq("filleul_user_id", userId)
        .maybeSingle(),
      // Filleuls de CE compte (s'il est parrain).
      supabase
        .from("referrals")
        .select("filleul_email, status, ticket_credite, created_at")
        .eq("parrain_user_id", userId)
        .order("created_at", { ascending: false }),
    ]);

  const profil = profilRes.data as {
    email: string | null;
    full_name: string | null;
    phone: string | null;
    onboarding_completed: boolean;
  } | null;

  // Solde par type + détail tickets.
  const solde: SoldeTickets = { collectif: 0, particulier: 0 };
  const tickets = ((ticketsRes.data ?? []) as Array<{
    id: string;
    type: TicketType;
    quantite_initiale: number;
    quantite_restante: number;
    stripe_payment_id: string | null;
    expires_at: string | null;
    created_at: string;
  }>).map((t) => {
    const type: TicketType = t.type === "particulier" ? "particulier" : "collectif";
    solde[type] += Number(t.quantite_restante) || 0;
    return {
      id: t.id,
      type,
      quantiteInitiale: Number(t.quantite_initiale) || 0,
      quantiteRestante: Number(t.quantite_restante) || 0,
      expiresAt: t.expires_at,
      createdAt: t.created_at,
      ajustementAdmin: (t.stripe_payment_id ?? "").startsWith(ADMIN_ADJUST_PREFIX),
    };
  });

  // Séances passées / à venir (confirmées).
  const nowIso = new Date().toISOString();
  let seancesPassees = 0;
  let seancesAVenir = 0;
  const bookings = ((bookingsRes.data ?? []) as Array<{
    id: string;
    type: TicketType;
    starts_at: string;
    status: BookingStatus;
    created_at: string;
  }>).map((b) => {
    if (b.status === "confirmed") {
      if (b.starts_at >= nowIso) seancesAVenir += 1;
      else seancesPassees += 1;
    }
    return {
      id: b.id,
      type: (b.type === "particulier" ? "particulier" : "collectif") as TicketType,
      startsAt: b.starts_at,
      status: b.status,
      createdAt: b.created_at,
    };
  });

  // Parrain (e-mail).
  let parrainEmail: string | null = null;
  const parrainId = (parrainRes.data as { parrain_user_id?: string } | null)
    ?.parrain_user_id;
  if (parrainId) {
    const { data: parrainUser } = await supabase.auth.admin.getUserById(parrainId);
    parrainEmail = parrainUser?.user?.email ?? null;
  }

  const onboarding = onboardingRes.data as {
    goal: string | null;
    level: string | null;
    frequency: string | null;
    availability: string | null;
  } | null;

  return {
    id: user.id,
    email: user.email ?? profil?.email ?? "—",
    nom: profil?.full_name?.trim() || "—",
    telephone: profil?.phone ?? null,
    createdAt: user.created_at,
    provider: resoudreProvider(user),
    solde,
    seancesPassees,
    seancesAVenir,
    suspendu: estSuspendu(user.banned_until),
    onboardingComplet: profil?.onboarding_completed ?? false,
    parrainEmail,
    lastSignInAt: user.last_sign_in_at ?? null,
    bannedUntil: user.banned_until ?? null,
    onboarding: onboarding
      ? {
          goal: onboarding.goal,
          level: onboarding.level,
          frequency: onboarding.frequency,
          availability: onboarding.availability,
        }
      : null,
    tickets,
    bookings,
    filleuls: ((filleulsRes.data ?? []) as Array<{
      filleul_email: string;
      status: string;
      ticket_credite: boolean;
      created_at: string;
    }>).map((f) => ({
      filleulEmail: f.filleul_email,
      status: f.status,
      ticketCredite: !!f.ticket_credite,
      createdAt: f.created_at,
    })),
  };
}
