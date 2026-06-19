import { describe, it, expect } from "vitest";
import { normalizePhone, isValidPhone } from "@/lib/phone";

/**
 * Tests du helper de validation/normalisation des numéros de téléphone.
 *
 * Objectif : garantir qu'on ne range JAMAIS de garbage en base et que toute
 * forme valide (FR local, +33, 0033, séparateurs variés) converge vers la même
 * valeur canonique E.164 (`+33…`).
 */

describe("normalizePhone — formats FR valides", () => {
  it("normalise un numéro FR local '0X XX XX XX XX' vers E.164", () => {
    expect(normalizePhone("06 12 34 56 78")).toBe("+33612345678");
  });

  it("accepte le local collé sans séparateur", () => {
    expect(normalizePhone("0612345678")).toBe("+33612345678");
  });

  it("accepte les points et tirets comme séparateurs", () => {
    expect(normalizePhone("06.12.34.56.78")).toBe("+33612345678");
    expect(normalizePhone("06-12-34-56-78")).toBe("+33612345678");
  });

  it("accepte un fixe FR (commence par 0[1-9])", () => {
    expect(normalizePhone("04 78 00 00 00")).toBe("+33478000000");
  });

  it("normalise un numéro FR international '+33…' vers la forme canonique", () => {
    expect(normalizePhone("+33 6 12 34 56 78")).toBe("+33612345678");
    expect(normalizePhone("+33612345678")).toBe("+33612345678");
  });

  it("normalise un préfixe '0033…' vers '+33…'", () => {
    expect(normalizePhone("0033 6 12 34 56 78")).toBe("+33612345678");
  });

  it("tolère les espaces de bordure", () => {
    expect(normalizePhone("  06 12 34 56 78  ")).toBe("+33612345678");
  });
});

describe("normalizePhone — autres pays (E.164)", () => {
  it("conserve un numéro international hors-FR déjà en E.164", () => {
    // Belgique (+32) — laissé tel quel, juste les séparateurs retirés.
    expect(normalizePhone("+32 470 12 34 56")).toBe("+32470123456");
  });

  it("convertit '00CC…' (hors-FR) en '+CC…'", () => {
    expect(normalizePhone("0049 151 23456789")).toBe("+4915123456789");
  });
});

describe("normalizePhone — entrées invalides → null (pas de garbage)", () => {
  it("rejette null / undefined / non-string", () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
    expect(normalizePhone(123 as unknown as string)).toBeNull();
  });

  it("rejette une chaîne vide ou que des séparateurs", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("   ")).toBeNull();
    expect(normalizePhone("()- .")).toBeNull();
  });

  it("rejette un FR qui ne démarre pas par 0[1-9]", () => {
    expect(normalizePhone("09")).toBeNull(); // bien trop court
    expect(normalizePhone("1612345678")).toBeNull(); // ne commence pas par 0 (local FR)
  });

  it("rejette un '00' suivi d'un indicatif pays invalide (0…) — n'existe pas en E.164", () => {
    expect(normalizePhone("0001234567")).toBeNull(); // 00 + 0… → +0… interdit
  });

  it("rejette une longueur FR locale incohérente", () => {
    expect(normalizePhone("06 12 34 56")).toBeNull(); // trop court
    expect(normalizePhone("06 12 34 56 78 90")).toBeNull(); // trop long
  });

  it("rejette '+33' mal formé", () => {
    expect(normalizePhone("+330612345678")).toBeNull(); // chiffre national à 0
    expect(normalizePhone("+33612")).toBeNull(); // trop court
  });

  it("rejette la présence de lettres", () => {
    expect(normalizePhone("06 12 34 AB 78")).toBeNull();
    expect(normalizePhone("+33 ABC")).toBeNull();
  });

  it("rejette un '+' suivi d'un nombre de chiffres hors plage E.164", () => {
    expect(normalizePhone("+1234567")).toBeNull(); // 7 chiffres < 8
    expect(normalizePhone("+1234567890123456")).toBeNull(); // 16 chiffres > 15
  });
});

describe("isValidPhone", () => {
  it("true pour un numéro valide, false sinon", () => {
    expect(isValidPhone("06 12 34 56 78")).toBe(true);
    expect(isValidPhone("+33612345678")).toBe(true);
    expect(isValidPhone("pas un numéro")).toBe(false);
    expect(isValidPhone(null)).toBe(false);
  });
});
