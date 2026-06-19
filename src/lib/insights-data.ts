/**
 * Couche DONNÉES de la page Insights (`/admin/insights`).
 *
 * Lit les VUES d'agrégation posées par la migration 0006 (v_user_signals,
 * v_funnel_global, v_user_checkout_abandons, v_funnel_events_30j) via le client
 * `service_role` (bypass RLS). Les vues sont `security_invoker` au-dessus d'une
 * table RLS-sans-policy → seule la service_role peut les lire (fail-safe : un
 * client lambda obtiendrait 0 ligne).
 *
 * STRICTEMENT serveur (importe createServiceClient = clé secrète). Les pages qui
 * l'appellent sont des Server Components gardés par `requireAdmin()`.
 *
 * RUNTIME — Cloudflare Workers (edge) : Supabase REST (fetch) uniquement.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { createLogger } from "@/lib/log";

const log = createLogger("insights");

// ============================================================================
// Types exposés à l'UI
// ============================================================================

/** Une ligne de la vue v_funnel_global (KPIs globaux du funnel). */
export interface FunnelGlobal {
  nbInscrits: number;
  nbOnboardes: number;
  nbAcheteurs: number;
  nbAvecResa: number;
  nbAvecSeancePassee: number;
  nbParraines: number;
  nbTicketsParrainage: number;
  nbCheckoutsAbandonnes: number;
  nbCheckoutsCompletes: number;
  caReelEur: number;
}

/** Une ligne de la vue v_user_signals (signaux agrégés d'un user). */
export interface UserSignals {
  userId: string;
  email: string | null;
  fullName: string | null;
  signupAt: string;
  onboardingCompleted: boolean;
  nbSeancesPassees: number;
  nbSeancesAVenir: number;
  nbTicketsPayes: number;
  nbTicketsTotal: number;
  acquisitionSource: "referral" | "direct";
  parrainUserId: string | null;
  nbFilleulsCredites: number;
  checkoutAbandonnes: number;
  ltvEur: number;
  derniereActivite: string;
}

/** Un checkout abandonné (session démarrée, jamais complétée). */
export interface CheckoutAbandon {
  userId: string | null;
  email: string | null;
  fullName: string | null;
  stripeSessionId: string | null;
  formule: string | null;
  montant: number | null;
  startedAt: string;
}

/** Volume d'un type d'event sur 30 jours glissants. */
export interface EventVolume30j {
  eventType: string;
  nbTotal: number;
  nbUsers: number;
  dernier: string | null;
}

/** Données complètes consommées par la page /admin/insights. */
export interface InsightsData {
  funnel: FunnelGlobal;
  users: UserSignals[];
  abandons: CheckoutAbandon[];
  events30j: EventVolume30j[];
}

// ============================================================================
// Funnel global vide (fallback si la vue est indisponible — migration pas encore
// appliquée en dev, par exemple). On dégrade proprement plutôt que de planter.
// ============================================================================
const FUNNEL_VIDE: FunnelGlobal = {
  nbInscrits: 0,
  nbOnboardes: 0,
  nbAcheteurs: 0,
  nbAvecResa: 0,
  nbAvecSeancePassee: 0,
  nbParraines: 0,
  nbTicketsParrainage: 0,
  nbCheckoutsAbandonnes: 0,
  nbCheckoutsCompletes: 0,
  caReelEur: 0,
};

const n = (v: unknown): number => Number(v ?? 0) || 0;

// ============================================================================
// Chargement
// ============================================================================

/**
 * Charge toutes les données de la page Insights en parallèle. Tolérant aux
 * pannes : chaque vue est lue indépendamment ; si l'une échoue (vue absente,
 * réseau), on dégrade en valeur vide pour ne pas casser toute la page.
 */
export async function chargerInsights(): Promise<InsightsData> {
  const supabase = createServiceClient();

  const [funnelRes, usersRes, abandonsRes, events30jRes] = await Promise.all([
    supabase.from("v_funnel_global").select("*").maybeSingle(),
    supabase
      .from("v_user_signals")
      .select("*")
      .order("derniere_activite", { ascending: false }),
    supabase
      .from("v_user_checkout_abandons")
      .select("*")
      .order("started_at", { ascending: false }),
    supabase.from("v_funnel_events_30j").select("*"),
  ]);

  // --- Funnel global ------------------------------------------------------
  let funnel: FunnelGlobal = FUNNEL_VIDE;
  if (funnelRes.error) {
    log.error("v_funnel_global indisponible", { db: funnelRes.error.message });
  } else if (funnelRes.data) {
    const f = funnelRes.data as Record<string, unknown>;
    funnel = {
      nbInscrits: n(f.nb_inscrits),
      nbOnboardes: n(f.nb_onboardes),
      nbAcheteurs: n(f.nb_acheteurs),
      nbAvecResa: n(f.nb_avec_resa),
      nbAvecSeancePassee: n(f.nb_avec_seance_passee),
      nbParraines: n(f.nb_parraines),
      nbTicketsParrainage: n(f.nb_tickets_parrainage),
      nbCheckoutsAbandonnes: n(f.nb_checkouts_abandonnes),
      nbCheckoutsCompletes: n(f.nb_checkouts_completes),
      caReelEur: n(f.ca_reel_eur),
    };
  }

  // --- Signaux par user ---------------------------------------------------
  if (usersRes.error) {
    log.error("v_user_signals indisponible", { db: usersRes.error.message });
  }
  const usersRaw = (usersRes.data ?? []) as Array<Record<string, unknown>>;

  // Index user_id → libellé pour résoudre le nom du parrain.
  const labelParId = new Map<string, { email: string | null; fullName: string | null }>();
  for (const u of usersRaw) {
    labelParId.set(u.user_id as string, {
      email: (u.email as string | null) ?? null,
      fullName: (u.full_name as string | null) ?? null,
    });
  }

  const users: UserSignals[] = usersRaw.map((u) => ({
    userId: u.user_id as string,
    email: (u.email as string | null) ?? null,
    fullName: (u.full_name as string | null) ?? null,
    signupAt: u.signup_at as string,
    onboardingCompleted: Boolean(u.onboarding_completed),
    nbSeancesPassees: n(u.nb_seances_passees),
    nbSeancesAVenir: n(u.nb_seances_a_venir),
    nbTicketsPayes: n(u.nb_tickets_payes),
    nbTicketsTotal: n(u.nb_tickets_total),
    acquisitionSource: u.acquisition_source === "referral" ? "referral" : "direct",
    parrainUserId: (u.parrain_user_id as string | null) ?? null,
    nbFilleulsCredites: n(u.nb_filleuls_credites),
    checkoutAbandonnes: n(u.checkout_abandonnes),
    ltvEur: n(u.ltv_eur),
    derniereActivite: u.derniere_activite as string,
  }));

  // --- Checkouts abandonnés (avec libellé client) -------------------------
  if (abandonsRes.error) {
    log.error("v_user_checkout_abandons indisponible", {
      db: abandonsRes.error.message,
    });
  }
  const abandons: CheckoutAbandon[] = (
    (abandonsRes.data ?? []) as Array<Record<string, unknown>>
  ).map((a) => {
    const label = a.user_id ? labelParId.get(a.user_id as string) : undefined;
    return {
      userId: (a.user_id as string | null) ?? null,
      email: label?.email ?? null,
      fullName: label?.fullName ?? null,
      stripeSessionId: (a.stripe_session_id as string | null) ?? null,
      formule: (a.formule as string | null) ?? null,
      montant: a.montant != null ? Number(a.montant) : null,
      startedAt: a.started_at as string,
    };
  });

  // --- Volume d'events 30j ------------------------------------------------
  if (events30jRes.error) {
    log.error("v_funnel_events_30j indisponible", {
      db: events30jRes.error.message,
    });
  }
  const events30j: EventVolume30j[] = (
    (events30jRes.data ?? []) as Array<Record<string, unknown>>
  )
    .map((e) => ({
      eventType: e.event_type as string,
      nbTotal: n(e.nb_total),
      nbUsers: n(e.nb_users),
      dernier: (e.dernier as string | null) ?? null,
    }))
    .sort((a, b) => b.nbTotal - a.nbTotal);

  return { funnel, users, abandons, events30j };
}

/**
 * Résout le libellé d'affichage d'un user (nom complet → email → uuid court).
 * Exposé pour la page (résolution du nom de parrain dans la table par-user).
 */
export function libelleUser(
  u: Pick<UserSignals, "fullName" | "email" | "userId"> | undefined,
): string {
  if (!u) return "—";
  return u.fullName?.trim() || u.email || `${u.userId.slice(0, 8)}…`;
}
