import { describe, it, expect } from "vitest";
import {
  calculerSolde,
  totalSolde,
  type LigneSolde,
} from "@/components/espace/solde";

describe("calculerSolde", () => {
  it("renvoie un solde nul pour null / undefined / liste vide", () => {
    expect(calculerSolde(null)).toEqual({ collectif: 0, particulier: 0 });
    expect(calculerSolde(undefined)).toEqual({ collectif: 0, particulier: 0 });
    expect(calculerSolde([])).toEqual({ collectif: 0, particulier: 0 });
  });

  it("agrège les quantités par type", () => {
    const lignes: LigneSolde[] = [
      { type: "collectif", quantite_restante: 3 },
      { type: "collectif", quantite_restante: 2 },
      { type: "particulier", quantite_restante: 1 },
    ];
    expect(calculerSolde(lignes)).toEqual({ collectif: 5, particulier: 1 });
  });

  it("ignore les types inconnus (robustesse DB)", () => {
    const lignes = [
      { type: "collectif", quantite_restante: 4 },
      // type non géré par l'UI
      { type: "duo", quantite_restante: 99 },
    ] as unknown as LigneSolde[];
    expect(calculerSolde(lignes)).toEqual({ collectif: 4, particulier: 0 });
  });
});

describe("totalSolde", () => {
  it("somme les deux types", () => {
    expect(totalSolde({ collectif: 5, particulier: 2 })).toBe(7);
    expect(totalSolde({ collectif: 0, particulier: 0 })).toBe(0);
  });
});
