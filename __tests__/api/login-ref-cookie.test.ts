import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests de login/page.tsx — capture du code de parrainage `?ref=` en cookies.
 *
 * Vérifie le maillon d'entrée du parrainage (le filleul arrive sur
 * `/login?ref=<CODE>`) :
 *   - un code VALIDE pose DEUX cookies : `ys_ref` (httpOnly, lu par le callback
 *     serveur) ET `ys_ref_pub` (JS-lisible, lu par le FingerprintCollector) ;
 *   - les attributs de sécurité sont corrects (sameSite=lax pour survivre au
 *     redirect OAuth, path=/, maxAge borné) ;
 *   - un code INVALIDE / absent ne pose AUCUN cookie (pas d'injection de valeur).
 *
 * On rend la page (Server Component async) en mockant ses enfants (composants
 * client) et `next/headers` pour intercepter les écritures de cookies. On
 * n'assert PAS sur le JSX : seul l'effet de bord cookie compte.
 */

// Composants enfants mockés (évite de tirer du code "use client" en env node).
vi.mock("@/components/Logo", () => ({ Logo: () => null }));
vi.mock("@/app/login/LoginForm", () => ({ LoginForm: () => null }));

type SetCall = {
  name: string;
  value: string;
  options: Record<string, unknown>;
};

let setCalls: SetCall[];

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    set: (name: string, value: string, options: Record<string, unknown>) => {
      setCalls.push({ name, value, options });
    },
  })),
}));

beforeEach(() => {
  setCalls = [];
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function renderWith(ref?: string) {
  const { default: LoginPage } = await import("@/app/login/page");
  // searchParams est une Promise en Next 16.
  await LoginPage({ searchParams: Promise.resolve(ref ? { ref } : {}) });
}

describe("login/page.tsx — capture du cookie de parrainage", () => {
  it("pose ys_ref (httpOnly) ET ys_ref_pub (JS-lisible) sur un code valide", async () => {
    await renderWith("ABCD2345");

    const ysRef = setCalls.find((c) => c.name === "ys_ref");
    const ysRefPub = setCalls.find((c) => c.name === "ys_ref_pub");

    expect(ysRef).toBeDefined();
    expect(ysRef?.value).toBe("ABCD2345");
    expect(ysRef?.options.httpOnly).toBe(true);
    expect(ysRef?.options.sameSite).toBe("lax");
    expect(ysRef?.options.path).toBe("/");
    expect(typeof ysRef?.options.maxAge).toBe("number");
    expect(ysRef?.options.maxAge as number).toBeGreaterThan(0);

    expect(ysRefPub).toBeDefined();
    expect(ysRefPub?.value).toBe("ABCD2345");
    expect(ysRefPub?.options.httpOnly).toBe(false);
    expect(ysRefPub?.options.sameSite).toBe("lax");
    expect(ysRefPub?.options.path).toBe("/");
  });

  it("normalise un code en minuscules avant de le poser", async () => {
    await renderWith("abcd2345");
    expect(setCalls.find((c) => c.name === "ys_ref")?.value).toBe("ABCD2345");
    expect(setCalls.find((c) => c.name === "ys_ref_pub")?.value).toBe("ABCD2345");
  });

  it("ne pose AUCUN cookie sans param ?ref=", async () => {
    await renderWith(undefined);
    expect(setCalls).toHaveLength(0);
  });

  it("ne pose AUCUN cookie sur un code invalide (anti-injection)", async () => {
    await renderWith("<script>alert(1)</script>");
    expect(setCalls).toHaveLength(0);
  });

  it("ne pose AUCUN cookie sur un code de longueur incorrecte", async () => {
    await renderWith("ABC");
    expect(setCalls).toHaveLength(0);
  });

  it("marque les cookies secure en production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await renderWith("ABCD2345");
    expect(setCalls.find((c) => c.name === "ys_ref")?.options.secure).toBe(true);
    expect(setCalls.find((c) => c.name === "ys_ref_pub")?.options.secure).toBe(
      true,
    );
  });
});
