/**
 * Couche DONNÉES du dashboard d'Alice (`/admin`).
 *
 * Toutes les lectures se font via le client `service_role` (bypass RLS) :
 * Alice voit TOUTES les lignes (bookings/tickets/profiles de tous les clients),
 * pas seulement les siennes. Ce module est STRICTEMENT serveur — il importe
 * `createServiceClient` (clé secrète) → ne JAMAIS l'importer dans un composant
 * client. Les pages admin qui l'appellent sont des Server Components.
 *
 * On y croise aussi les créneaux Google Calendar (events posés par Alice) avec
 * les `bookings` confirmés pour afficher, par créneau futur, la liste nominative
 * des inscrits (nom + email depuis `profiles`).
 *
 * RUNTIME — Cloudflare Workers (edge) : uniquement fetch (Supabase REST +
 * Google Calendar REST). Aucune API Node-only.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { listEvents } from "@/lib/google-calendar";
import {
  eventVersCreneau,
  fenetreCreneaux,
  type Creneau,
} from "@/lib/reservation";
import type { Booking, TicketType } from "@/lib/db-types";

// ============================================================================
// Hypothèse de calcul du CA (documentée)
// ============================================================================

/**
 * HYPOTHÈSE CA — Stripe (phase 2) n'est pas encore branché : la table `tickets`
 * ne stocke PAS le montant réellement payé (les prix vivent côté Stripe). Pour
 * donner à Alice un CA INDICATIF, on applique un tarif de référence par type de
 * séance × le nombre de séances achetées (`quantite_initiale`, pas `restante` :
 * le CA correspond à ce qui a été VENDU, pas à ce qui reste à consommer).
 *
 * Ces tarifs sont des PLACEHOLDERS (cf CLAUDE.md projet : 20/60 € à valider avec
 * Alice). Quand Stripe sera branché, on remplacera ce calcul par la somme réelle
 * des paiements (montant stocké sur le ticket). Le chiffre affiché porte donc
 * une mention « indicatif » dans l'UI.
 */
export const TARIF_REFERENCE_EUR: Record<TicketType, number> = {
  collectif: 20,
  particulier: 60,
};

// ============================================================================
// Types exposés à l'UI admin
// ============================================================================

/** KPIs de la vue d'ensemble. */
export interface AdminKpis {
  /** Réservations confirmées à venir (starts_at >= maintenant). */
  resaAVenir: number;
  /** Réservations confirmées dans les 7 prochains jours. */
  resaCetteSemaine: number;
  /** Réservations confirmées dans le mois calendaire en cours. */
  resaCeMois: number;
  /** Nombre total de clients (lignes `profiles`). */
  clientsTotal: number;
  /** Clients créés depuis le 1er du mois en cours. */
  clientsNouveauxCeMois: number;
  /** Nombre total de tickets (séances) vendus = somme des `quantite_initiale`. */
  ticketsVendus: number;
  /** Détail des tickets vendus par type (séances). */
  ticketsParType: Record<TicketType, number>;
  /** CA indicatif (€) = Σ quantite_initiale × tarif de référence du type. */
  caIndicatifEur: number;
}

/** Un inscrit sur un créneau (vue Alice : qui vient). */
export interface InscritCreneau {
  bookingId: string;
  userId: string;
  nom: string;
  email: string;
}

/** Un créneau à venir enrichi de la liste nominative de ses inscrits. */
export interface CreneauAvecInscrits extends Creneau {
  inscritsListe: InscritCreneau[];
}

/** Une ligne de l'historique « réservations récentes ». */
export interface ReservationRecente {
  id: string;
  nom: string;
  email: string;
  type: TicketType;
  /** ISO 8601 — début de la séance réservée. */
  startsAt: string;
  status: Booking["status"];
  /** ISO 8601 — quand la réservation a été faite. */
  createdAt: string;
}

/** Données complètes consommées par la page `/admin`. */
export interface AdminDashboardData {
  kpis: AdminKpis;
  creneaux: CreneauAvecInscrits[];
  reservationsRecentes: ReservationRecente[];
}

// ============================================================================
// Helpers internes
// ============================================================================

/** Profil minimal d'un client (pour résoudre nom/email par user_id). */
interface ProfilLite {
  id: string;
  full_name: string | null;
  email: string | null;
}

/** Construit une map user_id → profil pour résoudre les noms en O(1). */
function indexerProfils(profils: ProfilLite[]): Map<string, ProfilLite> {
  const map = new Map<string, ProfilLite>();
  for (const p of profils) map.set(p.id, p);
  return map;
}

/** Libellé d'affichage d'un client : nom complet, sinon email, sinon « — ». */
function libelleClient(profil: ProfilLite | undefined): {
  nom: string;
  email: string;
} {
  const email = profil?.email ?? "";
  const nom = profil?.full_name?.trim() || email || "Client inconnu";
  return { nom, email };
}

/** Premier jour du mois calendaire courant, à minuit (heure locale serveur). */
function debutDuMois(maintenant: Date): Date {
  return new Date(maintenant.getFullYear(), maintenant.getMonth(), 1);
}

// ============================================================================
// Agrégation principale
// ============================================================================

/**
 * Charge et agrège toutes les données du dashboard en parallèle.
 *
 * Tolérance aux pannes : Google Calendar peut être momentanément indisponible
 * ou non configuré (clé SA absente en dev). Dans ce cas on dégrade
 * proprement — la liste des créneaux est vide mais les KPIs/réservations
 * (issus de Supabase) restent affichés. On ne fait pas planter tout le
 * dashboard pour une dépendance secondaire.
 */
export async function chargerDashboard(
  maintenant: Date = new Date(),
): Promise<AdminDashboardData> {
  const supabase = createServiceClient();
  const nowIso = maintenant.toISOString();
  const debutMoisIso = debutDuMois(maintenant).toISOString();
  const dans7joursIso = new Date(
    maintenant.getTime() + 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  // --- Lectures Supabase (service_role, bypass RLS) -----------------------
  const [
    profilsRes,
    bookingsConfirmesAVenirRes,
    bookingsRecentesRes,
    ticketsRes,
    creneauxRes,
  ] = await Promise.all([
    // Tous les profils (clients).
    supabase
      .from("profiles")
      .select("id, full_name, email, created_at"),
    // Réservations confirmées à venir (pour KPIs + remplissage créneaux).
    supabase
      .from("bookings")
      .select(
        "id, user_id, type, google_calendar_creneau_id, starts_at, status",
      )
      .eq("status", "confirmed")
      .gte("starts_at", nowIso),
    // Historique récent (confirmées + annulées), 30 dernières par date de résa.
    supabase
      .from("bookings")
      .select("id, user_id, type, starts_at, status, created_at")
      .order("created_at", { ascending: false })
      .limit(30),
    // Tous les tickets vendus (pour CA indicatif + compteur séances).
    supabase.from("tickets").select("type, quantite_initiale"),
    // Créneaux Google Calendar à venir (events posés par Alice). Dégradé si KO.
    chargerCreneauxGoogle(maintenant),
  ]);

  const profils: ProfilLite[] = (profilsRes.data ?? []).map((p) => ({
    id: p.id as string,
    full_name: (p.full_name as string | null) ?? null,
    email: (p.email as string | null) ?? null,
  }));
  const profilsParId = indexerProfils(profils);

  // --- KPIs : réservations -----------------------------------------------
  const bookingsAVenir = (bookingsConfirmesAVenirRes.data ?? []) as Array<{
    id: string;
    user_id: string;
    type: TicketType;
    google_calendar_creneau_id: string | null;
    starts_at: string;
    status: Booking["status"];
  }>;

  const resaAVenir = bookingsAVenir.length;
  const resaCetteSemaine = bookingsAVenir.filter(
    (b) => b.starts_at < dans7joursIso,
  ).length;
  const resaCeMois = bookingsAVenir.filter(
    (b) => b.starts_at < prochainDebutDeMoisIso(maintenant),
  ).length;

  // --- KPIs : clients -----------------------------------------------------
  const clientsTotal = profils.length;
  const clientsNouveauxCeMois = (profilsRes.data ?? []).filter(
    (p) => typeof p.created_at === "string" && p.created_at >= debutMoisIso,
  ).length;

  // --- KPIs : tickets vendus + CA indicatif -------------------------------
  const tickets = (ticketsRes.data ?? []) as Array<{
    type: TicketType;
    quantite_initiale: number;
  }>;
  const ticketsParType: Record<TicketType, number> = {
    collectif: 0,
    particulier: 0,
  };
  let ticketsVendus = 0;
  let caIndicatifEur = 0;
  for (const t of tickets) {
    const type: TicketType = t.type === "particulier" ? "particulier" : "collectif";
    const q = Number(t.quantite_initiale) || 0;
    ticketsParType[type] += q;
    ticketsVendus += q;
    caIndicatifEur += q * TARIF_REFERENCE_EUR[type];
  }

  const kpis: AdminKpis = {
    resaAVenir,
    resaCetteSemaine,
    resaCeMois,
    clientsTotal,
    clientsNouveauxCeMois,
    ticketsVendus,
    ticketsParType,
    caIndicatifEur,
  };

  // --- Créneaux à venir + inscrits nominatifs -----------------------------
  // On groupe les bookings confirmés à venir par créneau source.
  const inscritsParCreneau = new Map<string, InscritCreneau[]>();
  for (const b of bookingsAVenir) {
    const creneauId = b.google_calendar_creneau_id;
    if (!creneauId) continue; // particuliers : pas rattachés à un créneau collectif.
    const { nom, email } = libelleClient(profilsParId.get(b.user_id));
    const liste = inscritsParCreneau.get(creneauId) ?? [];
    liste.push({ bookingId: b.id, userId: b.user_id, nom, email });
    inscritsParCreneau.set(creneauId, liste);
  }

  const creneaux: CreneauAvecInscrits[] = creneauxRes
    .map((event) => {
      const inscritsListe = inscritsParCreneau.get(event.id ?? "") ?? [];
      // `eventVersCreneau` filtre les events annulés / sans bornes (renvoie null).
      const creneau = eventVersCreneau(event, inscritsListe.length);
      if (!creneau) return null;
      return { ...creneau, inscritsListe };
    })
    .filter((c): c is CreneauAvecInscrits => c !== null);

  // --- Réservations récentes ---------------------------------------------
  const reservationsRecentes: ReservationRecente[] = (
    (bookingsRecentesRes.data ?? []) as Array<{
      id: string;
      user_id: string;
      type: TicketType;
      starts_at: string;
      status: Booking["status"];
      created_at: string;
    }>
  ).map((b) => {
    const { nom, email } = libelleClient(profilsParId.get(b.user_id));
    return {
      id: b.id,
      nom,
      email,
      type: b.type === "particulier" ? "particulier" : "collectif",
      startsAt: b.starts_at,
      status: b.status,
      createdAt: b.created_at,
    };
  });

  return { kpis, creneaux, reservationsRecentes };
}

/**
 * Charge les events Google Calendar à venir, en tolérant l'échec.
 * Renvoie `[]` si la dépendance est indisponible (clé absente, réseau, quota) :
 * le dashboard reste utilisable sur les données Supabase.
 */
async function chargerCreneauxGoogle(maintenant: Date) {
  try {
    const { timeMin, timeMax } = fenetreCreneaux(maintenant);
    return await listEvents({ timeMin, timeMax, maxResults: 250 });
  } catch (err) {
    // On log côté serveur pour diagnostic, sans casser la page.
    console.error("[admin-data] listEvents indisponible :", err);
    return [];
  }
}

/** ISO du 1er jour du mois SUIVANT (borne haute exclusive du « ce mois »). */
function prochainDebutDeMoisIso(maintenant: Date): string {
  return new Date(
    maintenant.getFullYear(),
    maintenant.getMonth() + 1,
    1,
  ).toISOString();
}
