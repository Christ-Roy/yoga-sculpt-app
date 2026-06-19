/**
 * Enrichissement du LIEU réel d'une réservation depuis Google Calendar.
 *
 * La source de vérité du lieu d'un cours est le champ `location` de l'event
 * Google d'Alice (cf. `src/lib/reservation.ts` `Creneau.lieu`). Les écrans qui
 * listent les séances d'un user (`/espace`, `/espace/reservations`) ne stockent
 * PAS le lieu en base : ils doivent le RELIRE depuis Google par `google_event_id`.
 *
 * Ce helper fait UN SEUL `listEvents` sur la fenêtre des séances à venir, puis
 * mappe chaque booking sur son event (`google_event_id`) pour en extraire le
 * `location`. Pour un cours :
 *   - COLLECTIF  → `google_event_id` = l'event partagé posé par Alice ;
 *   - PARTICULIER → `google_event_id` = l'event créé à la réservation ;
 * dans les DEUX cas `google_event_id` porte le champ « Lieu » saisi côté Google.
 *
 * Tolère l'indisponibilité de Google : si `listEvents` échoue, on renvoie un lieu
 * `undefined` pour toutes les séances → l'UI (`LieuMaps`) affiche « Lieu à
 * confirmer » plutôt qu'un lieu potentiellement faux. On n'invente JAMAIS d'adresse.
 *
 * RUNTIME — Cloudflare Workers (edge) : Supabase REST + Google Calendar REST.
 */

import { listEvents } from "@/lib/google-calendar";
import { fenetreCreneaux } from "@/lib/reservation";

/** Sous-ensemble d'un booking nécessaire à la résolution du lieu. */
interface BookingLieuInput {
  /** Id de l'event Google porteur du champ « Lieu ». */
  google_event_id: string;
  /** Début de la séance (ISO) — sert à borner la fenêtre `listEvents`. */
  starts_at: string;
}

/**
 * Résout le lieu Google (`location`) de plusieurs bookings en UN appel.
 *
 * @param bookings les séances à enrichir (au moins `google_event_id` + `starts_at`).
 * @param maintenant instant de référence (injectable pour les tests).
 * @returns une Map `google_event_id` → lieu (`string` non vide), bornée aux events
 *          retrouvés ET dont le champ « Lieu » est renseigné. Un event absent de la
 *          Map (Google KO, hors fenêtre, ou lieu vide) ⇒ lieu inconnu côté appelant.
 */
export async function resoudreLieuxParEvent(
  bookings: BookingLieuInput[],
  maintenant: Date = new Date(),
): Promise<Map<string, string>> {
  const lieuxParEvent = new Map<string, string>();
  if (bookings.length === 0) return lieuxParEvent;

  // Fenêtre de listing : de maintenant jusqu'à l'horizon par défaut, étendue si
  // jamais une séance dépasse (les séances à venir sont triées, mais on borne
  // proprement sur la plus lointaine pour ne rater aucun event).
  const { timeMin, timeMax } = fenetreCreneaux(maintenant);
  const finMax = bookings.reduce((max, b) => {
    const t = b.starts_at;
    return t > max ? t : max;
  }, timeMax);

  let events;
  try {
    // +1 jour de marge sur la borne haute pour inclure l'event d'une séance qui
    // démarre pile à `finMax` (timeMax est exclusif sur le début côté Google).
    const timeMaxAvecMarge = new Date(
      new Date(finMax).getTime() + 24 * 60 * 60 * 1000,
    ).toISOString();
    events = await listEvents({
      timeMin,
      timeMax: timeMaxAvecMarge,
      maxResults: 250,
    });
  } catch (err) {
    // Google indisponible : lieu inconnu pour toutes les séances (UI → « à
    // confirmer »). On ne casse pas l'affichage des séances pour autant.
    console.error("[booking-lieu] listEvents indisponible :", err);
    return lieuxParEvent;
  }

  for (const ev of events) {
    if (!ev.id) continue;
    const lieu = ev.location?.trim();
    if (lieu) lieuxParEvent.set(ev.id, lieu);
  }

  return lieuxParEvent;
}
