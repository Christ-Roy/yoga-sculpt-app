import type { Ticket, TicketType } from "@/lib/db-types";

/** Solde de tickets agrégé par type (séances encore disponibles). */
export interface Solde {
  collectif: number;
  particulier: number;
}

/** Ligne de ticket minimale nécessaire au calcul du solde. */
export type LigneSolde = Pick<Ticket, "type" | "quantite_restante">;

/**
 * Agrège une liste de tickets (déjà filtrée « restant > 0 et non expiré » côté
 * requête) en un solde par type. Fonction PURE — testable, sans I/O.
 *
 * On ignore toute ligne dont le `type` n'est pas un `TicketType` connu (robustesse
 * si la DB introduit un nouveau type non géré par l'UI).
 */
export function calculerSolde(lignes: readonly LigneSolde[] | null | undefined): Solde {
  const solde: Solde = { collectif: 0, particulier: 0 };
  for (const t of lignes ?? []) {
    const type = t.type as TicketType;
    if (type === "collectif" || type === "particulier") {
      solde[type] += t.quantite_restante;
    }
  }
  return solde;
}

/** Total de séances disponibles tous types confondus. */
export function totalSolde(solde: Solde): number {
  return solde.collectif + solde.particulier;
}
