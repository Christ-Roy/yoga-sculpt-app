/**
 * TICKET DE BIENVENUE — « 1ère séance offerte » (pivot « Essai gratuit »).
 *
 * Depuis le 2026-06-19, le vitrine pousse un CTA « Essai gratuit » vers l'app.
 * Pour tenir la promesse, CHAQUE nouveau compte est crédité d'1 ticket
 * `collectif` offert à la 1ère complétion d'onboarding (séance découverte).
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ IDEMPOTENCE — 1 SEUL ticket bienvenue par compte, JAMAIS re-crédité.      │
 * │   Double garde :                                                          │
 * │     1. flag applicatif `profiles.welcome_ticket_granted_at` (lecture      │
 * │        cheap : on sort tôt s'il est déjà posé) ;                          │
 * │     2. index UNIQUE PARTIEL DB `tickets(user_id) where source='welcome'`  │
 * │        (migration 0009) : un 2e insert 'welcome' échoue (23505) même en   │
 * │        cas de course. On traite ce 23505 comme un succès idempotent.      │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ ANTI-ABUS — calqué sur le parrainage (src/lib/anti-abuse.ts).            │
 * │   Même menace (créer N faux comptes pour multiplier les essais gratuits). │
 * │   On réutilise `canGrantWelcomeTicket` (e-mail jetable + IP/fingerprint   │
 * │   partagés avec un autre compte). REFUS → SILENCIEUX : pas de ticket,     │
 * │   pas d'erreur révélatrice. On pose tout de même le flag pour ne pas      │
 * │   re-tenter à chaque visite (échec « décidé », pas une dette à rejouer).  │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * BEST-EFFORT : tout passe par la `service_role`. Une erreur n'interrompt
 * JAMAIS l'onboarding (l'appelant ignore le retour). Runtime edge (Workers).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { canGrantWelcomeTicket } from "@/lib/anti-abuse";
import { logEvent } from "@/lib/events";
import { createLogger } from "@/lib/log";

const log = createLogger("welcome");

/** Code d'erreur PostgreSQL pour une violation d'unicité. */
const PG_UNIQUE_VIOLATION = "23505";

/** Résultat (volontairement non révélateur côté UI). */
export type GrantWelcomeResult =
  | { granted: true } // un ticket de bienvenue a été crédité.
  | { granted: false }; // rien crédité (déjà fait, anti-abus, ou erreur avalée).

/**
 * Crédite (au plus une fois) le ticket de bienvenue au compte `userId`.
 *
 * ÉTAPES :
 *   1. Idempotence rapide : flag `welcome_ticket_granted_at` déjà posé → no-op.
 *   2. Anti-abus : `canGrantWelcomeTicket`. Refus → on pose le flag (pour ne pas
 *      re-tenter indéfiniment) et on s'arrête, SILENCIEUSEMENT.
 *   3. Insert du ticket `collectif` (source 'welcome', quantite 1). Une violation
 *      d'unicité (index partiel) = un ticket existe déjà → succès idempotent.
 *   4. Pose le flag profil + émet l'event `ticket_acquired` (best-effort).
 *
 * @param service  client Supabase service_role (bypass RLS).
 * @param params   userId / email / ip / fingerprint du compte concerné.
 */
export async function grantWelcomeTicket(
  service: SupabaseClient,
  params: {
    userId: string;
    email: string;
    ip: string | null;
    fingerprint: string | null;
  },
): Promise<GrantWelcomeResult> {
  const { userId, email, ip, fingerprint } = params;

  // 1) Idempotence rapide via le flag profil.
  const { data: profile, error: readErr } = await service
    .from("profiles")
    .select("welcome_ticket_granted_at")
    .eq("id", userId)
    .maybeSingle();

  if (readErr) {
    log.error("Lecture profile échouée", { db: readErr.message });
    return { granted: false }; // côté sûr : on ne crédite pas dans le doute.
  }
  if (profile?.welcome_ticket_granted_at) {
    return { granted: false }; // déjà accordé (ou refus déjà décidé) → no-op.
  }

  // 2) Anti-abus — refus SILENCIEUX. On pose quand même le flag pour figer la
  //    décision (sinon on re-tenterait l'anti-abus à chaque complétion / visite).
  const allowed = await canGrantWelcomeTicket(service, {
    userId,
    email,
    ip,
    fingerprint,
  });
  if (!allowed) {
    await marquerFlag(service, userId);
    return { granted: false };
  }

  // 3) Insert du ticket de bienvenue. L'index unique partiel garantit l'unicité
  //    « 1 welcome par compte » : une course concurrente → 23505 = déjà crédité.
  const { error: insertErr } = await service.from("tickets").insert({
    user_id: userId,
    type: "collectif",
    quantite_initiale: 1,
    quantite_restante: 1,
    source: "welcome",
    // Pas de stripe_* : ticket offert. Pas d'expiration imposée (cohérent avec
    // le parrainage ; on n'introduit pas d'urgence artificielle ici).
  });

  if (insertErr) {
    if (insertErr.code === PG_UNIQUE_VIOLATION) {
      // Un ticket welcome existe déjà (course) → on s'aligne sur l'état réel et
      // on s'assure que le flag est posé. Idempotent : pas de doublon.
      await marquerFlag(service, userId);
      return { granted: false };
    }
    log.error("Insert ticket bienvenue échoué", { db: insertErr.message });
    return { granted: false };
  }

  // 4) Pose le flag (idempotence applicative) + tracking best-effort.
  await marquerFlag(service, userId);
  void logEvent(
    userId,
    "ticket_acquired",
    { acquisition_source: "welcome", type: "collectif", quantite: 1 },
    { source: "onboarding", service },
  );

  return { granted: true };
}

/**
 * Pose `welcome_ticket_granted_at = now()` sur le profil (best-effort).
 * Garde `is('welcome_ticket_granted_at', null)` : on n'écrase pas un horodatage
 * déjà présent (préserve la 1ère décision en cas de course).
 */
async function marquerFlag(
  service: SupabaseClient,
  userId: string,
): Promise<void> {
  const { error } = await service
    .from("profiles")
    .update({ welcome_ticket_granted_at: new Date().toISOString() })
    .eq("id", userId)
    .is("welcome_ticket_granted_at", null);
  if (error) {
    log.error("Pose du flag welcome_ticket_granted_at échouée", {
      db: error.message,
    });
  }
}
