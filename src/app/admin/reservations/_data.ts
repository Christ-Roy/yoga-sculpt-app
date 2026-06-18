/**
 * Couche DONNÉES du back-office « Gestion des réservations » (`/admin/reservations`).
 *
 * Lectures via le client `service_role` (bypass RLS) : Alice voit TOUTES les
 * réservations (de toutes les clientes), enrichies du profil client (nom / email
 * / téléphone) et, quand c'est disponible, du libellé + lieu du créneau Google.
 *
 * Module STRICTEMENT serveur (importe `createServiceClient`, clé secrète) →
 * ne JAMAIS l'importer dans un composant client. La page qui l'appelle est un
 * Server Component.
 *
 * RUNTIME — Cloudflare Workers (edge) : Supabase REST + Google Calendar REST.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { listEvents } from "@/lib/google-calendar";
import { deduireTypeDepuisEvent, fenetreCreneaux } from "@/lib/reservation";
import type { BookingStatus, TicketType } from "@/lib/db-types";
import type { AttendanceValue } from "@/app/api/admin/bookings/_logic";

// ============================================================================
// Types exposés à l'UI
// ============================================================================

/** Présence telle qu'affichée (null persistant → 'pending' côté UI). */
export type AttendanceUi = AttendanceValue | "pending";

/** Une réservation enrichie pour le back-office. */
export interface ReservationAdmin {
  id: string;
  userId: string;
  /** Nom du client (full_name, sinon email, sinon « Client inconnu »). */
  nom: string;
  email: string;
  /** Téléphone du client (profiles.phone), si renseigné. */
  telephone: string | null;
  type: TicketType;
  status: BookingStatus;
  /** ISO 8601 — début de la séance. */
  startsAt: string;
  /** ISO 8601 — fin de la séance. */
  endsAt: string;
  /** ISO 8601 — date de réservation. */
  createdAt: string;
  /** ISO 8601 — date d'annulation (si annulée). */
  cancelledAt: string | null;
  /** Présence : 'attended' | 'no_show' | 'pending' (non renseigné). */
  attendance: AttendanceUi;
  /** Id du créneau Google source (null pour un particulier). */
  creneauId: string | null;
  /** Titre du créneau (summary Google), si résolu. */
  creneauTitre: string | null;
  /** Lieu du créneau (location Google), si résolu. */
  creneauLieu: string | null;
}

/** Un créneau Google à venir (cible possible pour un déplacement). */
export interface CreneauCible {
  id: string;
  type: TicketType;
  summary: string;
  startsAt: string;
  endsAt: string;
  lieu: string | null;
}

/** Données complètes consommées par la page `/admin/reservations`. */
export interface ReservationsAdminData {
  reservations: ReservationAdmin[];
  /** Créneaux Google à venir (pour le sélecteur de déplacement). */
  creneauxCibles: CreneauCible[];
}

// ============================================================================
// Helpers internes
// ============================================================================

interface ProfilLite {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
}

interface BookingRow {
  id: string;
  user_id: string;
  type: TicketType;
  status: BookingStatus;
  google_event_id: string;
  google_calendar_creneau_id: string | null;
  starts_at: string;
  ends_at: string;
  created_at: string;
  cancelled_at: string | null;
  attendance: AttendanceValue | null;
}

interface CreneauMeta {
  summary: string | null;
  lieu: string | null;
}

/** Normalise une valeur `type` douteuse vers un TicketType strict. */
function normType(t: unknown): TicketType {
  return t === "particulier" ? "particulier" : "collectif";
}

/** Libellé d'affichage d'un client : nom complet, sinon email, sinon « — ». */
function libelleClient(profil: ProfilLite | undefined): {
  nom: string;
  email: string;
  telephone: string | null;
} {
  const email = profil?.email ?? "";
  const nom = profil?.full_name?.trim() || email || "Client inconnu";
  return { nom, email, telephone: profil?.phone ?? null };
}

// ============================================================================
// Chargement principal
// ============================================================================

/**
 * Charge TOUTES les réservations (toutes clientes confondues) + les créneaux
 * Google à venir (cibles de déplacement). Tolère l'indisponibilité Google :
 * dans ce cas les créneaux cibles sont vides et les libellés/lieux restent null,
 * mais les réservations (issues de Supabase) restent affichées.
 */
export async function chargerReservationsAdmin(
  maintenant: Date = new Date(),
): Promise<ReservationsAdminData> {
  const service = createServiceClient();

  const [profilsRes, bookingsRes, eventsCibles] = await Promise.all([
    service.from("profiles").select("id, full_name, email, phone"),
    // Toutes les réservations, plus récentes d'abord (par date de séance).
    service
      .from("bookings")
      .select(
        "id, user_id, type, status, google_event_id, google_calendar_creneau_id, starts_at, ends_at, created_at, cancelled_at, attendance",
      )
      .order("starts_at", { ascending: false }),
    chargerCreneauxGoogle(maintenant),
  ]);

  const profilsParId = new Map<string, ProfilLite>();
  for (const p of (profilsRes.data ?? []) as Array<Record<string, unknown>>) {
    profilsParId.set(p.id as string, {
      id: p.id as string,
      full_name: (p.full_name as string | null) ?? null,
      email: (p.email as string | null) ?? null,
      phone: (p.phone as string | null) ?? null,
    });
  }

  // Index des métadonnées de créneau (par event id) issues de Google, pour
  // enrichir CHAQUE booking de son titre/lieu (y compris les passés/annulés
  // qui ne sont pas dans la fenêtre future). On ré-indexe ce qu'on a chargé.
  const metaParEvent = new Map<string, CreneauMeta>();
  for (const ev of eventsCibles) {
    if (!ev.id) continue;
    metaParEvent.set(ev.id, {
      summary: ev.summary ?? null,
      lieu: ev.location?.trim() || null,
    });
  }

  const reservations: ReservationAdmin[] = (
    (bookingsRes.data ?? []) as BookingRow[]
  ).map((b) => {
    const { nom, email, telephone } = libelleClient(profilsParId.get(b.user_id));
    const meta = b.google_calendar_creneau_id
      ? metaParEvent.get(b.google_calendar_creneau_id)
      : undefined;
    return {
      id: b.id,
      userId: b.user_id,
      nom,
      email,
      telephone,
      type: normType(b.type),
      status: b.status === "cancelled" ? "cancelled" : "confirmed",
      startsAt: b.starts_at,
      endsAt: b.ends_at,
      createdAt: b.created_at,
      cancelledAt: b.cancelled_at,
      attendance: b.attendance ?? "pending",
      creneauId: b.google_calendar_creneau_id,
      creneauTitre: meta?.summary ?? null,
      creneauLieu: meta?.lieu ?? null,
    };
  });

  const creneauxCibles: CreneauCible[] = eventsCibles
    .filter((ev) => ev.id && ev.status !== "cancelled")
    .map((ev) => {
      const startsAt = ev.start?.dateTime ?? ev.start?.date ?? null;
      const endsAt = ev.end?.dateTime ?? ev.end?.date ?? null;
      if (!startsAt || !endsAt) return null;
      return {
        id: ev.id as string,
        type: deduireTypeDepuisEvent(ev),
        summary: ev.summary ?? "",
        startsAt,
        endsAt,
        lieu: ev.location?.trim() || null,
      };
    })
    .filter((c): c is CreneauCible => c !== null)
    // Tri chronologique croissant pour le sélecteur.
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  return { reservations, creneauxCibles };
}

/** Charge les events Google à venir en tolérant l'échec (renvoie [] si KO). */
async function chargerCreneauxGoogle(maintenant: Date) {
  try {
    const { timeMin, timeMax } = fenetreCreneaux(maintenant);
    return await listEvents({ timeMin, timeMax, maxResults: 250 });
  } catch (err) {
    console.error("[admin/reservations] listEvents indisponible :", err);
    return [];
  }
}
