/**
 * Logique métier PURE de la gestion admin des créneaux (CRUD Google Calendar
 * + presets). AUCUN I/O ici (pas de fetch Google, pas de Supabase) : uniquement
 * de la validation d'inputs (zod) et la construction du corps d'event Google au
 * format que `src/lib/reservation.ts` sait RELIRE.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ CONTRAT D'INTEROPÉRABILITÉ avec /api/creneaux (reservation.ts) — CRITIQUE │
 * │                                                                           │
 * │ Un créneau écrit ici DOIT être relisible par `/api/creneaux` qui :        │
 * │   • déduit le TYPE via `deduireTypeDepuisEvent()` : 'particulier' si le   │
 * │     mot « particulier » apparaît dans `summary` OU `description` (insens.  │
 * │     casse/accents), sinon 'collectif'.                                    │
 * │   • lit le LIEU via `eventVersCreneau()` = champ `location` Google, tel    │
 * │     quel (vide → « Lieu à confirmer » côté UI).                           │
 * │   • lit les bornes via `start.dateTime` / `end.dateTime`.                 │
 * │                                                                           │
 * │ Donc on GARANTIT :                                                        │
 * │   - type 'particulier'  → summary contient « Cours particulier »          │
 * │   - type 'collectif'    → summary = « Cours collectif » (PAS le mot        │
 * │                           particulier) ; capacité encodée dans la desc.    │
 * │   - location = lieu                                                        │
 * │   - start/end = { dateTime: ISO, timeZone: 'Europe/Paris' }               │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * RUNTIME — Cloudflare Workers (edge). Code 100 % pur, edge-safe.
 */

import { z } from "zod";
import type { EventWriteBody } from "@/lib/google-calendar";
import type { TicketType } from "@/lib/db-types";

// ============================================================================
// Constantes métier
// ============================================================================

/** Fuseau de saisie/affichage des créneaux (Lyon). */
export const TZ_CRENEAUX = "Europe/Paris";

/** Lieu par défaut des cours (décision Robert). */
export const LIEU_DEFAUT = "Parc de la Tête d'Or";

/** Marqueur texte garantissant que `deduireTypeDepuisEvent` lira 'particulier'. */
const SUMMARY_PARTICULIER = "Cours particulier — Yoga Sculpt";
const SUMMARY_COLLECTIF = "Cours collectif — Yoga Sculpt";

/**
 * Décalage UTC (minutes) de l'heure de Paris pour une date donnée.
 *
 * Edge-safe : on n'a pas accès aux bibliothèques de TZ. On déduit l'offset en
 * comparant l'heure « rendue à Paris » et l'heure UTC d'un même instant, via
 * `Intl.DateTimeFormat`. Gère automatiquement l'heure d'été/hiver (CET/CEST).
 *
 * @returns l'offset en minutes (ex. +120 pour CEST, +60 pour CET).
 */
export function offsetParisMinutes(at: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ_CRENEAUX,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(at);
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = Number(p.value);
  }
  // `hour` peut valoir 24 à minuit selon l'impl. ; on normalise à 0.
  const hour = map.hour === 24 ? 0 : map.hour;
  const asUtc = Date.UTC(
    map.year,
    map.month - 1,
    map.day,
    hour,
    map.minute,
    map.second,
  );
  // (heure murale Paris exprimée en UTC) - (instant réel UTC) = offset.
  return Math.round((asUtc - at.getTime()) / 60000);
}

/**
 * Construit l'instant ISO 8601 (avec offset Paris explicite) à partir d'une date
 * civile « YYYY-MM-DD » et d'une heure murale « HH:MM » de Paris.
 *
 * Ex. ("2026-07-03", "18:00") en CEST → "2026-07-03T18:00:00+02:00".
 *
 * On itère une fois pour fixer l'offset au plus près (l'offset dépend de la date,
 * pas de l'heure pour les bascules DST de Paris — qui se font à 02:00/03:00 ;
 * une seule passe suffit pour 99,99 % des créneaux de yoga, jamais posés en
 * pleine nuit de bascule).
 */
export function isoFromCivil(dateYmd: string, timeHm: string): string {
  const [y, mo, d] = dateYmd.split("-").map(Number);
  const [h, mi] = timeHm.split(":").map(Number);
  // 1re estimation : on suppose l'heure murale == UTC, puis on corrige.
  const naiveUtc = Date.UTC(y, mo - 1, d, h, mi, 0);
  const offset = offsetParisMinutes(new Date(naiveUtc));
  const realInstant = naiveUtc - offset * 60000;
  const date = new Date(realInstant);
  // Format ISO avec offset Paris explicite (ex. +02:00) pour lisibilité Google.
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  const oh = String(Math.floor(abs / 60)).padStart(2, "0");
  const om = String(abs % 60).padStart(2, "0");
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}` +
    `T${pad(h)}:${pad(mi)}:00${sign}${oh}:${om}`
  );
}

/** Ajoute `minutes` à un instant ISO, renvoie un ISO (UTC `Z`). */
export function addMinutesIso(iso: string, minutes: number): string {
  const t = new Date(iso).getTime();
  return new Date(t + minutes * 60000).toISOString();
}

// ============================================================================
// Validation des inputs (zod, strict)
// ============================================================================

const ymdRe = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const hmRe = /^([01]\d|2[0-3]):[0-5]\d$/;

const typeSchema: z.ZodType<TicketType> = z.enum(["collectif", "particulier"]);

/**
 * Schéma d'un créneau créé/édité « à la volée » (sans preset).
 * `dateHeure` cohérente (fin > début) est vérifiée par `validerCoherence`.
 */
export const creneauInputSchema = z
  .object({
    date: z.string().regex(ymdRe, "Date attendue au format AAAA-MM-JJ."),
    heureDebut: z.string().regex(hmRe, "Heure de début attendue au format HH:MM."),
    heureFin: z.string().regex(hmRe, "Heure de fin attendue au format HH:MM."),
    type: typeSchema.default("collectif"),
    lieu: z.string().trim().min(1).max(300).default(LIEU_DEFAUT),
    capacite: z.number().int().positive().max(100).optional(),
    summary: z.string().trim().max(300).optional(),
  })
  .strict();

export type CreneauInput = z.infer<typeof creneauInputSchema>;

/** Schéma de mise à jour d'un créneau (PATCH) — tous champs optionnels. */
export const creneauPatchSchema = z
  .object({
    eventId: z.string().min(1, "eventId requis."),
    date: z.string().regex(ymdRe).optional(),
    heureDebut: z.string().regex(hmRe).optional(),
    heureFin: z.string().regex(hmRe).optional(),
    type: typeSchema.optional(),
    lieu: z.string().trim().min(1).max(300).optional(),
    capacite: z.number().int().positive().max(100).nullable().optional(),
    summary: z.string().trim().max(300).optional(),
  })
  .strict();

export type CreneauPatch = z.infer<typeof creneauPatchSchema>;

/** Récurrence supportée par les presets : hebdomadaire (au minimum). */
export const recurrenceSchema = z
  .object({
    frequence: z.literal("hebdomadaire"),
    /** Nombre d'occurrences à générer (1 = ponctuel). */
    occurrences: z.number().int().positive().max(52),
    /** Jour de la semaine 0..6 (0 = dimanche). Optionnel (aide UI). */
    jour: z.number().int().min(0).max(6).optional(),
  })
  .strict();

export type Recurrence = z.infer<typeof recurrenceSchema>;

/** Schéma de création/édition d'un preset. */
export const presetInputSchema = z
  .object({
    label: z.string().trim().min(1, "Libellé requis.").max(120),
    type: typeSchema.default("collectif"),
    dureeMin: z.number().int().positive().max(600),
    heureDebut: z.string().regex(hmRe, "Heure attendue au format HH:MM."),
    lieu: z.string().trim().min(1).max(300).default(LIEU_DEFAUT),
    capacite: z.number().int().positive().max(100).nullable().optional(),
    recurrence: recurrenceSchema.nullable().optional(),
  })
  .strict();

export type PresetInput = z.infer<typeof presetInputSchema>;

/** Schéma « appliquer un preset à une date » (génère 1..N events). */
export const applyPresetSchema = z
  .object({
    presetId: z.string().uuid("presetId invalide."),
    /** Date de la 1re occurrence. */
    date: z.string().regex(ymdRe, "Date attendue au format AAAA-MM-JJ."),
    /**
     * Récurrence à appliquer pour CETTE application (override du preset).
     * Absente → 1 seule occurrence à `date`.
     */
    recurrence: recurrenceSchema.nullable().optional(),
  })
  .strict();

export type ApplyPresetInput = z.infer<typeof applyPresetSchema>;

/** Schéma « bloquer une journée » (event all-day « OFF »). */
export const blockDaySchema = z
  .object({
    date: z.string().regex(ymdRe, "Date attendue au format AAAA-MM-JJ."),
    motif: z.string().trim().max(200).optional(),
  })
  .strict();

export type BlockDayInput = z.infer<typeof blockDaySchema>;

// ============================================================================
// Cohérence temporelle (fin > début)
// ============================================================================

/** Minutes depuis minuit pour « HH:MM ». */
function minutesOfDay(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Vérifie que `heureFin` est STRICTEMENT après `heureDebut` (même jour).
 * @returns `null` si OK, sinon un message d'erreur.
 */
export function validerCoherence(
  heureDebut: string,
  heureFin: string,
): string | null {
  if (minutesOfDay(heureFin) <= minutesOfDay(heureDebut)) {
    return "L'heure de fin doit être après l'heure de début.";
  }
  return null;
}

// ============================================================================
// Construction du corps d'event Google (RESPECTE le contrat reservation.ts)
// ============================================================================

/**
 * Construit le `summary` garanti relisible par `deduireTypeDepuisEvent` :
 *   - 'particulier' → contient le mot « particulier ».
 *   - 'collectif'   → ne contient PAS « particulier ».
 * Un `summary` custom est respecté UNIQUEMENT s'il reste cohérent avec le type
 * (on refuse silencieusement un titre qui ferait dévier la déduction de type).
 */
export function buildSummary(type: TicketType, custom?: string): string {
  const base = type === "particulier" ? SUMMARY_PARTICULIER : SUMMARY_COLLECTIF;
  if (!custom) return base;
  const normalise = custom
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const customContientParticulier = normalise.includes("particulier");
  // Cohérence : le custom ne doit pas inverser la déduction de type.
  // - collectif mais le custom dit « particulier » → on ignore le custom.
  // - particulier mais le custom n'a pas « particulier » → on préfixe le marqueur.
  if (type === "collectif" && customContientParticulier) return base;
  if (type === "particulier" && !customContientParticulier) {
    return `Cours particulier — ${custom}`;
  }
  return custom;
}

/**
 * Encode la description d'un event (capacité pour le collectif + traçabilité).
 * La capacité est INFORMATIVE (Alice gère le plein à la main, cf reservation.ts).
 */
export function buildDescription(
  type: TicketType,
  capacite?: number | null,
): string {
  const lignes: string[] = [];
  if (type === "collectif" && capacite && capacite > 0) {
    lignes.push(`Capacité : ${capacite} places.`);
  }
  lignes.push("Créneau posé via l'espace admin Yoga Sculpt.");
  return lignes.join("\n");
}

/**
 * Construit le `EventWriteBody` Google complet pour un créneau « plein détail »
 * (date + heures civiles Paris). Garantit l'interop avec /api/creneaux.
 */
export function buildEventBody(input: CreneauInput): EventWriteBody {
  const startIso = isoFromCivil(input.date, input.heureDebut);
  const endIso = isoFromCivil(input.date, input.heureFin);
  return {
    summary: buildSummary(input.type, input.summary),
    description: buildDescription(input.type, input.capacite),
    location: input.lieu,
    start: { dateTime: startIso, timeZone: TZ_CRENEAUX },
    end: { dateTime: endIso, timeZone: TZ_CRENEAUX },
  };
}

/**
 * Construit le `EventWriteBody` d'une occurrence d'un PRESET appliqué à `date`.
 * L'heure de fin est dérivée de `dureeMin`.
 */
export function buildEventBodyFromPreset(
  preset: {
    type: TicketType;
    dureeMin: number;
    heureDebut: string;
    lieu: string;
    capacite?: number | null;
    label?: string;
  },
  date: string,
): EventWriteBody {
  const startIso = isoFromCivil(date, preset.heureDebut);
  const endIso = addMinutesIso(startIso, preset.dureeMin);
  return {
    summary: buildSummary(preset.type),
    description: buildDescription(preset.type, preset.capacite),
    location: preset.lieu,
    start: { dateTime: startIso, timeZone: TZ_CRENEAUX },
    end: { dateTime: endIso, timeZone: TZ_CRENEAUX },
  };
}

/**
 * Génère la liste des DATES « YYYY-MM-DD » couvertes par une récurrence
 * hebdomadaire à partir d'une date de départ.
 *
 * RÉCURRENCE SUPPORTÉE (V1) : hebdomadaire uniquement — « tous les 7 jours,
 * pendant N occurrences » à partir de `dateDepart`. On ne déplace PAS la date de
 * départ vers `recurrence.jour` (le `jour` est une aide de saisie côté UI ; ici
 * la 1re occurrence est exactement `dateDepart`, les suivantes à +7j chacune).
 * Mensuel / bi-hebdo : NON couverts en V1 (cf rapport).
 */
export function expanserDatesHebdo(
  dateDepart: string,
  occurrences: number,
): string[] {
  const [y, mo, d] = dateDepart.split("-").map(Number);
  const base = Date.UTC(y, mo - 1, d);
  const pad = (n: number) => String(n).padStart(2, "0");
  const dates: string[] = [];
  for (let i = 0; i < occurrences; i++) {
    const dt = new Date(base + i * 7 * 24 * 60 * 60 * 1000);
    dates.push(
      `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`,
    );
  }
  return dates;
}
