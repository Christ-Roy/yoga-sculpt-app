import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  makeSupabaseMock,
  asMockResponse,
  type MockSupabase,
} from "../helpers/supabase-mock";

/**
 * Tests de /api/parrainage/partage — tracking best-effort d'un partage de lien.
 *
 * Comportements clés couverts :
 *   - 401 sans authentification ;
 *   - 204 (No Content) quand authentifié → journalise `referral_invited`
 *     (metadata `via:"share"`, source `share`) SANS créer de referral ;
 *   - le tracking est best-effort : même si l'écriture user_events échoue, on
 *     renvoie 204 (logEvent ne throw jamais) ;
 *   - GET → 405 (méthode non autorisée).
 *
 * Dépendances externes mockées : Supabase (server + service via logEvent).
 * Aucun appel réseau réel.
 */

vi.mock("next/server", () => ({
  NextResponse: Object.assign(
    // Constructeur `new NextResponse(body, init)` → expose body/status observables.
    vi.fn((body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    })),
    {
      json: vi.fn((body: unknown, init?: { status?: number }) => ({
        body,
        status: init?.status ?? 200,
      })),
    },
  ),
}));

let serverMock: MockSupabase;
let serviceMock: MockSupabase;

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => serverMock.client),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => serviceMock.client),
}));

const USER = { id: "parrain-1", email: "parrain@example.com", user_metadata: {} };

beforeEach(() => {
  vi.clearAllMocks();
  serverMock = makeSupabaseMock(USER);
  serviceMock = makeSupabaseMock(USER);
  // Silence les console.error best-effort éventuels (logEvent fail-safe).
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/parrainage/partage", () => {
  it("renvoie 401 sans authentification", async () => {
    serverMock = makeSupabaseMock(null);
    const { POST } = await import("@/app/api/parrainage/partage/route");
    const res = asMockResponse(await POST());
    expect(res.status).toBe(401);
    // Aucun event journalisé sans auth.
    expect(serviceMock.calls.length).toBe(0);
  });

  it("renvoie 204 et journalise referral_invited (via:share) sans créer de referral", async () => {
    const { POST } = await import("@/app/api/parrainage/partage/route");
    const res = asMockResponse(await POST());

    expect(res.status).toBe(204);

    // Un event referral_invited a été inséré dans user_events…
    const insert = serviceMock.calls.find(
      (c) => c.table === "user_events" && c.op === "insert",
    );
    expect(insert).toBeDefined();
    expect(insert?.payload).toMatchObject({
      user_id: USER.id,
      event_type: "referral_invited",
      metadata: { via: "share" },
      source: "share",
    });

    // …et AUCUNE écriture sur la table referrals (zéro impact idempotence).
    const referralWrite = serviceMock.calls.find((c) => c.table === "referrals");
    expect(referralWrite).toBeUndefined();
  });

  it("reste 204 même si l'écriture user_events échoue (best-effort)", async () => {
    serviceMock.queueResult("user_events", "insert", {
      data: null,
      error: { code: "XX000", message: "db indisponible" },
    });

    const { POST } = await import("@/app/api/parrainage/partage/route");
    const res = asMockResponse(await POST());
    expect(res.status).toBe(204);
  });
});

describe("GET /api/parrainage/partage", () => {
  it("renvoie 405 (méthode non autorisée)", async () => {
    const { GET } = await import("@/app/api/parrainage/partage/route");
    const res = asMockResponse(GET());
    expect(res.status).toBe(405);
  });
});
