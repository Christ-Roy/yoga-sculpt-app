import { createClient } from "@/lib/supabase/server";
import { getEvent } from "@/lib/google-calendar";
import type { Booking } from "@/lib/db-types";
import { libelleType } from "@/lib/reservation";
import { buildIcs, icsFileName, type SeanceAgenda } from "@/lib/calendar-export";
import { createLogger } from "@/lib/log";

const log = createLogger("ics");

/**
 * GET /api/ics/[bookingId] — télécharge le fichier .ics d'une réservation.
 *
 * CHOIX D'ARCHITECTURE (demandé : « .ics côté client OU via une route ; choisis
 * le plus propre et documente »). On retient la ROUTE serveur :
 *   - le contenu est dynamique (titre, dates, lieu d'un booking précis) et c'est
 *     plus robuste qu'un Blob client (encodage CRLF, échappement RFC 5545,
 *     enrichissement éventuel du titre depuis Google) ;
 *   - la route VÉRIFIE L'APPARTENANCE via RLS : le client Supabase user-scopé ne
 *     renvoie le booking que s'il appartient au user connecté → un id deviné
 *     d'un autre user renvoie 404, pas de fuite ;
 *   - le navigateur déclenche le téléchargement grâce à `Content-Disposition`.
 *
 * Le .ics embarque DEUX VALARM (J-1 et H-2) — c'est le seul moyen d'imposer des
 * rappels (le lien Google Agenda, lui, applique les rappels par défaut du user).
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ RUNTIME — Cloudflare Workers (edge). Génération pure + 1 lecture PostgREST.│
 * └─────────────────────────────────────────────────────────────────────────┘
 */

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  const { bookingId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response("Authentification requise.", { status: 401 });
  }

  // Lecture user-scopée : la RLS (`bookings_select_own`) garantit que seul le
  // propriétaire récupère la ligne. id d'un autre user → 0 ligne → 404.
  const { data: row, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", bookingId)
    .eq("status", "confirmed")
    .maybeSingle();

  if (error) {
    log.error("Lecture booking échouée", { db: error.message });
    return new Response("Erreur serveur.", { status: 500 });
  }
  if (!row) {
    return new Response("Réservation introuvable.", { status: 404 });
  }

  const booking = row as Booking;

  // Titre + lieu : on part du type, et on enrichit best-effort depuis l'event
  // Google (si encore présent) — `summary` pour le titre, `location` pour le
  // VRAI lieu (champ « Lieu » saisi par Alice). Un échec Google ne casse PAS le
  // téléchargement, et on n'invente AUCUNE adresse (lieu absent si non saisi).
  let titre = `${libelleType(booking.type)} — Yoga Sculpt`;
  let lieu: string | undefined;
  try {
    const event = await getEvent(booking.google_event_id);
    if (event.summary && event.summary.trim()) {
      titre = event.summary.trim();
    }
    if (event.location && event.location.trim()) {
      lieu = event.location.trim();
    }
  } catch {
    // On garde le titre dérivé du type, lieu absent — silencieux par design.
  }

  const seance: SeanceAgenda = {
    id: booking.id,
    titre,
    starts_at: booking.starts_at,
    ends_at: booking.ends_at,
    // Vrai lieu Google (ou absent → ni LOCATION dans le .ics, ni invention).
    lieu,
    description: "Séance Yoga Sculpt avec Alice Gaudry.",
  };

  const ics = buildIcs(seance);

  return new Response(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${icsFileName(seance)}"`,
      // Contenu privé, lié au user : pas de cache partagé.
      "Cache-Control": "private, no-store",
    },
  });
}
