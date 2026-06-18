import { describe, it, expect } from "vitest";
import { computeDevAuthBypass } from "@/lib/dev-auth";

/**
 * Tests de la GARDE du bypass d'auth DEV (src/lib/dev-auth.ts).
 *
 * Le test CRITIQUE (sécurité) : prouver que `NODE_ENV=production` neutralise le
 * bypass MÊME quand `NEXT_PUBLIC_DEV_AUTH_BYPASS=1`. C'est l'invariant qui rend
 * impossible l'activation du bypass en prod/staging.
 *
 * On teste la FONCTION PURE `computeDevAuthBypass(env)` (et non le drapeau global
 * `DEV_AUTH_BYPASS` figé au chargement du module) : c'est exactement la même
 * logique que celle utilisée pour calculer le drapeau, mais paramétrable, donc
 * déterministe et testable sans tripoter `process.env` au runtime.
 */
describe("computeDevAuthBypass — garde combinée (env + NODE_ENV)", () => {
  it("🔴 CRITIQUE : NODE_ENV=production neutralise le bypass MÊME si la var =1", () => {
    expect(
      computeDevAuthBypass({
        NEXT_PUBLIC_DEV_AUTH_BYPASS: "1",
        NODE_ENV: "production",
      }),
    ).toBe(false);
  });

  it("actif uniquement si var=1 ET NODE_ENV != production (dev)", () => {
    expect(
      computeDevAuthBypass({
        NEXT_PUBLIC_DEV_AUTH_BYPASS: "1",
        NODE_ENV: "development",
      }),
    ).toBe(true);
  });

  it("actif aussi en NODE_ENV=test (tout sauf production)", () => {
    expect(
      computeDevAuthBypass({
        NEXT_PUBLIC_DEV_AUTH_BYPASS: "1",
        NODE_ENV: "test",
      }),
    ).toBe(true);
  });

  it("inactif si la var est absente, même hors production", () => {
    expect(
      computeDevAuthBypass({ NODE_ENV: "development" }),
    ).toBe(false);
  });

  it("inactif pour toute valeur de var différente de la chaîne exacte \"1\"", () => {
    for (const v of ["0", "", "true", "yes", "1 ", " 1", "01", "ON"]) {
      expect(
        computeDevAuthBypass({
          NEXT_PUBLIC_DEV_AUTH_BYPASS: v,
          NODE_ENV: "development",
        }),
      ).toBe(false);
    }
  });

  it("inactif si NODE_ENV=production quelle que soit la var (balayage)", () => {
    for (const v of ["1", "0", undefined, "true"]) {
      expect(
        computeDevAuthBypass({
          NEXT_PUBLIC_DEV_AUTH_BYPASS: v,
          NODE_ENV: "production",
        }),
      ).toBe(false);
    }
  });

  it("inactif si les deux conditions manquent (défaut sûr)", () => {
    expect(computeDevAuthBypass({})).toBe(false);
  });
});
