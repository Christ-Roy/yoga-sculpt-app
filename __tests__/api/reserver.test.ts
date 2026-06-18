import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeSupabaseMock, asMockResponse, type MockSupabase } from "../helpers/supabase-mock";

/**
 * Tests de POST /api/reserver — moteur de réservation maison.
 *
 * Comportements clés couverts :
 *   - 401 sans auth ;
 *   - 402 sans ticket du bon type (achat requis) ;
 *   - 409 double-booking (violation d'unicité Postgres 23505) ;
 *   - 200 happy path + DÉCRÉMENT effectif du ticket (assertion sur le payload update) ;
 *   - 409 si la course sur le décrément est perdue (0 ligne touchée) + rollback booking.
 *
 * Dépendances externes mockées : Supabase (server + service) et google-calendar.
 * Aucun appel réseau réel.
 */

// ── Mock NextResponse : on récupère { body, status } sans vrai objet Response. ──
vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    })),
  },
}));

// ── Mocks Supabase : réinjectés à chaque test via les variables ci-dessous. ────
let serverMock: MockSupabase;
let serviceMock: MockSupabase;

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => serverMock.client),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => serviceMock.client),
}));

// ── Mock google-calendar : getEvent / patchEvent contrôlés par test. ──────────
const getEventMock = vi.fn();
const patchEventMock = vi.fn();
vi.mock("@/lib/google-calendar", () => ({
  getEvent: (...args: unknown[]) => getEventMock(...args),
  patchEvent: (...args: unknown[]) => patchEventMock(...args),
}));

const USER = { id: "user-1", email: "cliente@example.com", user_metadata: {} };
const CRENEAU_ID = "creneau-abc";

// Event Google "collectif" valide (futur).
const EVENT_OK = {
  id: CRENEAU_ID,
  status: "confirmed" as const,
  summary: "Cours collectif — Yoga Sculpt",
  start: { dateTime: "2026-07-01T17:00:00.000Z" },
  end: { dateTime: "2026-07-01T18:00:00.000Z" },
  attendees: [],
};

const TICKET = {
  id: "ticket-1",
  user_id: USER.id,
  type: "collectif",
  quantite_initiale: 10,
  quantite_restante: 4,
  stripe_payment_id: null,
  stripe_session_id: null,
  expires_at: null,
  created_at: "2026-06-01T00:00:00.000Z",
};

function makeReq(body: unknown): Request {
  return {
    json: async () => body,
  } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  serverMock = makeSupabaseMock(USER);
  serviceMock = makeSupabaseMock(USER);
  getEventMock.mockResolvedValue(EVENT_OK);
  patchEventMock.mockResolvedValue(undefined);
});

describe("POST /api/reserver", () => {
  it("renvoie 401 sans authentification", async () => {
    serverMock = makeSupabaseMock(null); // pas d'utilisateur
    const { POST } = await import("@/app/api/reserver/route");
    const res = asMockResponse(await POST(makeReq({ creneauId: CRENEAU_ID })));
    expect(res.status).toBe(401);
  });

  it("renvoie 400 sur un corps invalide (champ inconnu / creneauId manquant)", async () => {
    const { POST } = await import("@/app/api/reserver/route");
    const res = asMockResponse(await POST(makeReq({ wrong: "x" })));
    expect(res.status).toBe(400);
  });

  it("renvoie 402 (needsPurchase) quand aucun ticket du bon type n'est disponible", async () => {
    // Lecture tickets → liste vide.
    serviceMock.queueResult("tickets", "select", { data: [], error: null });
    const { POST } = await import("@/app/api/reserver/route");
    const res = asMockResponse(await POST(makeReq({ creneauId: CRENEAU_ID })));
    expect(res.status).toBe(402);
    expect((res.body as { needsPurchase?: boolean }).needsPurchase).toBe(true);
    expect((res.body as { type?: string }).type).toBe("collectif");
  });

  it("renvoie 404 si le créneau Google est introuvable", async () => {
    getEventMock.mockRejectedValueOnce(new Error("Google API HTTP 404 Not Found"));
    const { POST } = await import("@/app/api/reserver/route");
    const res = asMockResponse(await POST(makeReq({ creneauId: CRENEAU_ID })));
    expect(res.status).toBe(404);
  });

  it("renvoie 409 sur double-booking (violation d'unicité Postgres 23505)", async () => {
    serviceMock.queueResult("tickets", "select", { data: [TICKET], error: null });
    // Insert booking → erreur unique violation.
    serviceMock.queueResult("bookings", "insert", {
      data: null,
      error: { code: "23505", message: "duplicate key value" },
    });
    const { POST } = await import("@/app/api/reserver/route");
    const res = asMockResponse(await POST(makeReq({ creneauId: CRENEAU_ID })));
    expect(res.status).toBe(409);
  });

  it("happy path : 200, booking renvoyé, ticket DÉCRÉMENTÉ et attendee Google ajouté", async () => {
    serviceMock.queueResult("tickets", "select", { data: [TICKET], error: null });
    const bookingRow = {
      id: "booking-1",
      user_id: USER.id,
      type: "collectif",
      google_event_id: CRENEAU_ID,
      google_calendar_creneau_id: CRENEAU_ID,
      starts_at: EVENT_OK.start.dateTime,
      ends_at: EVENT_OK.end.dateTime,
      status: "confirmed",
      ticket_id: TICKET.id,
      created_at: "2026-06-20T00:00:00.000Z",
      cancelled_at: null,
    };
    serviceMock.queueResult("bookings", "insert", { data: bookingRow, error: null });
    // Décrément ticket → 1 ligne touchée (succès).
    serviceMock.queueResult("tickets", "update", {
      data: { id: TICKET.id },
      error: null,
    });

    const { POST } = await import("@/app/api/reserver/route");
    const res = asMockResponse(await POST(makeReq({ creneauId: CRENEAU_ID })));

    expect(res.status).toBe(200);
    expect((res.body as { ok?: boolean }).ok).toBe(true);
    expect((res.body as { booking?: { id: string } }).booking?.id).toBe("booking-1");

    // Le décrément doit être quantite_restante - 1 (4 → 3).
    const updateCall = serviceMock.calls.find(
      (c) => c.table === "tickets" && c.op === "update",
    );
    expect(updateCall?.payload).toEqual({ quantite_restante: 3 });

    // L'attendee Google a bien été ajouté (PATCH appelé).
    expect(patchEventMock).toHaveBeenCalledTimes(1);
  });

  it("renvoie 409 + rollback du booking si la course sur le décrément est perdue", async () => {
    serviceMock.queueResult("tickets", "select", { data: [TICKET], error: null });
    serviceMock.queueResult("bookings", "insert", {
      data: { id: "booking-2", ...TICKET, status: "confirmed" },
      error: null,
    });
    // Décrément → 0 ligne touchée (maybeSingle renvoie null) = ticket vidé entre-temps.
    serviceMock.queueResult("tickets", "update", { data: null, error: null });

    const { POST } = await import("@/app/api/reserver/route");
    const res = asMockResponse(await POST(makeReq({ creneauId: CRENEAU_ID })));

    expect(res.status).toBe(409);
    // Rollback : un delete sur bookings a bien été émis.
    const deleteCall = serviceMock.calls.find(
      (c) => c.table === "bookings" && c.op === "delete",
    );
    expect(deleteCall).toBeDefined();
    // On n'a PAS inscrit l'attendee Google (rollback avant le PATCH).
    expect(patchEventMock).not.toHaveBeenCalled();
  });
});
