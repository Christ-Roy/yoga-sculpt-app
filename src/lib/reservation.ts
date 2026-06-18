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
  /**
   * Lieu du cours, repris TEL QUEL du champ `location` de l'event Google
   * Calendar d'Alice (texte libre : "Studio Bellecour, Lyon", une adresse…).
   *
   * Absent (`undefined`) si Alice n'a pas renseigné le champ « Lieu » de l'event.
   * Côté UI, on AFFICHE quand même le créneau dans ce cas (ne pas masquer un
   * cours à cause d'une saisie oubliée) mais avec la mention « Lieu à confirmer »
   * au lieu d'un lien Google Maps cliquable.
   *
   * ⚠️ Demande Robert : le lieu DEVRAIT toujours être renseigné côté Google
   * Calendar. On ne peut pas le forcer côté Google ; à Alice de remplir le champ
   * « Lieu » de chaque event. Cf. note dans `/api/creneaux`.
   */
  lieu?: string;
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

  // Lieu : on reprend le `location` Google tel quel (texte libre), en nettoyant
  // les espaces de bord. Une chaîne vide est traitée comme « absent » (undefined)
  // pour que l'UI bascule sur « Lieu à confirmer » plutôt que d'afficher un lien
  // Maps vide / une pastille creuse.
  const lieu = event.location?.trim() || undefined;

  return {
    id: event.id,
    type: deduireTypeDepuisEvent(event),
    summary: event.summary ?? "",
    starts_at,
    ends_at,
    inscrits,
    lieu,
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
// Formatage FR (PUR) — partagé UI Lot E / dashboard Lot F
// ============================================================================

/**
 * Fuseau d'affichage des créneaux. Alice et ses clientes sont à Lyon ; on rend
 * donc toujours les dates en heure de Paris quelle que soit la machine (les
 * Workers tournent en UTC). Toutes les fonctions ci-dessous passent ce TZ à
 * `Intl.DateTimeFormat` pour un rendu déterministe et correct (gère l'heure
 * d'été/hiver automatiquement).
 */
export const TZ_AFFICHAGE = "Europe/Paris";

/**
 * Clé de regroupement par jour, stable et triable (format `YYYY-MM-DD` calculé
 * dans le fuseau de Paris). Sert à grouper les créneaux par date côté UI sans
 * dépendre du fuseau du serveur.
 */
export function cleJour(iso: string, timeZone: string = TZ_AFFICHAGE): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // `en-CA` rend nativement "YYYY-MM-DD" ; on force le fuseau Paris.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * Libellé long d'une date en français, ex. "Mardi 23 juin".
 * (Pas d'année : l'horizon d'affichage est court, ~60 jours.)
 */
export function formaterDateLongueFr(
  iso: string,
  timeZone: string = TZ_AFFICHAGE,
): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const brut = new Intl.DateTimeFormat("fr-FR", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(d);
  // Majuscule initiale ("mardi 23 juin" → "Mardi 23 juin").
  return brut.charAt(0).toUpperCase() + brut.slice(1);
}

/** Heure d'une borne au format FR `19h00`. */
export function formaterHeureFr(
  iso: string,
  timeZone: string = TZ_AFFICHAGE,
): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // `fr-FR` rend "19:00" ; on remplace le ":" par "h" (convention FR créneaux).
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(d)
    .replace(":", "h");
}

/** Plage horaire d'un créneau, ex. "19h00 — 20h00". */
export function formaterPlageFr(
  startIso: string,
  endIso: string,
  timeZone: string = TZ_AFFICHAGE,
): string {
  return `${formaterHeureFr(startIso, timeZone)} — ${formaterHeureFr(endIso, timeZone)}`;
}

/** Libellé FR du type de cours (affichage badge / titre). */
export function libelleType(type: TicketType): string {
  return type === "particulier" ? "Cours particulier" : "Cours collectif";
}

/**
 * Vrai si le créneau démarre dans moins de `heures` heures par rapport à
 * `maintenant`. Sert au garde-fou UI d'annulation (règle des 24h).
 */
export function dansMoinsDe(
  startIso: string,
  heures: number,
  maintenant: Date = new Date(),
): boolean {
  const start = new Date(startIso).getTime();
  if (Number.isNaN(start)) return false;
  return start - maintenant.getTime() < heures * 60 * 60 * 1000;
}

/** Délai minimal (en heures) avant le créneau pour pouvoir annuler. */
export const DELAI_ANNULATION_HEURES = 24;

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
