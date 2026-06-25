import { describe, it, expect } from "vitest";
import { computeAuthCookieDomain } from "@/lib/supabase/cookie-domain";

/**
 * Tests de la dérivation du `Domain` du cookie de session Supabase
 * (src/lib/supabase/cookie-domain.ts).
 *
 * Invariants CRITIQUES (auth) :
 *  - DEV/LOCAL → AUCUN domain (undefined) : poser `.yoga-sculpt.fr` en localhost
 *    casserait le cookie (mismatch domaine, rejet navigateur). Le cookie host-only
 *    par défaut DOIT rester en dev.
 *  - PROD → domaine parent (`.yoga-sculpt.fr`) dérivé du host de NEXT_PUBLIC_APP_URL,
 *    pour le partage cross-domaine vitrine (apex) ↔ app (sous-domaine).
 *
 * On teste la FONCTION PURE `computeAuthCookieDomain(env)` (pas le drapeau global
 * figé au chargement) → déterministe, sans tripoter process.env.
 */
describe("computeAuthCookieDomain — scope cookie session (prod-only)", () => {
  it("🔴 DEV : NODE_ENV != production → AUCUN domain (host-only), quelle que soit l'URL", () => {
    for (const NODE_ENV of ["development", "test", undefined]) {
      expect(
        computeAuthCookieDomain({
          NODE_ENV,
          NEXT_PUBLIC_APP_URL: "https://app.yoga-sculpt.fr",
        }),
      ).toBeUndefined();
    }
  });

  it("PROD + sous-domaine `app.yoga-sculpt.fr` → `.yoga-sculpt.fr` (retire le 1er label)", () => {
    expect(
      computeAuthCookieDomain({
        NODE_ENV: "production",
        NEXT_PUBLIC_APP_URL: "https://app.yoga-sculpt.fr",
      }),
    ).toBe(".yoga-sculpt.fr");
  });

  it("PROD + host apex `yoga-sculpt.fr` → `.yoga-sculpt.fr` (point de tête)", () => {
    expect(
      computeAuthCookieDomain({
        NODE_ENV: "production",
        NEXT_PUBLIC_APP_URL: "https://yoga-sculpt.fr",
      }),
    ).toBe(".yoga-sculpt.fr");
  });

  it("PROD + URL absente → fallback `.yoga-sculpt.fr`", () => {
    expect(
      computeAuthCookieDomain({ NODE_ENV: "production" }),
    ).toBe(".yoga-sculpt.fr");
  });

  it("PROD + URL malformée → fallback `.yoga-sculpt.fr`", () => {
    expect(
      computeAuthCookieDomain({
        NODE_ENV: "production",
        NEXT_PUBLIC_APP_URL: "pas-une-url",
      }),
    ).toBe(".yoga-sculpt.fr");
  });

  it("PROD + host=localhost → AUCUN domain (pas de domaine parent enregistrable)", () => {
    expect(
      computeAuthCookieDomain({
        NODE_ENV: "production",
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      }),
    ).toBeUndefined();
  });

  it("PROD + host=IP → AUCUN domain", () => {
    expect(
      computeAuthCookieDomain({
        NODE_ENV: "production",
        NEXT_PUBLIC_APP_URL: "http://127.0.0.1:8787",
      }),
    ).toBeUndefined();
  });

  it("PROD + sous-domaine profond (`a.b.yoga-sculpt.fr`) → retire seulement le 1er label", () => {
    expect(
      computeAuthCookieDomain({
        NODE_ENV: "production",
        NEXT_PUBLIC_APP_URL: "https://a.b.yoga-sculpt.fr",
      }),
    ).toBe(".b.yoga-sculpt.fr");
  });
});
