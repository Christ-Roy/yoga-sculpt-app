/**
 * CRÉDIT / DÉBIT MANUEL de tickets par l'admin (back-office « Comptes »).
 *
 * Contexte : un ticket = un carnet de séances (`tickets.quantite_initiale` /
 * `quantite_restante`, cf migration 0002). Le moteur de résa décrémente
 * `quantite_restante` à chaque réservation. L'admin a besoin de deux gestes :
 *
 *   - CRÉDITER  : offrir des séances (ex. geste commercial, dédommagement).
 *   - DÉBITER   : corriger une erreur (retirer des séances créditées par erreur).
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ MODÈLE — on ne « bidouille » pas un ticket existant.                      │
 * │   • CRÉDIT  → INSERT d'un NOUVEAU ticket « ajustement admin » (traçable,  │
 * │     `stripe_*` null, `quantite_initiale = quantite_restante = N`). C'est  │
 * │     l'option la plus sûre et la plus lisible : chaque cadeau = une ligne. │
 * │   • DÉBIT   → on retire `N` séances en consommant les tickets du bon type │
 * │     du PLUS RÉCENT au plus ancien (LIFO : on annule d'abord ce qui vient  │
 * │     d'être ajouté), via un `update` gardé `quantite_restante >= pas`      │
 * │     (jamais en dessous de 0). Si le solde total est insuffisant → refus.  │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ IDEMPOTENCE — chaque opération admin porte un `op_id` (UUID fourni par    │
 * │ l'UI). On marque le `stripe_payment_id` du ticket de crédit avec          │
 * │ `admin-adjust:<op_id>` ; rejouer la même op (double-clic, retry réseau)   │
 * │ ne recrédite pas (on détecte le ticket déjà créé pour cet op_id).         │
 * │ Le débit, lui, n'écrit pas de ligne mais on garde l'op_id dans le log.    │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Tout passe par la `service_role` (bypass RLS) : on écrit au nom du système.
 * Runtime edge (Cloudflare Workers) : Supabase REST (fetch) uniquement.
 */

import { createServiceClient } from "@/lib/supabase/service";
import type { TicketType } from "@/lib/db-types";

/** Préfixe traçant un ticket issu d'un ajustement admin (vs un achat Stripe). */
const ADMIN_ADJUST_PREFIX = "admin-adjust:";

/** Résultat d'un crédit/débit admin. */
export interface AjustementResult {
  ok: boolean;
  /** Solde restant du type concerné APRÈS l'opération (somme `quantite_restante`). */
  soldeApres: number;
  /** Message technique pour le log / la réponse (ex. raison d'un refus). */
  message: string;
}

/** Somme des séances restantes d'un type pour un user (état courant). */
async function soldeRestant(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string,
  type: TicketType,
): Promise<number> {
  const { data } = await supabase
    .from("tickets")
    .select("quantite_restante")
    .eq("user_id", userId)
    .eq("type", type);
  return (data ?? []).reduce(
    (acc: number, t: { quantite_restante: number }) =>
      acc + (Number(t.quantite_restante) || 0),
    0,
  );
}

/**
 * CRÉDITE `quantite` séances de `type` au user, en INSÉRANT un ticket dédié.
 * Idempotent sur `opId` : si un ticket d'ajustement existe déjà pour cet opId,
 * on ne recrédite pas (retry sûr).
 */
export async function crediterTickets(params: {
  userId: string;
  type: TicketType;
  quantite: number;
  opId: string;
}): Promise<AjustementResult> {
  const { userId, type, quantite, opId } = params;
  const supabase = createServiceClient();
  const marqueur = `${ADMIN_ADJUST_PREFIX}${opId}`;

  // Idempotence : un ticket déjà créé pour cet opId ? → no-op.
  const { data: dejaFait } = await supabase
    .from("tickets")
    .select("id")
    .eq("stripe_payment_id", marqueur)
    .limit(1);
  if (dejaFait && dejaFait.length > 0) {
    return {
      ok: true,
      soldeApres: await soldeRestant(supabase, userId, type),
      message: "Opération déjà appliquée (idempotent).",
    };
  }

  const { error } = await supabase.from("tickets").insert({
    user_id: userId,
    type,
    quantite_initiale: quantite,
    quantite_restante: quantite,
    stripe_payment_id: marqueur, // traçabilité : ajustement admin, pas un achat.
  });
  if (error) {
    return { ok: false, soldeApres: 0, message: `Crédit échoué : ${error.message}` };
  }

  return {
    ok: true,
    soldeApres: await soldeRestant(supabase, userId, type),
    message: `Crédit de ${quantite} séance(s) ${type}.`,
  };
}

/**
 * DÉBITE `quantite` séances de `type` au user, en consommant les tickets du
 * plus récent au plus ancien (LIFO). Refuse si le solde total est insuffisant
 * (on ne descend jamais une ligne sous 0 ; pas de solde négatif).
 *
 * Concurrence : chaque décrément est gardé `quantite_restante >= pas` (update
 * conditionnel). Si une ligne a été vidée entre la lecture et l'écriture, on
 * passe à la suivante (la boucle se réajuste sur le restant réel).
 */
export async function debiterTickets(params: {
  userId: string;
  type: TicketType;
  quantite: number;
  opId: string;
}): Promise<AjustementResult> {
  const { userId, type, quantite } = params;
  const supabase = createServiceClient();

  // Garde : solde suffisant ? (lecture avant action — confirmée par les updates
  // conditionnels qui suivent, donc pas de débit partiel silencieux).
  const soldeAvant = await soldeRestant(supabase, userId, type);
  if (soldeAvant < quantite) {
    return {
      ok: false,
      soldeApres: soldeAvant,
      message: `Solde insuffisant : ${soldeAvant} séance(s) ${type} disponibles, ${quantite} demandée(s).`,
    };
  }

  // Tickets du type avec du restant, du PLUS RÉCENT au plus ancien (LIFO).
  const { data: tickets } = await supabase
    .from("tickets")
    .select("id, quantite_restante")
    .eq("user_id", userId)
    .eq("type", type)
    .gt("quantite_restante", 0)
    .order("created_at", { ascending: false });

  let reste = quantite;
  for (const t of (tickets ?? []) as Array<{ id: string; quantite_restante: number }>) {
    if (reste <= 0) break;
    const dispo = Number(t.quantite_restante) || 0;
    const pas = Math.min(dispo, reste);
    if (pas <= 0) continue;

    const { error } = await supabase
      .from("tickets")
      .update({ quantite_restante: dispo - pas })
      .eq("id", t.id)
      .gte("quantite_restante", pas); // garde anti-concurrence (pas de négatif).
    if (!error) reste -= pas;
    // si error/course perdue : on n'enlève pas `pas` du reste → ticket suivant.
  }

  const soldeApres = await soldeRestant(supabase, userId, type);
  if (reste > 0) {
    // Course concurrente : on n'a pas pu débiter tout le demandé.
    return {
      ok: false,
      soldeApres,
      message: `Débit partiel impossible (concurrence). ${quantite - reste} séance(s) retirée(s), réessayez.`,
    };
  }

  return {
    ok: true,
    soldeApres,
    message: `Débit de ${quantite} séance(s) ${type}.`,
  };
}
