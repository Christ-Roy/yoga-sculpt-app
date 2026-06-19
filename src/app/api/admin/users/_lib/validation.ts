/**
 * Schémas de validation (zod, stricts) des routes d'administration des comptes.
 * Isolés ici pour être testés unitairement sans monter tout le handler.
 *
 * Convention de l'app : `.strict()` partout (rejet de tout champ inconnu) +
 * messages d'erreur explicites (clé `error`, idiome zod v4 du repo). Aligné sur
 * les routes existantes (reserver, parrainage/inviter…).
 */

import { z } from "zod";

/** Types de tickets valides (miroir de la contrainte CHECK de la migration 0002). */
export const TICKET_TYPES = ["collectif", "particulier"] as const;

/**
 * Corps de POST /api/admin/users/tickets — crédit / débit manuel.
 *   { userId, type, sens: 'credit'|'debit', quantite, opId }
 * `opId` : UUID fourni par l'UI pour l'idempotence (retry / double-clic sûr).
 */
export const ticketsBodySchema = z
  .object({
    userId: z.uuid({ error: "userId doit être un UUID." }),
    type: z.enum(TICKET_TYPES, { error: "type invalide." }),
    sens: z.enum(["credit", "debit"], { error: "sens invalide." }),
    // 1..50 : garde-fou contre une faute de frappe (créditer 5000 séances).
    quantite: z
      .number()
      .int({ error: "quantite doit être un entier." })
      .min(1, { error: "quantite minimale : 1." })
      .max(50, { error: "quantite maximale : 50 par opération." }),
    opId: z.uuid({ error: "opId doit être un UUID." }),
  })
  .strict();

export type TicketsBody = z.infer<typeof ticketsBodySchema>;

/**
 * Corps de POST /api/admin/users/auth-action — génère un lien d'auth.
 *   { userId, action: 'recovery'|'magiclink' }
 * On cible par `userId` (pas par e-mail libre) : l'e-mail réel est relu côté
 * serveur via GoTrue (on ne fait pas confiance à un e-mail fourni par le client).
 */
export const authActionBodySchema = z
  .object({
    userId: z.uuid({ error: "userId doit être un UUID." }),
    action: z.enum(["recovery", "magiclink"], { error: "action invalide." }),
  })
  .strict();

export type AuthActionBody = z.infer<typeof authActionBodySchema>;

/**
 * Corps de POST /api/admin/users/suspendre — suspend / réactive un compte.
 *   { userId, suspendre: boolean }
 */
export const suspendBodySchema = z
  .object({
    userId: z.uuid({ error: "userId doit être un UUID." }),
    suspendre: z.boolean(),
  })
  .strict();

export type SuspendBody = z.infer<typeof suspendBodySchema>;

/**
 * Corps de POST /api/admin/users/inviter — (ré)invite un e-mail (pré-création).
 *   { email }
 * E-mail normalisé (trim + minuscules) AVANT validation de format (un e-mail
 * collé avec des espaces/majuscules ne doit pas être rejeté en 400).
 */
export const inviterBodySchema = z
  .object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.email({ error: "Adresse e-mail invalide." })),
  })
  .strict();

export type InviterBody = z.infer<typeof inviterBodySchema>;
