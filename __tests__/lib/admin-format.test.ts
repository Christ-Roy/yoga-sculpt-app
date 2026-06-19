import { describe, it, expect } from "vitest";
import {
  formatDateHeure,
  formatDate,
  formatHeure,
  formatEuro,
  formatPlage,
} from "@/lib/admin-format";

/**
 * Tests de src/lib/admin-format.ts — formatage FR (dates/montants) du dashboard.
 *
 * Tous purs, fuseau forcé Europe/Paris. Couvre :
 *   - rendu nominal en heure de Paris (été = UTC+2) ;
 *   - fallback "—" sur date invalide (toutes les fonctions date) ;
 *   - formatEuro sans décimales (séparateur de milliers FR) ;
 *   - formatPlage = "heure début – heure fin".
 *
 * Les espaces FR (insécables) varient selon l'ICU ; on évite l'égalité stricte
 * des espaces et on teste les FRAGMENTS robustes (chiffres + "€", "h:mm", "—").
 */

// 23 juin 2026 08:00 UTC = 10:00 Paris (heure d'été).
const ISO = "2026-06-23T08:00:00.000Z";

describe("formatDateHeure", () => {
  it("rend une date+heure FR en heure de Paris", () => {
    const s = formatDateHeure(ISO);
    expect(s).toContain("23");
    expect(s).toContain("juin");
    expect(s).toContain("10:00"); // 10h Paris (UTC+2)
  });
  it("fallback '—' sur date invalide", () => {
    expect(formatDateHeure("nope")).toBe("—");
  });
});

describe("formatDate", () => {
  it("rend la date seule avec l'année", () => {
    const s = formatDate(ISO);
    expect(s).toContain("23");
    expect(s).toContain("juin");
    expect(s).toContain("2026");
  });
  it("fallback '—' sur date invalide", () => {
    expect(formatDate("")).toBe("—");
  });
});

describe("formatHeure", () => {
  it("rend l'heure seule en heure de Paris", () => {
    expect(formatHeure(ISO)).toBe("10:00");
  });
  it("fallback '—' sur date invalide", () => {
    expect(formatHeure("nope")).toBe("—");
  });
});

describe("formatEuro", () => {
  it("rend un montant en euros sans décimales", () => {
    const s = formatEuro(1200);
    expect(s).toMatch(/1\s?200/); // séparateur de milliers (espace insécable toléré)
    expect(s).toContain("€");
    expect(s).not.toContain(",00");
  });
  it("rend 0 €", () => {
    expect(formatEuro(0)).toMatch(/0\s?€/);
  });
});

describe("formatPlage", () => {
  it("rend 'heure début – heure fin' en heure de Paris", () => {
    expect(formatPlage(ISO, "2026-06-23T09:00:00.000Z")).toBe("10:00 – 11:00");
  });
});
