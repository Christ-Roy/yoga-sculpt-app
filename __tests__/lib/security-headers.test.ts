import { describe, it, expect } from "vitest";
import {
  appliquerHeadersSecurite,
  buildCspReportOnly,
} from "@/lib/security-headers";

/**
 * Tests de src/lib/security-headers.ts — en-têtes de sécurité posés par le
 * middleware edge (HSTS / X-Frame / nosniff / Referrer / Permissions + CSP
 * report-only).
 *
 * Couvre :
 *   - tous les en-têtes statiques attendus sont posés, valeurs durcies ;
 *   - HSTS long avec includeSubDomains + preload ;
 *   - X-Frame-Options DENY, nosniff, Referrer strict-origin-when-cross-origin ;
 *   - la CSP est expédiée en REPORT-ONLY (n'applique pas) et contient les
 *     directives clés + les origines réelles (Supabase / Stripe / Google) ;
 *   - idempotence : appeler deux fois donne le même résultat (renforce, écrase).
 */

describe("buildCspReportOnly", () => {
  it("inclut les directives de base verrouillées", () => {
    const csp = buildCspReportOnly();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    // Directive sans valeur (booléenne) rendue seule, sans espace traînant.
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("autorise les origines réelles de l'app (Supabase / Stripe / Google)", () => {
    const csp = buildCspReportOnly();
    // Supabase : auth + REST + realtime.
    expect(csp).toMatch(/connect-src[^;]*https:\/\/\*\.supabase\.co/);
    expect(csp).toMatch(/connect-src[^;]*wss:\/\/\*\.supabase\.co/);
    expect(csp).toMatch(/connect-src[^;]*https:\/\/api\.stripe\.com/);
    // Redirection / POST vers Stripe Checkout.
    expect(csp).toMatch(/form-action[^;]*checkout\.stripe\.com/);
    // Avatars OAuth distants.
    expect(csp).toMatch(/img-src[^;]*googleusercontent\.com/);
  });
});

describe("appliquerHeadersSecurite", () => {
  it("pose tous les en-têtes de sécurité statiques avec les valeurs durcies", () => {
    const h = new Headers();
    appliquerHeadersSecurite(h);

    expect(h.get("Strict-Transport-Security")).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
    expect(h.get("X-Frame-Options")).toBe("DENY");
    expect(h.get("X-Content-Type-Options")).toBe("nosniff");
    expect(h.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(h.get("Permissions-Policy")).toContain("camera=()");
    expect(h.get("Permissions-Policy")).toContain("geolocation=()");
    expect(h.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
  });

  it("expédie la CSP en REPORT-ONLY (observe, ne bloque pas)", () => {
    const h = new Headers();
    appliquerHeadersSecurite(h);

    // L'en-tête bloquant ne doit PAS être posé tant qu'on n'a pas durci.
    expect(h.get("Content-Security-Policy")).toBeNull();
    // L'en-tête report-only, lui, est présent et non vide.
    const ro = h.get("Content-Security-Policy-Report-Only");
    expect(ro).toBeTruthy();
    expect(ro).toBe(buildCspReportOnly());
  });

  it("est idempotent : un 2e appel donne exactement le même résultat", () => {
    const h = new Headers();
    appliquerHeadersSecurite(h);
    const apres1 = JSON.stringify([...h.entries()].sort());
    appliquerHeadersSecurite(h);
    const apres2 = JSON.stringify([...h.entries()].sort());
    expect(apres2).toBe(apres1);
  });

  it("écrase une valeur permissive préexistante (renforce)", () => {
    const h = new Headers();
    h.set("X-Frame-Options", "ALLOWALL");
    appliquerHeadersSecurite(h);
    expect(h.get("X-Frame-Options")).toBe("DENY");
  });
});
