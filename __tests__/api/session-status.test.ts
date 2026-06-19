import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  makeSupabaseMock,
  type MockSupabase,
} from "../helpers/supabase-mock";

/**
 * Tests de /api/session-status — détection d'auth CROSS-DOMAINE pour la vitrine.
 *
 * Comportements clés couverts :
 *   - GET non connecté → 200 { authed:false } + headers CORS si origine listée ;
 *   - GET connecté → 200 { authed:true, prenom } (prénom dérivé du profil) ;
 *   - GET connecté SANS prénom exploitable → 200 { authed:true } (pas de clé prenom) ;
 *   - origine NON listée → aucun header Access-Control-Allow-Origin ;
 *   - jamais `*` quand on autorise (credentials) — origine reflétée à l'identique ;
 *   - OPTIONS (préflight) → 204 + headers CORS.
 *
 * ┌─ Mock NextResponse ────────────────────────────────────────────────────────┐
 * │ Le mock partagé `makeSupabaseMock` suffit pour Supabase. Pour NextResponse, │
 * │ on a besoin d'OBSERVER LES HEADERS (cœur du test CORS) : on mocke donc      │
 * │ `NextResponse.json` ET le constructeur `new NextResponse(...)` pour exposer │
 * │ `{ body, status, headers }` (headers = vrai objet Headers, lisible).        │
 * └─────────────────────────────────────────────────────────────────────────────┘
 */

interface ObservedResponse {
  body: unknown;
  status: number;
  headers: Headers;
}

vi.mock("next/server", () => {
  // Constructeur mocké : `new NextResponse(body, init)` (utilisé par OPTIONS).
  const NextResponse = vi.fn(function (
    this: ObservedResponse,
    body: unknown,
    init?: { status?: number; headers?: Headers },
  ) {
    this.body = body;
    this.status = init?.status ?? 200;
    this.headers = init?.headers ?? new Headers();
  }) as unknown as {
    new (body: unknown, init?: { status?: number; headers?: Headers }): ObservedResponse;
    json: (body: unknown, init?: { status?: number; headers?: Headers }) => ObservedResponse;
  };

  NextResponse.json = vi.fn(
    (body: unknown, init?: { status?: number; headers?: Headers }) => ({
      body,
      status: init?.status ?? 200,
      headers: init?.headers ?? new Headers(),
    }),
  );

  return { NextResponse };
});

let serverMock: MockSupabase;
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => serverMock.client),
}));

const VITRINE = "https://yoga-sculpt.fr";
const VITRINE_WWW = "https://www.yoga-sculpt.fr";

function makeReq(headers: Record<string, string> = {}): Request {
  return {
    headers: {
      get: (k: string) => headers[k.toLowerCase()] ?? null,
    },
  } as unknown as Request;
}

function asObserved(res: unknown): ObservedResponse {
  return res as ObservedResponse;
}

beforeEach(() => {
  vi.clearAllMocks();
  serverMock = makeSupabaseMock(null);
  // Aligne l'allowlist sur l'origine vitrine de prod.
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://yoga-sculpt.fr");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/session-status", () => {
  it("non connecté → 200 { authed:false } + CORS reflète l'origine vitrine", async () => {
    const { GET } = await import("@/app/api/session-status/route");
    const res = asObserved(await GET(makeReq({ origin: VITRINE })));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authed: false });
    // Origine reflétée à l'identique (PAS `*` avec credentials).
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(VITRINE);
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(res.headers.get("Vary")).toBe("Origin");
  });

  it("reflète aussi la variante www.", async () => {
    const { GET } = await import("@/app/api/session-status/route");
    const res = asObserved(await GET(makeReq({ origin: VITRINE_WWW })));
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(VITRINE_WWW);
  });

  it("connecté → 200 { authed:true, prenom } (prénom dérivé du full_name profil)", async () => {
    serverMock = makeSupabaseMock({ id: "user-1", email: "a@b.fr", user_metadata: {} });
    serverMock.queueResult("profiles", "select", {
      data: { full_name: "Alice Gaudry" },
      error: null,
    });

    const { GET } = await import("@/app/api/session-status/route");
    const res = asObserved(await GET(makeReq({ origin: VITRINE })));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authed: true, prenom: "Alice" });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(VITRINE);
  });

  it("connecté mais full_name absent → fallback metadata.name", async () => {
    serverMock = makeSupabaseMock({
      id: "user-1",
      email: "a@b.fr",
      user_metadata: { name: "Bob Martin" },
    });
    serverMock.queueResult("profiles", "select", {
      data: { full_name: null },
      error: null,
    });

    const { GET } = await import("@/app/api/session-status/route");
    const res = asObserved(await GET(makeReq({ origin: VITRINE })));

    expect(res.body).toEqual({ authed: true, prenom: "Bob" });
  });

  it("connecté sans prénom exploitable → 200 { authed:true } (pas de clé prenom)", async () => {
    serverMock = makeSupabaseMock({ id: "user-1", email: "a@b.fr", user_metadata: {} });
    serverMock.queueResult("profiles", "select", {
      data: { full_name: null },
      error: null,
    });

    const { GET } = await import("@/app/api/session-status/route");
    const res = asObserved(await GET(makeReq({ origin: VITRINE })));

    expect(res.body).toEqual({ authed: true });
    expect((res.body as { prenom?: string }).prenom).toBeUndefined();
  });

  it("origine NON autorisée → aucun header Access-Control-Allow-Origin", async () => {
    const { GET } = await import("@/app/api/session-status/route");
    const res = asObserved(await GET(makeReq({ origin: "https://evil.example.com" })));

    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    // Vary: Origin reste posé même pour une origine non listée (anti cache-poison).
    expect(res.headers.get("Vary")).toBe("Origin");
  });

  it("ne renvoie JAMAIS `*` comme Allow-Origin (incompatible credentials)", async () => {
    const { GET } = await import("@/app/api/session-status/route");
    const res = asObserved(await GET(makeReq({ origin: VITRINE })));
    expect(res.headers.get("Access-Control-Allow-Origin")).not.toBe("*");
  });
});

describe("OPTIONS /api/session-status", () => {
  it("préflight → 204 + headers CORS (origine listée reflétée)", async () => {
    const { OPTIONS } = await import("@/app/api/session-status/route");
    const res = asObserved(OPTIONS(makeReq({ origin: VITRINE })));

    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(VITRINE);
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
  });

  it("préflight d'une origine non listée → 204 sans Allow-Origin", async () => {
    const { OPTIONS } = await import("@/app/api/session-status/route");
    const res = asObserved(OPTIONS(makeReq({ origin: "https://evil.example.com" })));
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
