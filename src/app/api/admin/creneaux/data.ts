/**
 * Couche DONNÉES de la gestion admin des créneaux (presets Supabase + garde
 * de suppression). STRICTEMENT serveur : importe `createServiceClient` (clé
 * secrète). Toutes les fonctions ci-dessous sont appelées UNIQUEMENT depuis des
 * route handlers déjà protégés par `requireAdmin()`.
 *
 * RUNTIME — Cloudflare Workers (edge) : uniquement fetch (Supabase REST).
 */

import { createServiceClient } from "@/lib/supabase/service";
import type { TicketType } from "@/lib/db-types";
import type { Recurrence } from "./lib";

/** Ligne `slot_presets` telle qu'exposée à l'admin. */
export interface SlotPreset {
  id: string;
  label: string;
  type: TicketType;
  dureeMin: number;
  heureDebut: string;
  lieu: string;
  capacite: number | null;
  recurrence: Recurrence | null;
  createdAt: string;
}

/** Mappe une ligne DB (snake_case) → SlotPreset (camelCase exposé). */
function mapPreset(row: Record<string, unknown>): SlotPreset {
  return {
    id: row.id as string,
    label: row.label as string,
    type: (row.type as TicketType) ?? "collectif",
    dureeMin: Number(row.duree_min) || 0,
    heureDebut: (row.heure_debut as string) ?? "",
    lieu: (row.lieu as string) ?? "",
    capacite: row.capacite == null ? null : Number(row.capacite),
    recurrence: (row.recurrence as Recurrence | null) ?? null,
    createdAt: (row.created_at as string) ?? "",
  };
}

/** Liste tous les presets (les plus récents en tête). */
export async function listerPresets(): Promise<SlotPreset[]> {
  const service = createServiceClient();
  const { data, error } = await service
    .from("slot_presets")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    throw new Error(`[admin/creneaux] Lecture presets échouée : ${error.message}`);
  }
  return (data ?? []).map((r) => mapPreset(r as Record<string, unknown>));
}

/** Charge un preset par id (null si absent). */
export async function chargerPreset(id: string): Promise<SlotPreset | null> {
  const service = createServiceClient();
  const { data, error } = await service
    .from("slot_presets")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    throw new Error(`[admin/creneaux] Lecture preset échouée : ${error.message}`);
  }
  return data ? mapPreset(data as Record<string, unknown>) : null;
}

/** Insère un preset, renvoie la ligne créée. */
export async function creerPreset(
  row: {
    label: string;
    type: TicketType;
    dureeMin: number;
    heureDebut: string;
    lieu: string;
    capacite: number | null;
    recurrence: Recurrence | null;
  },
  createdBy: string,
): Promise<SlotPreset> {
  const service = createServiceClient();
  const { data, error } = await service
    .from("slot_presets")
    .insert({
      label: row.label,
      type: row.type,
      duree_min: row.dureeMin,
      heure_debut: row.heureDebut,
      lieu: row.lieu,
      capacite: row.capacite,
      recurrence: row.recurrence,
      created_by: createdBy,
    })
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(
      `[admin/creneaux] Création preset échouée : ${error?.message ?? "inconnue"}`,
    );
  }
  return mapPreset(data as Record<string, unknown>);
}

/** Met à jour un preset (champs fournis), renvoie la ligne ou null si absent. */
export async function majPreset(
  id: string,
  patch: Partial<{
    label: string;
    type: TicketType;
    dureeMin: number;
    heureDebut: string;
    lieu: string;
    capacite: number | null;
    recurrence: Recurrence | null;
  }>,
): Promise<SlotPreset | null> {
  const service = createServiceClient();
  const dbPatch: Record<string, unknown> = {};
  if (patch.label !== undefined) dbPatch.label = patch.label;
  if (patch.type !== undefined) dbPatch.type = patch.type;
  if (patch.dureeMin !== undefined) dbPatch.duree_min = patch.dureeMin;
  if (patch.heureDebut !== undefined) dbPatch.heure_debut = patch.heureDebut;
  if (patch.lieu !== undefined) dbPatch.lieu = patch.lieu;
  if (patch.capacite !== undefined) dbPatch.capacite = patch.capacite;
  if (patch.recurrence !== undefined) dbPatch.recurrence = patch.recurrence;

  const { data, error } = await service
    .from("slot_presets")
    .update(dbPatch)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) {
    throw new Error(`[admin/creneaux] MAJ preset échouée : ${error.message}`);
  }
  return data ? mapPreset(data as Record<string, unknown>) : null;
}

/** Supprime un preset (idempotent). */
export async function supprimerPreset(id: string): Promise<void> {
  const service = createServiceClient();
  const { error } = await service.from("slot_presets").delete().eq("id", id);
  if (error) {
    throw new Error(`[admin/creneaux] Suppression preset échouée : ${error.message}`);
  }
}

/**
 * Compte les réservations CONFIRMÉES posées sur un créneau Google (event id).
 * Sert de GARDE avant suppression/édition : on prévient l'admin si des clientes
 * sont déjà inscrites (on ne veut pas supprimer un cours plein en silence).
 */
export async function compterReservations(eventId: string): Promise<number> {
  const service = createServiceClient();
  const { count, error } = await service
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("google_calendar_creneau_id", eventId)
    .eq("status", "confirmed");
  if (error) {
    throw new Error(
      `[admin/creneaux] Comptage réservations échoué : ${error.message}`,
    );
  }
  return count ?? 0;
}
