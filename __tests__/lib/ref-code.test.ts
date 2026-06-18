import { describe, it, expect } from "vitest";
import { sanitizeRefCode } from "@/lib/ref-code";

/**
 * Tests de lib/ref-code — sanitisation du code de parrainage `?ref=` avant pose
 * en cookie (login/page.tsx).
 *
 * Le code canonique = 8 caractères de l'alphabet non ambigu
 * `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (cf. genererCode dans referral.ts). Toute
 * autre forme DOIT être rejetée (`null`) : on ne dépose jamais une valeur
 * arbitraire en cookie (défense contre l'injection via l'URL).
 */
describe("sanitizeRefCode", () => {
  it("accepte un code canonique valide (8 chars, alphabet non ambigu)", () => {
    expect(sanitizeRefCode("ABCD2345")).toBe("ABCD2345");
    expect(sanitizeRefCode("PQRSTUVW")).toBe("PQRSTUVW");
    expect(sanitizeRefCode("23456789")).toBe("23456789");
  });

  it("normalise la casse en MAJUSCULES", () => {
    expect(sanitizeRefCode("abcd2345")).toBe("ABCD2345");
    expect(sanitizeRefCode("AbCd2345")).toBe("ABCD2345");
  });

  it("tolère les espaces d'enveloppe (trim)", () => {
    expect(sanitizeRefCode("  ABCD2345  ")).toBe("ABCD2345");
    expect(sanitizeRefCode("\tABCD2345\n")).toBe("ABCD2345");
  });

  it("rejette une longueur incorrecte", () => {
    expect(sanitizeRefCode("ABCD234")).toBeNull(); // 7
    expect(sanitizeRefCode("ABCD23456")).toBeNull(); // 9
    expect(sanitizeRefCode("")).toBeNull();
    expect(sanitizeRefCode("   ")).toBeNull();
  });

  it("rejette les caractères ambigus exclus de l'alphabet (0/O 1/I/L)", () => {
    // '0' (zéro) et 'O' (lettre) — seul 'O' n'est PAS dans l'alphabet, '0' non plus.
    expect(sanitizeRefCode("ABCD2340")).toBeNull(); // '0' interdit
    expect(sanitizeRefCode("ABCDO234")).toBeNull(); // 'O' interdit
    expect(sanitizeRefCode("ABCD234I")).toBeNull(); // 'I' interdit
    expect(sanitizeRefCode("ABCD234L")).toBeNull(); // 'L' interdit
    expect(sanitizeRefCode("ABCD2341")).toBeNull(); // '1' interdit
  });

  it("rejette les caractères hors alphabet (symboles, accents, injection)", () => {
    expect(sanitizeRefCode("ABCD-345")).toBeNull();
    expect(sanitizeRefCode("ABCD 345")).toBeNull(); // espace interne
    expect(sanitizeRefCode("ABCDÉ345")).toBeNull();
    expect(sanitizeRefCode("<script>")).toBeNull();
    expect(sanitizeRefCode("ABCD234;")).toBeNull();
  });

  it("rejette une entrée anormalement longue avant tout traitement", () => {
    expect(sanitizeRefCode("A".repeat(33))).toBeNull();
    expect(sanitizeRefCode("ABCD2345".repeat(10))).toBeNull();
  });

  it("rejette les valeurs non-string (null / undefined)", () => {
    expect(sanitizeRefCode(null)).toBeNull();
    expect(sanitizeRefCode(undefined)).toBeNull();
  });
});
