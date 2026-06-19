import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeSupabaseMock, asMockResponse, type MockSupabase } from "../helpers/supabase-mock";

/**
 * Tests de GET /api/creneaux — liste des créneaux COLLECTIFS réservables.
 *
 * ⚠️ Depuis le passage du cours PARTICULIER en créneau LIBRE (2026-06-19), ce
 * endpoint n'expose QUE les collectifs : les events « particulier » (créés par
 * les réservations libres) sont FILTRÉS pour ne pas réapparaître comme créneaux
 * réservables. Le particulier passe par /api/creneaux/particulier.
 *
 * Comportements clés couverts :
 *   - 401 sans auth ;
 *   - liste les créneaux COLLECTIFS futurs depuis Google Calendar (mocké),
 *     filtre les events annulés/invalides ET les events particulier ;
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
    // Lieu renseigné côté Google → doit être exposé tel quel dans `creneau.lieu`.
    location: "Studio Bellecour, 69002 Lyon",
    start: { dateTime: "2026-07-01T17:00:00.000Z" },
    end: { dateTime: "2026-07-01T18:00:00.000Z" },
  },
  {
    // Lieu NON renseigné (champ « Lieu » oublié par Alice) → `lieu` undefined,
    // le créneau reste exposé (l'UI affichera « Lieu à confirmer »).
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

  it("liste les créneaux COLLECTIFS futurs, filtre les annulés ET les particuliers", async () => {
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

    // L'event annulé ET l'event particulier sont exclus → 1 seul collectif.
    expect(creneaux).toHaveLength(1);
    expect(creneaux.map((c) => c.id)).toEqual(["evt-collectif"]);

    const collectif = creneaux.find((c) => c.id === "evt-collectif");
    expect(collectif?.type).toBe("collectif");
    expect(collectif?.inscrits).toBe(1);

    // Le particulier ne doit JAMAIS apparaître dans /api/creneaux.
    expect(creneaux.find((c) => c.id === "evt-particulier")).toBeUndefined();
  });

  it("expose le lieu (location Google) du collectif quand il est renseigné", async () => {
    const { GET } = await import("@/app/api/creneaux/route");
    const res = asMockResponse(await GET());

    expect(res.status).toBe(200);
    const creneaux = (
      res.body as { creneaux: Array<{ id: string; lieu?: string }> }
    ).creneaux;

    // Lieu repris tel quel du champ `location` Google.
    expect(creneaux.find((c) => c.id === "evt-collectif")?.lieu).toBe(
      "Studio Bellecour, 69002 Lyon",
    );
  });

  it("agrège correctement plusieurs inscrits sur le même créneau collectif", async () => {
    serviceMock.queueResult("bookings", "select", {
      data: [
        { google_calendar_creneau_id: "evt-collectif" },
        { google_calendar_creneau_id: "evt-collectif" },
      ],
      error: null,
    });
    const { GET } = await import("@/app/api/creneaux/route");
    const res = asMockResponse(await GET());
    const creneaux = (res.body as { creneaux: Array<{ id: string; inscrits: number }> }).creneaux;
    expect(creneaux.find((c) => c.id === "evt-collectif")?.inscrits).toBe(2);
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
