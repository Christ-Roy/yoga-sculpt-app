import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests de la capture du code de parrainage `?ref=` → cookies, faite par le
 * MIDDLEWARE (src/middleware.ts), PAS par le render de login/page.tsx.
 *
 * Pourquoi le middleware : écrire un cookie pendant le rendu d'une page (Server
 * Component, GET) est interdit par Next 16 et lève un 500 sur le runtime
 * Cloudflare Workers (« Cookies can only be modified in a Server Action or
 * Route Handler »). Le middleware écrit légitimement sur la NextResponse.
 *
 * Vérifie le maillon d'entrée du parrainage (le filleul arrive sur
 * `/login?ref=<CODE>`) :
 *   - un code VALIDE pose DEUX cookies : `ys_ref` (httpOnly, lu par le callback
 *     serveur) ET `ys_ref_pub` (JS-lisible, lu par le FingerprintCollector) ;
 *   - attributs de sécurité corrects (sameSite=lax pour survivre au redirect
 *     OAuth, path=/, maxAge borné, secure en prod) ;
 *   - un code INVALIDE / absent ne pose AUCUN cookie (pas d'injection de valeur).
 *
 * On mocke `updateSession` pour qu'il rende une NextResponse "vierge" : le
 * middleware doit y déposer (ou non) les cookies de parrainage.
 */

import { NextRequest, NextResponse } from "next/server";

// updateSession ne doit rien faire d'autre que rendre une réponse passante :
// on isole ainsi la logique de dépôt du cookie de parrainage.
vi.mock("@/lib/supabase/proxy", () => ({
  updateSession: vi.fn(async () => NextResponse.next()),
}));

type SetCall = {
  name: string;
  value: string;
  options: Record<string, unknown>;
};

/** Lit les cookies posés par le middleware sur la réponse. */
function cookiesPosees(res: NextResponse): SetCall[] {
  return res.cookies.getAll().map((c) => ({
    name: c.name,
    value: c.value,
    options: c as unknown as Record<string, unknown>,
  }));
}

async function runMiddleware(ref?: string): Promise<NextResponse> {
  const { middleware } = await import("@/middleware");
  const url = ref
    ? `https://app.yoga-sculpt.fr/login?ref=${ref}`
    : "https://app.yoga-sculpt.fr/login";
  const req = new NextRequest(url);
  return (await middleware(req)) as NextResponse;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("middleware — capture du cookie de parrainage `?ref=`", () => {
  it("pose ys_ref (httpOnly) ET ys_ref_pub (JS-lisible) sur un code valide", async () => {
    const res = await runMiddleware("ABCD2345");
    const setCalls = cookiesPosees(res);

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
    const setCalls = cookiesPosees(await runMiddleware("abcd2345"));
    expect(setCalls.find((c) => c.name === "ys_ref")?.value).toBe("ABCD2345");
    expect(setCalls.find((c) => c.name === "ys_ref_pub")?.value).toBe("ABCD2345");
  });

  it("ne pose AUCUN cookie de parrainage sans param ?ref=", async () => {
    const setCalls = cookiesPosees(await runMiddleware(undefined));
    expect(setCalls.find((c) => c.name.startsWith("ys_ref"))).toBeUndefined();
  });

  it("ne pose AUCUN cookie sur un code invalide (anti-injection)", async () => {
    const setCalls = cookiesPosees(
      await runMiddleware(encodeURIComponent("<script>alert(1)</script>")),
    );
    expect(setCalls.find((c) => c.name.startsWith("ys_ref"))).toBeUndefined();
  });

  it("ne pose AUCUN cookie sur un code de longueur incorrecte", async () => {
    const setCalls = cookiesPosees(await runMiddleware("ABC"));
    expect(setCalls.find((c) => c.name.startsWith("ys_ref"))).toBeUndefined();
  });

  it("marque les cookies secure en production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const setCalls = cookiesPosees(await runMiddleware("ABCD2345"));
    expect(setCalls.find((c) => c.name === "ys_ref")?.options.secure).toBe(true);
    expect(setCalls.find((c) => c.name === "ys_ref_pub")?.options.secure).toBe(
      true,
    );
  });
});
