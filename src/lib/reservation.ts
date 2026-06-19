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
import type { TicketSource, TicketType } from "@/lib/db-types";

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

// ============================================================================
// Origine du ticket consommé par une réservation (payé vs offert)
// ============================================================================

/**
 * Catégorie d'affichage de la source d'un ticket, pour le back-office.
 *
 *   - `paye`    : ticket acheté (Stripe, `source = 'paid'`).
 *   - `offert`  : ticket gratuit — séance d'essai (`welcome`), parrainage
 *                 (`referral`) ou geste commercial d'Alice (`admin`).
 *   - `inconnu` : booking sans ticket rattaché (`ticket_id` null) ou ticket à
 *                 `source` null (carnets historiques d'avant la colonne 0010).
 *
 * On regroupe welcome/referral/admin sous « offert » parce que, vu d'Alice, le
 * seul axe qui compte est « est-ce que cette place a été payée ? ». Le détail
 * fin (welcome vs referral vs admin) reste disponible via `detailSourceTicket`.
 */
export type CategorieSourceTicket = "paye" | "offert" | "inconnu";

/** Détail lisible de l'origine d'un ticket (sous-libellé). */
const DETAIL_SOURCE: Record<TicketSource, string> = {
  paid: "Acheté",
  welcome: "Séance d'essai",
  referral: "Parrainage",
  admin: "Geste commercial",
};

/**
 * Classe la source d'un ticket en catégorie d'affichage (payé / offert / inconnu).
 * Pur, sans I/O — testable et réutilisable côté UI comme serveur.
 */
export function categoriserSourceTicket(
  source: TicketSource | null | undefined,
): CategorieSourceTicket {
  if (source === "paid") return "paye";
  if (source === "welcome" || source === "referral" || source === "admin") {
    return "offert";
  }
  return "inconnu";
}

/**
 * Sous-libellé fin de l'origine d'un ticket (« Parrainage », « Séance d'essai »…).
 * `null` si la source est inconnue/absente (pas de précision à afficher).
 */
export function detailSourceTicket(
  source: TicketSource | null | undefined,
): string | null {
  if (!source) return null;
  return DETAIL_SOURCE[source] ?? null;
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

// ============================================================================
// Créneau LIBRE — cours PARTICULIER (généré 9h-21h, hors indisponibilités Alice)
// ============================================================================

/**
 * MODÈLE — cours PARTICULIER en créneau LIBRE (décision Robert 2026-06-19).
 *
 * Contrairement au collectif (events pré-posés par Alice qu'on liste), le
 * particulier n'a PAS de créneaux figés : le client choisit librement une
 * date + heure entre 9h et 21h (heure de Paris), et on lui propose toute la
 * plage MOINS les heures où Alice est déjà occupée (busy lu via Google
 * Calendar freebusy). À la réservation on CRÉE l'event dans l'agenda d'Alice.
 *
 * Toute la génération ci-dessous est PURE (aucun I/O) : on passe en entrée les
 * intervalles `busy` (déjà lus par la route via `freeBusyQuery`) + `maintenant`,
 * et on renvoie la liste des slots libres. Le runtime UTC est géré proprement :
 * on calcule l'heure murale de Paris via `Intl` (gère l'heure d'été/hiver).
 */

/** Durée d'un cours particulier, en minutes. */
export const DUREE_COURS_PARTICULIER_MIN = 60;

/** Pas de génération des slots, en minutes (un slot par heure pleine). */
export const PAS_SLOT_PARTICULIER_MIN = 60;

/** Heure d'OUVERTURE (incluse) de la plage réservable, heure de Paris. */
export const PARTICULIER_HEURE_DEBUT = 9;

/**
 * Heure de FERMETURE (exclue pour un DÉBUT de cours) de la plage, heure de
 * Paris. Le dernier cours réservable démarre à 20h et finit à 21h : on borne
 * donc les DÉBUTS à `< 21h` (un cours de 60 min se terminant à 21h pile).
 */
export const PARTICULIER_HEURE_FIN = 21;

/** Délai minimal (en heures) entre maintenant et le début d'un cours réservé. */
export const DELAI_MIN_RESERVATION_HEURES = 24;

/** Horizon de génération des créneaux libres particulier : ~30 jours. */
export const PARTICULIER_HORIZON_JOURS = 30;

/** Un intervalle occupé (busy) renvoyé par l'API freebusy de Google. */
export interface IntervalleBusy {
  /** Début (ISO 8601). */
  start: string;
  /** Fin (ISO 8601). */
  end: string;
}

/** Un slot libre proposé au client pour un cours particulier. */
export interface SlotLibre {
  /** Début (ISO 8601, instant absolu). */
  starts_at: string;
  /** Fin (ISO 8601, instant absolu). */
  ends_at: string;
}

/**
 * Décompose un instant en ses composantes murales (année/mois/jour/heure/minute)
 * dans un fuseau donné. Sert à raisonner en heure de Paris depuis un Worker UTC.
 */
function partsDansFuseau(
  d: Date,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  // `hour12:false` peut rendre "24" à minuit selon l'environnement → on normalise.
  let hour = get("hour");
  if (hour === 24) hour = 0;
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour,
    minute: get("minute"),
  };
}

/**
 * Construit l'instant ABSOLU (Date) correspondant à une heure MURALE de Paris
 * un jour donné. Gère l'heure d'été/hiver : on calcule l'offset réel du fuseau
 * pour cet instant et on l'applique. Robuste car l'offset de Paris ne varie que
 * d'une heure (DST) — une seule passe de correction suffit pour nos heures
 * pleines (9h-21h, jamais dans la fenêtre ambiguë de bascule à 2h-3h du matin).
 *
 * @param annee  année (ex. 2026)
 * @param mois   mois 1-12
 * @param jour   jour du mois 1-31
 * @param heure  heure murale Paris 0-23
 * @param timeZone fuseau (défaut Europe/Paris)
 */
export function instantDepuisHeureMurale(
  annee: number,
  mois: number,
  jour: number,
  heure: number,
  timeZone: string = TZ_AFFICHAGE,
): Date {
  // 1) On part d'une supposition : l'heure murale interprétée comme si c'était
  //    de l'UTC. 2) On mesure l'écart entre ce que ce fuseau AFFICHERAIT pour
  //    cet instant et l'heure voulue, et on corrige.
  const supposeUtc = Date.UTC(annee, mois - 1, jour, heure, 0, 0, 0);
  const p = partsDansFuseau(new Date(supposeUtc), timeZone);
  const afficheUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0, 0);
  // offset = (ce que le fuseau affiche) − (l'instant supposé). Pour revenir à
  // l'heure murale voulue, on retranche cet offset de la supposition.
  const offsetMs = afficheUtc - supposeUtc;
  return new Date(supposeUtc - offsetMs);
}

/** Deux intervalles [aStart,aEnd) et [bStart,bEnd) se chevauchent-ils ? */
export function chevauche(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Génère les slots LIBRES pour un cours particulier.
 *
 * Pour chaque jour de l'horizon, produit les créneaux horaires (9h→20h début,
 * 60 min) en heure de Paris, puis ÉLAGUE :
 *   - les slots qui démarrent à moins de `DELAI_MIN_RESERVATION_HEURES` ;
 *   - les slots qui chevauchent un intervalle `busy` d'Alice.
 *
 * 100 % pur : les `busy` et `maintenant` sont injectés (la route fait l'I/O).
 *
 * @returns slots triés par début croissant.
 */
export function genererSlotsLibres(opts: {
  busy: IntervalleBusy[];
  maintenant?: Date;
  horizonJours?: number;
  timeZone?: string;
}): SlotLibre[] {
  const {
    busy,
    maintenant = new Date(),
    horizonJours = PARTICULIER_HORIZON_JOURS,
    timeZone = TZ_AFFICHAGE,
  } = opts;

  const dureeMs = DUREE_COURS_PARTICULIER_MIN * 60 * 1000;
  const delaiMs = DELAI_MIN_RESERVATION_HEURES * 60 * 60 * 1000;
  const seuilMin = maintenant.getTime() + delaiMs;

  // Normalise les busy en bornes epoch valides (ignore les intervalles cassés).
  const busyMs = busy
    .map((b) => ({
      start: new Date(b.start).getTime(),
      end: new Date(b.end).getTime(),
    }))
    .filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end) && b.end > b.start);

  const slots: SlotLibre[] = [];

  // On itère jour par jour sur l'horizon, en repartant de la date murale de
  // Paris de `maintenant` (pas de l'UTC : un cours peut être réservable « ce
  // soir » même si on est déjà le lendemain en UTC).
  const ancre = partsDansFuseau(maintenant, timeZone);
  for (let dayOffset = 0; dayOffset < horizonJours; dayOffset++) {
    // Avance de `dayOffset` jours en calant sur midi UTC (évite tout effet de
    // bord DST sur l'incrément de date) puis relit la date murale Paris.
    const baseMidi = Date.UTC(ancre.year, ancre.month - 1, ancre.day, 12, 0, 0, 0);
    const jourCourant = partsDansFuseau(
      new Date(baseMidi + dayOffset * 24 * 60 * 60 * 1000),
      timeZone,
    );

    for (
      let heure = PARTICULIER_HEURE_DEBUT;
      heure < PARTICULIER_HEURE_FIN;
      heure += PAS_SLOT_PARTICULIER_MIN / 60
    ) {
      const debut = instantDepuisHeureMurale(
        jourCourant.year,
        jourCourant.month,
        jourCourant.day,
        heure,
        timeZone,
      );
      const debutMs = debut.getTime();
      const finMs = debutMs + dureeMs;

      // Délai mini de réservation (24h) — on saute le passé proche.
      if (debutMs < seuilMin) continue;

      // Indisponibilité Alice : on saute tout slot chevauchant un busy.
      const occupe = busyMs.some((b) => chevauche(debutMs, finMs, b.start, b.end));
      if (occupe) continue;

      slots.push({
        starts_at: debut.toISOString(),
        ends_at: new Date(finMs).toISOString(),
      });
    }
  }

  // Tri chronologique (déjà quasi trié, mais on garantit l'ordre).
  slots.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return slots;
}

/**
 * Valide qu'un `startsAt` (ISO) soumis pour une réservation particulière est un
 * slot LÉGITIME : aligné sur une heure pleine de la plage 9h-21h (Paris), au
 * moins à `DELAI_MIN_RESERVATION_HEURES` dans le futur. NE vérifie PAS les busy
 * (ça, c'est le rôle du re-check freebusy côté route, source de vérité fraîche).
 *
 * @returns `{ ok: true, debut, fin }` (ISO) si valide, sinon `{ ok:false, raison }`.
 */
export function validerSlotParticulier(
  startsAt: string,
  opts: { maintenant?: Date; timeZone?: string } = {},
):
  | { ok: true; debut: string; fin: string }
  | { ok: false; raison: string } {
  const { maintenant = new Date(), timeZone = TZ_AFFICHAGE } = opts;

  const d = new Date(startsAt);
  if (Number.isNaN(d.getTime())) {
    return { ok: false, raison: "Date de créneau invalide." };
  }

  // Heure murale de Paris : doit être une heure pleine dans [9, 21[.
  const p = partsDansFuseau(d, timeZone);
  if (p.minute !== 0) {
    return { ok: false, raison: "Le créneau doit démarrer à une heure pleine." };
  }
  if (p.hour < PARTICULIER_HEURE_DEBUT || p.hour >= PARTICULIER_HEURE_FIN) {
    return {
      ok: false,
      raison: `Le créneau doit être compris entre ${PARTICULIER_HEURE_DEBUT}h et ${PARTICULIER_HEURE_FIN}h.`,
    };
  }

  // Délai mini de réservation (24h).
  const delaiMs = DELAI_MIN_RESERVATION_HEURES * 60 * 60 * 1000;
  if (d.getTime() < maintenant.getTime() + delaiMs) {
    return {
      ok: false,
      raison: `Réservation possible au plus tôt ${DELAI_MIN_RESERVATION_HEURES}h à l'avance.`,
    };
  }

  // Re-construit le slot canonique (heure pleine) pour figer début/fin exacts.
  const debut = instantDepuisHeureMurale(
    p.year,
    p.month,
    p.day,
    p.hour,
    timeZone,
  );
  const fin = new Date(
    debut.getTime() + DUREE_COURS_PARTICULIER_MIN * 60 * 1000,
  );

  return { ok: true, debut: debut.toISOString(), fin: fin.toISOString() };
}
