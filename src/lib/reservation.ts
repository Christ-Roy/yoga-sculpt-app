/**
 * Moteur de réservation maison — logique métier PURE & partagée.
 *
 * Ce module ne fait AUCUN I/O (pas de fetch Google, pas de requête Supabase).
 * Il regroupe les fonctions pures + typées réutilisées par :
 *   - les routes API du Lot D (`/api/creneaux`, `/api/reserver`, `/api/annuler`),
 *   - le Lot E (UI espace client) et le Lot F (dashboard Alice).
 *
 * On y centralise :
 *   - la déduction du `type` de cours depuis un event Google,
 *   - le mapping `GoogleCalendarEvent` → `Creneau` (forme exposée au client),
 *   - les helpers de borne temporelle (extraction de l'ISO de début/fin),
 *   - l'ajout idempotent d'un attendee à la liste d'un event.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ RUNTIME — Cloudflare Workers (edge). Code 100 % pur, zéro dépendance.     │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import type {
  GoogleCalendarAttendee,
  GoogleCalendarEvent,
} from "@/lib/google-calendar";
import type { TicketType } from "@/lib/db-types";

// ============================================================================
// Convention de typage des créneaux (collectif vs particulier)
// ============================================================================

/**
 * MODÈLE MÉTIER V1 (décidé par Robert) — pas de quota de places automatique.
 *
 * Alice gère la capacité À LA MAIN : elle pose / retire / ferme les créneaux
 * dans SON Google Agenda. Un créneau est réservable tant qu'il existe dans le
 * calendrier ; on n'en calcule donc PAS les "places restantes" pour bloquer,
 * on affiche seulement le nombre d'inscrits (informatif).
 *
 * CONVENTION DE TYPE — comme tous les créneaux vivent dans le même calendrier,
 * on distingue cours particulier / collectif via le TEXTE de l'event :
 *   → si le `summary` OU la `description` contient le mot "particulier"
 *     (insensible à la casse / aux accents) → type 'particulier' ;
 *   → sinon → type 'collectif' (défaut).
 *
 * Alice n'a donc qu'à nommer ses events particuliers en y mettant le mot
 * "particulier" (ex : "Cours particulier — Yoga Sculpt"). Tout le reste est
 * traité comme collectif.
 */
export function deduireTypeDepuisEvent(event: GoogleCalendarEvent): TicketType {
  const texte = `${event.summary ?? ""} ${event.description ?? ""}`;
  // Normalisation : minuscules + suppression des diacritiques pour tolérer
  // "Particulier", "particulier", etc. (le mot ne contient pas d'accent, mais
  // on normalise par robustesse et cohérence d'intention).
  const normalise = texte
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  return normalise.includes("particulier") ? "particulier" : "collectif";
}

// ============================================================================
// Bornes temporelles
// ============================================================================

/**
 * Extrait l'instant ISO 8601 d'une borne d'event Google.
 *
 * Un event Google a soit `dateTime` (RFC3339 avec heure), soit `date` (journée
 * entière "YYYY-MM-DD"). On renvoie l'ISO exploitable côté DB (`timestamptz`).
 * Pour une journée entière, on renvoie minuit ISO basé sur la date.
 *
 * @returns l'ISO, ou `null` si la borne est absente / inexploitable.
 */
export function bornEventToIso(
  borne: GoogleCalendarEvent["start"] | GoogleCalendarEvent["end"],
): string | null {
  if (!borne) return null;
  if (borne.dateTime) return borne.dateTime;
  if (borne.date) {
    // Journée entière : on ancre à minuit. `Date` parse "YYYY-MM-DD" en UTC ;
    // on renvoie l'ISO résultant (suffisant pour stocker un timestamptz).
    const d = new Date(borne.date);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

// ============================================================================
// Mapping event → créneau exposé au client
// ============================================================================

/**
 * Forme d'un créneau telle qu'exposée par `GET /api/creneaux` (et consommée
 * par l'UID Lot E). `inscrits` est purement informatif (Alice gère le plein).
 */
export interface Creneau {
  /** Id de l'event Google (= identifiant à passer à `/api/reserver`). */
  id: string;
  /** Type déduit du titre/description. */
  type: TicketType;
  /** Titre de l'event (peut être vide côté Google → chaîne vide). */
  summary: string;
  /** Début (ISO 8601). */
  starts_at: string;
  /** Fin (ISO 8601). */
  ends_at: string;
  /** Nombre de réservations confirmées sur ce créneau (informatif). */
  inscrits: number;
}

/**
 * Convertit un event Google en `Creneau` exposable.
 *
 * @param event    l'event Google (doit avoir un `id` et des bornes valides).
 * @param inscrits le nombre de bookings confirmés sur ce créneau (calculé en amont).
 * @returns le créneau, ou `null` si l'event est inexploitable (pas d'id / pas de
 *          bornes / annulé) — l'appelant filtre alors les `null`.
 */
export function eventVersCreneau(
  event: GoogleCalendarEvent,
  inscrits: number,
): Creneau | null {
  // On n'expose JAMAIS un event annulé côté Google.
  if (event.status === "cancelled") return null;
  if (!event.id) return null;

  const starts_at = bornEventToIso(event.start);
  const ends_at = bornEventToIso(event.end);
  if (!starts_at || !ends_at) return null;

  return {
    id: event.id,
    type: deduireTypeDepuisEvent(event),
    summary: event.summary ?? "",
    starts_at,
    ends_at,
    inscrits,
  };
}

// ============================================================================
// Attendees
// ============================================================================

/**
 * Ajoute (de façon idempotente) un attendee à la liste d'attendees d'un event.
 *
 * Sert à inscrire le user sur le créneau collectif partagé : on PATCH l'event
 * d'Alice en lui ajoutant le user comme participant. Si le user y figure déjà
 * (même email, casse ignorée), on renvoie la liste inchangée — pas de doublon.
 *
 * @returns la nouvelle liste d'attendees (à passer tel quel à `patchEvent`).
 */
export function ajouterAttendee(
  attendeesExistants: GoogleCalendarAttendee[] | undefined,
  attendee: GoogleCalendarAttendee,
): GoogleCalendarAttendee[] {
  const liste = attendeesExistants ? [...attendeesExistants] : [];
  const emailCible = attendee.email.trim().toLowerCase();
  const dejaPresent = liste.some(
    (a) => (a.email ?? "").trim().toLowerCase() === emailCible,
  );
  if (dejaPresent) return liste;
  liste.push(attendee);
  return liste;
}

/**
 * Retire un attendee (par email, casse ignorée) de la liste d'attendees.
 * Sert à désinscrire le user du créneau à l'annulation.
 *
 * @returns la nouvelle liste d'attendees, sans le participant ciblé.
 */
export function retirerAttendee(
  attendeesExistants: GoogleCalendarAttendee[] | undefined,
  email: string,
): GoogleCalendarAttendee[] {
  if (!attendeesExistants) return [];
  const emailCible = email.trim().toLowerCase();
  return attendeesExistants.filter(
    (a) => (a.email ?? "").trim().toLowerCase() !== emailCible,
  );
}

// ============================================================================
// Fenêtre de listing des créneaux
// ============================================================================

/** Horizon par défaut d'affichage des créneaux futurs : ~60 jours. */
export const CRENEAUX_HORIZON_JOURS = 60;

/**
 * Calcule la fenêtre temporelle (timeMin/timeMax ISO) pour lister les créneaux
 * futurs, depuis `maintenant` jusqu'à `maintenant + horizon`.
 */
export function fenetreCreneaux(
  maintenant: Date = new Date(),
  horizonJours: number = CRENEAUX_HORIZON_JOURS,
): { timeMin: string; timeMax: string } {
  const timeMin = maintenant.toISOString();
  const fin = new Date(maintenant.getTime() + horizonJours * 24 * 60 * 60 * 1000);
  return { timeMin, timeMax: fin.toISOString() };
}
