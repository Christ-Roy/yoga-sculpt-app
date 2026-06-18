/**
 * Back-office « Gestion des réservations » — logique métier PURE & partagée
 * entre les routes admin (`/api/admin/bookings/*`).
 *
 * Ce module ne fait AUCUN I/O (pas de fetch Google, pas de requête Supabase) :
 * uniquement des schémas de validation (zod), la machine d'état « présence »,
 * et des helpers de décision réutilisés par les routes cancel / move /
 * attendance. La logique métier d'écriture (recrédit ticket, retrait attendee
 * Google) est, elle, RÉUTILISÉE depuis `@/lib/reservation` — on ne la duplique
 * pas ici.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ RUNTIME — Cloudflare Workers (edge). Code 100 % pur, zéro dépendance I/O. │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import { z } from "zod";

// ============================================================================
// Présence (présent / absent) — état & validation
// ============================================================================

/**
 * Valeurs de présence persistées sur `bookings.attendance` (cf. migration
 * 0008). `null` = non renseigné. On n'expose ici QUE les valeurs marquables
 * explicitement par Alice ('attended' | 'no_show') ; la remise à zéro se fait
 * via la valeur sentinelle 'pending' côté API (mappée en NULL en base).
 */
export type AttendanceValue = "attended" | "no_show";

/** État de présence tel qu'exposé/échangé par l'API (inclut « non renseigné »). */
export type AttendanceState = AttendanceValue | "pending";

/**
 * Convertit l'état d'API en valeur PERSISTÉE (`bookings.attendance`).
 * 'pending' → `null` (réinitialisation : la présence redevient non renseignée).
 */
export function attendanceToColumn(state: AttendanceState): AttendanceValue | null {
  return state === "pending" ? null : state;
}

// ============================================================================
// Schémas de validation (zod) — partagés par les routes
// ============================================================================

/** Corps de `POST /api/admin/bookings/cancel`. */
export const cancelBodySchema = z
  .object({
    /** Réservation à annuler (au nom du client). */
    bookingId: z.string().min(1, "bookingId requis."),
    /**
     * Outrepasse la garde des 24h. Par défaut `false` : l'admin doit cocher
     * explicitement pour annuler une séance imminente (< 24h). Trace l'intention.
     */
    overrideGuard: z.boolean().optional().default(false),
    /**
     * Force le recrédit du ticket même quand l'admin outrepasse la garde 24h.
     * Par défaut `true` : annuler au nom du client recrédite son carnet (c'est
     * le comportement attendu). Permettre `false` couvre le cas « no-show tardif
     * non recréditable » décidé par Alice.
     */
    recredit: z.boolean().optional().default(true),
  })
  .strict();

export type CancelBody = z.infer<typeof cancelBodySchema>;

/** Corps de `POST /api/admin/bookings/move`. */
export const moveBodySchema = z
  .object({
    /** Réservation à déplacer. */
    bookingId: z.string().min(1, "bookingId requis."),
    /** Id du créneau Google cible (event vers lequel déplacer la réservation). */
    targetCreneauId: z.string().min(1, "targetCreneauId requis."),
  })
  .strict();

export type MoveBody = z.infer<typeof moveBodySchema>;

/** Corps de `POST /api/admin/bookings/attendance`. */
export const attendanceBodySchema = z
  .object({
    /** Réservation à pointer. */
    bookingId: z.string().min(1, "bookingId requis."),
    /** Nouvel état de présence ('attended' | 'no_show' | 'pending'=réinit). */
    attendance: z.enum(["attended", "no_show", "pending"]),
  })
  .strict();

export type AttendanceBody = z.infer<typeof attendanceBodySchema>;

// ============================================================================
// Helpers de décision (purs)
// ============================================================================

/**
 * Décide si l'annulation admin doit être ACCEPTÉE compte tenu de la garde 24h.
 *
 * Différence avec le client (`/api/annuler`) : l'admin (Alice) PEUT outrepasser
 * la garde des 24h via `overrideGuard`. Sans override, on applique la même
 * règle que le client (refus si < 24h).
 *
 * @param startsAt      début de la séance (ISO) lu EN BASE (source de vérité).
 * @param overrideGuard l'admin a explicitement demandé d'outrepasser la garde.
 * @param delaiHeures   seuil d'annulation (heures) — injecté pour testabilité.
 * @param maintenant    instant courant — injecté pour testabilité.
 * @returns `{ allowed: true }` ou `{ allowed: false, tooLate: true }`.
 */
export function decisionAnnulationAdmin(params: {
  startsAt: string;
  overrideGuard: boolean;
  delaiHeures: number;
  maintenant?: Date;
}): { allowed: boolean; tooLate: boolean } {
  const { startsAt, overrideGuard, delaiHeures, maintenant = new Date() } = params;
  if (overrideGuard) return { allowed: true, tooLate: false };

  const start = new Date(startsAt).getTime();
  if (Number.isNaN(start)) {
    // Date illisible : on refuse par prudence (fail-safe), sans crasher.
    return { allowed: false, tooLate: true };
  }
  const tropTard = start - maintenant.getTime() < delaiHeures * 60 * 60 * 1000;
  return { allowed: !tropTard, tooLate: tropTard };
}

/**
 * Recrédit borné d'un ticket (+1, plafonné à `quantite_initiale`).
 * Réplique EXACTE de la règle utilisée par `/api/annuler` (recrédit côté client) :
 * on ne dépasse jamais le plafond (le check DB `restante <= initiale` le rejetterait).
 */
export function quantiteApresRecredit(
  quantiteRestante: number,
  quantiteInitiale: number,
): number {
  return Math.min(quantiteRestante + 1, quantiteInitiale);
}
