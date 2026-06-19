import { describe, it, expect } from "vitest";
import { safeInternalRedirect } from "@/lib/auth-redirect";

/**
 * Tests de lib/auth-redirect — garde anti open-redirect sur le `redirectTo`
 * client-contrôlé (auth/callback, auth/confirm).
 *
 * Le vecteur clé : un `startsWith("/")` naïf laisse passer `//evil.com`
 * (protocol-relative) et `/\evil.com` (backslash assimilé à `/`), qui résolvent
 * vers un host externe. On vérifie que ces formes retombent sur le fallback.
 */
describe("safeInternalRedirect", () => {
  const FALLBACK = "/espace";

  it("accepte un chemin interne légitime", () => {
    expect(safeInternalRedirect("/espace/reserver", FALLBACK)).toBe(
      "/espace/reserver",
    );
    expect(safeInternalRedirect("/checkout?formule=collectif", FALLBACK)).toBe(
      "/checkout?formule=collectif",
    );
    expect(safeInternalRedirect("/", FALLBACK)).toBe("/");
  });

  it("rejette l'open-redirect protocol-relative `//host`", () => {
    expect(safeInternalRedirect("//evil.com", FALLBACK)).toBe(FALLBACK);
    expect(safeInternalRedirect("//evil.com/phish", FALLBACK)).toBe(FALLBACK);
    expect(safeInternalRedirect("///evil.com", FALLBACK)).toBe(FALLBACK);
  });

  it("rejette le backslash `/\\host` (traité comme `//` par les navigateurs)", () => {
    expect(safeInternalRedirect("/\\evil.com", FALLBACK)).toBe(FALLBACK);
    expect(safeInternalRedirect("/\\/evil.com", FALLBACK)).toBe(FALLBACK);
  });

  it("rejette une URL absolue externe (schéma explicite)", () => {
    expect(safeInternalRedirect("https://evil.com", FALLBACK)).toBe(FALLBACK);
    expect(safeInternalRedirect("http://evil.com", FALLBACK)).toBe(FALLBACK);
    expect(safeInternalRedirect("javascript:alert(1)", FALLBACK)).toBe(FALLBACK);
  });

  it("rejette un chemin relatif sans `/` initial", () => {
    expect(safeInternalRedirect("espace", FALLBACK)).toBe(FALLBACK);
    expect(safeInternalRedirect("evil.com", FALLBACK)).toBe(FALLBACK);
  });

  it("retombe sur le fallback pour les valeurs vides / absentes", () => {
    expect(safeInternalRedirect(null, FALLBACK)).toBe(FALLBACK);
    expect(safeInternalRedirect(undefined, FALLBACK)).toBe(FALLBACK);
    expect(safeInternalRedirect("", FALLBACK)).toBe(FALLBACK);
  });
});
