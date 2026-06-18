import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeSupabaseMock, asMockResponse, type MockSupabase } from "../helpers/supabase-mock";

/**
 * Tests de POST /api/annuler — annulation d'une réservation confirmée.
 *
 * Comportements clés couverts :
 *   - 401 sans auth ;
 *   - 403 si le booking n'appartient pas au user ;
 *   - 404 si le booking est introuvable ;
 *   - 409 + tooLate quand le créneau démarre dans MOINS de 24h (garde serveur) ;
 *   - 200 + RECRÉDIT du ticket (assertion sur le payload update +1, plafonné) ;
 *   - 200 idempotent si le booking est déjà annulé.
 *
 * Dépendances mockées : Supabase (server + service) et google-calendar.
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

const getEventMock = vi.fn();
const patchEventMock = vi.fn();
vi.mock("@/lib/google-calendar", () => ({
  getEvent: (...args: unknown[]) => getEventMock(...args),
  patchEvent: (...args: unknown[]) => patchEventMock(...args),
}));

const USER = { id: "user-1", email: "cliente@example.com", user_metadata: {} };

/** Date ISO décalée de `hours` heures par rapport à maintenant. */
function inHours(hours: number): string {
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

/** Booking confirmé qui démarre dans `startsInHours` heures. */
function booking(startsInHours: number, overrides: Record<string, unknown> = {}) {
  return {
    id: "booking-1",
    user_id: USER.id,
    type: "collectif",
    google_event_id: "evt-1",
    google_calendar_creneau_id: "evt-1",
    starts_at: inHours(startsInHours),
    ends_at: inHours(startsInHours + 1),
    status: "confirmed",
    ticket_id: "ticket-1",
    created_at: "2026-06-01T00:00:00.000Z",
    cancelled_at: null,
    ...overrides,
  };
}

function makeReq(body: unknown): Request {
  return { json: async () => body } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  serverMock = makeSupabaseMock(USER);
  serviceMock = makeSupabaseMock(USER);
  getEventMock.mockResolvedValue({ id: "evt-1", attendees: [] });
  patchEventMock.mockResolvedValue(undefined);
});

describe("POST /api/annuler", () => {
  it("renvoie 401 sans authentification", async () => {
    serverMock = makeSupabaseMock(null);
    const { POST } = await import("@/app/api/annuler/route");
    const res = asMockResponse(await POST(makeReq({ bookingId: "booking-1" })));
    expect(res.status).toBe(401);
  });

  it("renvoie 400 sur un corps invalide", async () => {
    const { POST } = await import("@/app/api/annuler/route");
    const res = asMockResponse(await POST(makeReq({})));
    expect(res.status).toBe(400);
  });

  it("renvoie 404 si le booking est introuvable", async () => {
    serviceMock.queueResult("bookings", "select", { data: null, error: null });
    const { POST } = await import("@/app/api/annuler/route");
    const res = asMockResponse(await POST(makeReq({ bookingId: "ghost" })));
    expect(res.status).toBe(404);
  });

  it("renvoie 403 si le booking appartient à un autre user", async () => {
    serviceMock.queueResult("bookings", "select", {
      data: booking(48, { user_id: "someone-else" }),
      error: null,
    });
    const { POST } = await import("@/app/api/annuler/route");
    const res = asMockResponse(await POST(makeReq({ bookingId: "booking-1" })));
    expect(res.status).toBe(403);
  });

  it("renvoie 409 + tooLate quand le créneau démarre dans moins de 24h", async () => {
    // Démarre dans 12h → sous le seuil des 24h.
    serviceMock.queueResult("bookings", "select", { data: booking(12), error: null });
    const { POST } = await import("@/app/api/annuler/route");
    const res = asMockResponse(await POST(makeReq({ bookingId: "booking-1" })));
    expect(res.status).toBe(409);
    expect((res.body as { tooLate?: boolean }).tooLate).toBe(true);
    // Aucune écriture ne doit avoir eu lieu (pas de passage en cancelled).
    const updateCall = serviceMock.calls.find(
      (c) => c.table === "bookings" && c.op === "update",
    );
    expect(updateCall).toBeUndefined();
  });

  it("renvoie 200 (idempotent) si le booking est déjà annulé", async () => {
    serviceMock.queueResult("bookings", "select", {
      data: booking(48, { status: "cancelled" }),
      error: null,
    });
    const { POST } = await import("@/app/api/annuler/route");
    const res = asMockResponse(await POST(makeReq({ bookingId: "booking-1" })));
    expect(res.status).toBe(200);
    expect((res.body as { alreadyCancelled?: boolean }).alreadyCancelled).toBe(true);
  });

  it("happy path : 200, booking annulé et ticket RECRÉDITÉ (+1, plafonné à l'initial)", async () => {
    // Démarre dans 48h → annulation autorisée.
    serviceMock.queueResult("bookings", "select", { data: booking(48), error: null });
    // Passage en cancelled → 1 ligne touchée.
    serviceMock.queueResult("bookings", "update", {
      data: { id: "booking-1" },
      error: null,
    });
    // Lecture du ticket pour recrédit : 9/10 → recrédit 10.
    serviceMock.queueResult("tickets", "select", {
      data: {
        id: "ticket-1",
        user_id: USER.id,
        type: "collectif",
        quantite_initiale: 10,
        quantite_restante: 9,
        stripe_payment_id: null,
        stripe_session_id: null,
        expires_at: null,
        created_at: "2026-06-01T00:00:00.000Z",
      },
      error: null,
    });
    serviceMock.queueResult("tickets", "update", { data: null, error: null });

    const { POST } = await import("@/app/api/annuler/route");
    const res = asMockResponse(await POST(makeReq({ bookingId: "booking-1" })));

    expect(res.status).toBe(200);
    expect((res.body as { ok?: boolean }).ok).toBe(true);

    // Recrédit : min(9 + 1, 10) = 10.
    const ticketUpdate = serviceMock.calls.find(
      (c) => c.table === "tickets" && c.op === "update",
    );
    expect(ticketUpdate?.payload).toEqual({ quantite_restante: 10 });

    // Retrait de l'attendee Google tenté (best-effort).
    expect(patchEventMock).toHaveBeenCalledTimes(1);
  });

  it("plafonne le recrédit à quantite_initiale (pas de dépassement)", async () => {
    serviceMock.queueResult("bookings", "select", { data: booking(48), error: null });
    serviceMock.queueResult("bookings", "update", {
      data: { id: "booking-1" },
      error: null,
    });
    // Ticket déjà plein (10/10) → recrédit DOIT rester 10.
    serviceMock.queueResult("tickets", "select", {
      data: {
        id: "ticket-1",
        user_id: USER.id,
        type: "collectif",
        quantite_initiale: 10,
        quantite_restante: 10,
        stripe_payment_id: null,
        stripe_session_id: null,
        expires_at: null,
        created_at: "2026-06-01T00:00:00.000Z",
      },
      error: null,
    });
    serviceMock.queueResult("tickets", "update", { data: null, error: null });

    const { POST } = await import("@/app/api/annuler/route");
    const res = asMockResponse(await POST(makeReq({ bookingId: "booking-1" })));
    expect(res.status).toBe(200);
    const ticketUpdate = serviceMock.calls.find(
      (c) => c.table === "tickets" && c.op === "update",
    );
    expect(ticketUpdate?.payload).toEqual({ quantite_restante: 10 });
  });
});

describe("GET /api/annuler", () => {
  it("renvoie 405 (méthode non autorisée)", async () => {
    const { GET } = await import("@/app/api/annuler/route");
    const res = asMockResponse(GET());
    expect(res.status).toBe(405);
  });
});
