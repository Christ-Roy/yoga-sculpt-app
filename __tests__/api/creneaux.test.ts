import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeSupabaseMock, asMockResponse, type MockSupabase } from "../helpers/supabase-mock";

/**
 * Tests de GET /api/creneaux — liste des créneaux réservables.
 *
 * Comportements clés couverts :
 *   - 401 sans auth ;
 *   - liste les créneaux futurs depuis Google Calendar (mocké), déduit le type,
 *     filtre les events annulés/invalides ;
 *   - comptabilise les inscrits (bookings confirmés) par créneau ;
 *   - 502 si Google Calendar échoue ;
 *   - reste robuste (inscrits=0) si le comptage des bookings échoue.
 */

vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    })),
  },
}));

let serverMock: MockSupabase;
let serviceMock: MockSupabase;
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => serverMock.client),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => serviceMock.client),
}));

const listEventsMock = vi.fn();
vi.mock("@/lib/google-calendar", () => ({
  listEvents: (...args: unknown[]) => listEventsMock(...args),
}));

const USER = { id: "user-1", email: "cliente@example.com", user_metadata: {} };

const EVENTS = [
  {
    id: "evt-collectif",
    status: "confirmed",
    summary: "Cours collectif — Yoga Sculpt",
    start: { dateTime: "2026-07-01T17:00:00.000Z" },
    end: { dateTime: "2026-07-01T18:00:00.000Z" },
  },
  {
    id: "evt-particulier",
    status: "confirmed",
    summary: "Cours particulier — Yoga Sculpt",
    start: { dateTime: "2026-07-02T09:00:00.000Z" },
    end: { dateTime: "2026-07-02T10:00:00.000Z" },
  },
  {
    // Annulé → doit être filtré.
    id: "evt-annule",
    status: "cancelled",
    summary: "Cours collectif annulé",
    start: { dateTime: "2026-07-03T17:00:00.000Z" },
    end: { dateTime: "2026-07-03T18:00:00.000Z" },
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  serverMock = makeSupabaseMock(USER);
  serviceMock = makeSupabaseMock(USER);
  listEventsMock.mockResolvedValue(EVENTS);
});

describe("GET /api/creneaux", () => {
  it("renvoie 401 sans authentification", async () => {
    serverMock = makeSupabaseMock(null);
    const { GET } = await import("@/app/api/creneaux/route");
    const res = asMockResponse(await GET());
    expect(res.status).toBe(401);
  });

  it("liste les créneaux futurs, déduit le type et filtre les annulés", async () => {
    // 1 booking confirmé sur le créneau collectif.
    serviceMock.queueResult("bookings", "select", {
      data: [{ google_calendar_creneau_id: "evt-collectif" }],
      error: null,
    });

    const { GET } = await import("@/app/api/creneaux/route");
    const res = asMockResponse(await GET());

    expect(res.status).toBe(200);
    const creneaux = (res.body as { creneaux: Array<{ id: string; type: string; inscrits: number }> })
      .creneaux;

    // L'event annulé est exclu → 2 créneaux exposés.
    expect(creneaux).toHaveLength(2);
    expect(creneaux.map((c) => c.id)).toEqual(["evt-collectif", "evt-particulier"]);

    const collectif = creneaux.find((c) => c.id === "evt-collectif");
    expect(collectif?.type).toBe("collectif");
    expect(collectif?.inscrits).toBe(1);

    const particulier = creneaux.find((c) => c.id === "evt-particulier");
    expect(particulier?.type).toBe("particulier");
    expect(particulier?.inscrits).toBe(0);
  });

  it("agrège correctement plusieurs inscrits sur le même créneau", async () => {
    serviceMock.queueResult("bookings", "select", {
      data: [
        { google_calendar_creneau_id: "evt-collectif" },
        { google_calendar_creneau_id: "evt-collectif" },
        { google_calendar_creneau_id: "evt-particulier" },
      ],
      error: null,
    });
    const { GET } = await import("@/app/api/creneaux/route");
    const res = asMockResponse(await GET());
    const creneaux = (res.body as { creneaux: Array<{ id: string; inscrits: number }> }).creneaux;
    expect(creneaux.find((c) => c.id === "evt-collectif")?.inscrits).toBe(2);
    expect(creneaux.find((c) => c.id === "evt-particulier")?.inscrits).toBe(1);
  });

  it("renvoie 502 si Google Calendar échoue", async () => {
    listEventsMock.mockRejectedValueOnce(new Error("Google down"));
    const { GET } = await import("@/app/api/creneaux/route");
    const res = asMockResponse(await GET());
    expect(res.status).toBe(502);
  });

  it("reste robuste (inscrits=0) si le comptage des bookings échoue", async () => {
    serviceMock.queueResult("bookings", "select", {
      data: null,
      error: { message: "boom" },
    });
    const { GET } = await import("@/app/api/creneaux/route");
    const res = asMockResponse(await GET());
    expect(res.status).toBe(200);
    const creneaux = (res.body as { creneaux: Array<{ inscrits: number }> }).creneaux;
    expect(creneaux.every((c) => c.inscrits === 0)).toBe(true);
  });
});
