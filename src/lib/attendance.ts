/**
 * Émission idempotente des events `booking_attended` (séances réellement passées).
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ DEUX MÉCANIQUES, RÔLES DISTINCTS — ne pas confondre.                      │
 * │                                                                           │
 * │ 1. COMPTEUR « nb_seances_passees » → dérivé DIRECTEMENT de `bookings`     │
 * │    (vue SQL v_user_signals : status='confirmed' AND starts_at < now).     │
 * │    C'est le nombre FIABLE pour le pilotage : il ne dépend PAS de ce cron   │
 * │    (même si le cron n'a jamais tourné, le compteur est juste).            │
 * │                                                                           │
 * │ 2. EVENT « booking_attended » dans le journal → émis ICI, par le cron,    │
 * │    pour enrichir la TIMELINE (horodatage du moment où la séance est        │
 * │    passée). Idempotent via la colonne `bookings.attended_event_at` :      │
 * │    une séance n'émet qu'UNE fois l'event, quel que soit le nb de ticks.   │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Best-effort : ne lève jamais. Agrège un compteur d'émissions / erreurs renvoyé
 * à la route cron pour le log.
 *
 * RUNTIME — Cloudflare Workers (edge) : Supabase fetch only. Aucune dep Node.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { logEvent } from "@/lib/events";
import { createLogger } from "@/lib/log";

const log = createLogger("attendance");

/** Résultat agrégé d'un passage d'attendance. */
export interface ResultatAttendance {
  /** Nb d'events booking_attended émis (séances nouvellement marquées). */
  marquees: number;
  /** Nb d'erreurs (émission ou marquage). */
  erreurs: number;
}

/**
 * Plafond de séances traitées par tick. Le cron tourne toutes les 15 min : ce
 * plafond évite qu'un (improbable) très gros backlog ne fasse exploser un tick.
 * Le reliquat sera traité aux ticks suivants (la sélection est ordonnée).
 */
const LOT_MAX = 200;

/**
 * Scanne les réservations CONFIRMÉES dont le créneau est passé et qui n'ont pas
 * encore émis leur event `booking_attended`, émet l'event, puis horodate
 * `attended_event_at` (idempotence). À appeler depuis la route cron.
 */
export async function markPastBookingsAttended(
  now: Date = new Date(),
): Promise<ResultatAttendance> {
  const service = createServiceClient();
  const nowIso = now.toISOString();

  // Séances passées, confirmées, jamais marquées. On borne par LOT_MAX et on
  // ordonne par starts_at pour traiter les plus anciennes d'abord.
  const { data, error } = await service
    .from("bookings")
    .select("id, user_id, type, starts_at, google_calendar_creneau_id")
    .eq("status", "confirmed")
    .lt("starts_at", nowIso)
    .is("attended_event_at", null)
    .order("starts_at", { ascending: true })
    .limit(LOT_MAX);

  if (error) {
    log.error("Scan des séances passées échoué", { db: error.message });
    return { marquees: 0, erreurs: 1 };
  }

  const bookings = (data ?? []) as Array<{
    id: string;
    user_id: string;
    type: string;
    starts_at: string;
    google_calendar_creneau_id: string | null;
  }>;
  if (bookings.length === 0) return { marquees: 0, erreurs: 0 };

  let marquees = 0;
  let erreurs = 0;

  for (const b of bookings) {
    // On marque AVANT d'émettre, sous garde `attended_event_at is null` : si un
    // tick concurrent a déjà pris cette ligne, 0 ligne touchée → on saute (pas
    // de double event). On ne ré-émet donc l'event que si on a gagné le marquage.
    const stamp = new Date().toISOString();
    const { data: claimed, error: claimErr } = await service
      .from("bookings")
      .update({ attended_event_at: stamp })
      .eq("id", b.id)
      .is("attended_event_at", null)
      .select("id")
      .maybeSingle();

    if (claimErr) {
      log.error("Marquage attended_event_at échoué", {
        booking_id: b.id,
        db: claimErr.message,
      });
      erreurs += 1;
      continue;
    }
    if (!claimed) {
      // Un autre tick a déjà marqué cette séance → rien à faire.
      continue;
    }

    const ok = await logEvent(
      b.user_id,
      "booking_attended",
      {
        booking_id: b.id,
        type: b.type,
        creneau_id: b.google_calendar_creneau_id,
        starts_at: b.starts_at,
      },
      { source: "cron", service },
    );

    if (ok) {
      marquees += 1;
    } else {
      // L'event n'a pas pu être écrit alors qu'on a déjà posé le marqueur :
      // l'event est perdu mais le COMPTEUR (dérivé de bookings) reste juste.
      // On le signale, sans rollback (rollback ré-ouvrirait la course).
      log.error(
        "booking_attended non journalisé (marqueur posé, event perdu — compteur dérivé reste correct)",
        { booking_id: b.id },
      );
      erreurs += 1;
    }
  }

  return { marquees, erreurs };
}
