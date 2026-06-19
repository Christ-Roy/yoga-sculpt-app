/**
 * Journal d'événements utilisateur (tracking V1) — helper d'écriture serveur.
 *
 * Émet une ligne dans `public.user_events` (cf. migration 0006) pour chaque
 * signal métier (acquisition, paiement, réservation, parrainage). Les agrégats du
 * dashboard /admin/insights sont des VUES SQL au-dessus de ce journal — ici on ne
 * fait QU'écrire l'event brut, jamais de compteur dénormalisé.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ FAIL-SAFE — un log raté ne casse JAMAIS le flux métier.                   │
 * │   `logEvent` est best-effort : tout échec (DB indisponible, service_role  │
 * │   absente, erreur réseau) est avalé + loggé en console, et la fonction    │
 * │   renvoie `false` SANS throw. Un appelant (checkout, webhook, réserver…)  │
 * │   peut donc l'invoquer sans try/catch et sans risquer de faire échouer    │
 * │   un paiement / une réservation à cause du tracking.                      │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ SÉCURITÉ — écriture via service_role UNIQUEMENT.                          │
 * │   La table user_events est RLS sans policy : seule la clé service_role     │
 * │   (bypass RLS) peut insérer. Ce module importe createServiceClient (clé    │
 * │   secrète) → STRICTEMENT serveur, ne JAMAIS l'importer côté client.        │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * RUNTIME — Cloudflare Workers (edge, OpenNext) : @supabase/supabase-js en
 * mode fetch (PostgREST). Aucune dépendance Node.
 */

import { createServiceClient } from "@/lib/supabase/service";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createLogger, serializeError } from "@/lib/log";

const log = createLogger("events");

/**
 * Types d'événements journalisés. Doit rester ALIGNÉ avec le CHECK de la
 * migration 0006 (`user_events_type_check`). Ajouter un type = l'ajouter ICI
 * ET dans le CHECK (migration additive).
 */
export type EventType =
  | "signup"
  | "onboarding_completed"
  | "checkout_started"
  | "checkout_completed"
  | "checkout_abandoned"
  | "ticket_acquired"
  | "referral_invited"
  | "referral_signup"
  | "referral_credited"
  | "referral_blocked"
  | "invitation_landing_view"
  | "booking_created"
  | "booking_cancelled"
  | "booking_attended"
  | "reactivation_sent";

/** Métadonnées libres d'un event (sérialisables en JSONB). */
export type EventMetadata = Record<string, unknown>;

/** Options transverses d'un event (contexte d'émission). */
export interface LogEventOpts {
  /** IP du client (type inet en base). Best-effort, souvent absent côté machine. */
  ip?: string | null;
  /** Origine de l'event ('checkout', 'webhook:stripe', 'reserver', 'cron', …). */
  source?: string | null;
  /**
   * Client service_role à réutiliser. Optionnel : si l'appelant en a déjà un
   * (ex. /api/reserver), on évite d'en recréer un. Sinon on en instancie un.
   */
  service?: SupabaseClient;
}

/**
 * Journalise un événement utilisateur. Best-effort, ne throw jamais.
 *
 * @param userId      id auth.users du user concerné, ou `null` pour un event
 *                    sans compte rattaché (checkout anonyme, referral_blocked…).
 * @param eventType   type de l'événement (union typée).
 * @param metadata    charge utile structurée (montant, formule, ids, raison…).
 * @param opts        ip / source / client service_role à réutiliser.
 * @returns `true` si l'insert a réussi, `false` sinon (échec avalé).
 */
export async function logEvent(
  userId: string | null,
  eventType: EventType,
  metadata: EventMetadata = {},
  opts: LogEventOpts = {},
): Promise<boolean> {
  try {
    const service = opts.service ?? createServiceClient();

    const { error } = await service.from("user_events").insert({
      user_id: userId,
      event_type: eventType,
      metadata,
      ip: opts.ip ?? null,
      source: opts.source ?? null,
    });

    if (error) {
      log.error("logEvent échoué (non bloquant)", {
        event_type: eventType,
        db: error.message,
      });
      return false;
    }
    return true;
  } catch (err) {
    // Best-effort absolu : même createServiceClient() peut throw (env manquant).
    // On avale tout — le tracking ne doit JAMAIS faire échouer le flux métier.
    log.error("logEvent exception (non bloquant)", {
      event_type: eventType,
      err: serializeError(err),
    });
    return false;
  }
}
