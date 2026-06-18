import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  makeSupabaseMock,
  asMockResponse,
  type MockSupabase,
} from "../../../helpers/supabase-mock";

/**
 * Tests de POST /api/admin/bookings/cancel — annulation au nom d'une cliente.
 *
 * Couvre :
 *   - 400 sur body invalide ;
 *   - 404 si booking introuvable ;
 *   - 200 idempotent si déjà annulé ;
 *   - 409 + tooLate si < 24h SANS overrideGuard ;
 *   - 200 + override de la garde 24h (overrideGuard) ;
 *   - 200 + RECRÉDIT par défaut (assertion payload +1 plafonné) ;
 *   - recredit:false → AUCUN recrédit.
 *
 * Mocks : requireAdmin (no-op), Supabase service, google-calendar.
 */

vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    })),
  },
}));

const requireAdminMock = vi.fn();
vi.mock("@/lib/admin", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
}));

let serviceMock: MockSupabase;
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => serviceMock.client),
}));

const getEventMock = vi.fn();
const patchEventMock = vi.fn();
vi.mock("@/lib/google-calendar", () => ({
  getEvent: (...args: unknown[]) => getEventMock(...args),
  patchEvent: (...args: unknown[]) => patchEventMock(...args),
}));

/** Date ISO décalée de `hours` heures par rapport à maintenant. */
function inHours(hours: number): string {
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

function booking(startsInHours: number, overrides: Record<string, unknown> = {}) {
  return {
    id: "booking-1",
    user_id: "user-1",
    type: "collectif",
    google_event_id: "evt-1",
    google_calendar_creneau_id: "evt-1",
    starts_at: inHours(startsInHours),
    ends_at: inHours(startsInHours + 1),
    status: "confirmed",
    ticket_id: "ticket-1",
    created_at: "2026-06-01T00:00:00.000Z",
    cancelled_at: null,
    attendance: null,
    ...overrides,
  };
}

function makeReq(body: unknown): Request {
  return { json: async () => body } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  serviceMock = makeSupabaseMock(null);
  requireAdminMock.mockResolvedValue({ userId: "admin-1", email: "alice@x.fr" });
  getEventMock.mockResolvedValue({ id: "evt-1", attendees: [] });
  patchEventMock.mockResolvedValue(undefined);
});

describe("POST /api/admin/bookings/cancel", () => {
  it("renvoie 400 sur un corps invalide", async () => {
    const { POST } = await import("@/app/api/admin/bookings/cancel/route");
    const res = asMockResponse(await POST(makeReq({})));
    expect(res.status).toBe(400);
  });

  it("renvoie 404 si le booking est introuvable", async () => {
    serviceMock.queueResult("bookings", "select", { data: null, error: null });
    const { POST } = await import("@/app/api/admin/bookings/cancel/route");
    const res = asMockResponse(await POST(makeReq({ bookingId: "ghost" })));
    expect(res.status).toBe(404);
  });

  it("renvoie 200 idempotent si déjà annulé", async () => {
    serviceMock.queueResult("bookings", "select", {
      data: booking(48, { status: "cancelled" }),
      error: null,
    });
    const { POST } = await import("@/app/api/admin/bookings/cancel/route");
    const res = asMockResponse(await POST(makeReq({ bookingId: "booking-1" })));
    expect(res.status).toBe(200);
    expect((res.body as { alreadyCancelled?: boolean }).alreadyCancelled).toBe(true);
  });

  it("renvoie 409 + tooLate si < 24h sans overrideGuard", async () => {
    serviceMock.queueResult("bookings", "select", { data: booking(12), error: null });
    const { POST } = await import("@/app/api/admin/bookings/cancel/route");
    const res = asMockResponse(await POST(makeReq({ bookingId: "booking-1" })));
    expect(res.status).toBe(409);
    expect((res.body as { tooLate?: boolean }).tooLate).toBe(true);
    // Aucune écriture (pas de passage en cancelled).
    const updateCall = serviceMock.calls.find(
      (c) => c.table === "bookings" && c.op === "update",
    );
    expect(updateCall).toBeUndefined();
  });

  it("annule < 24h quand overrideGuard:true (garde outrepassée)", async () => {
    serviceMock.queueResult("bookings", "select", { data: booking(12), error: null });
    serviceMock.queueResult("bookings", "update", {
      data: { id: "booking-1" },
      error: null,
    });
    serviceMock.queueResult("tickets", "select", {
      data: {
        id: "ticket-1",
        user_id: "user-1",
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
    serviceMock.queueResult("profiles", "select", {
      data: { email: "cliente@x.fr" },
      error: null,
    });

    const { POST } = await import("@/app/api/admin/bookings/cancel/route");
    const res = asMockResponse(
      await POST(makeReq({ bookingId: "booking-1", overrideGuard: true })),
    );
    expect(res.status).toBe(200);
    expect((res.body as { ok?: boolean }).ok).toBe(true);
  });

  it("happy path : 200 + RECRÉDIT (+1 plafonné) par défaut", async () => {
    serviceMock.queueResult("bookings", "select", { data: booking(48), error: null });
    serviceMock.queueResult("bookings", "update", {
      data: { id: "booking-1" },
      error: null,
    });
    serviceMock.queueResult("tickets", "select", {
      data: {
        id: "ticket-1",
        user_id: "user-1",
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
    serviceMock.queueResult("profiles", "select", {
      data: { email: "cliente@x.fr" },
      error: null,
    });

    const { POST } = await import("@/app/api/admin/bookings/cancel/route");
    const res = asMockResponse(await POST(makeReq({ bookingId: "booking-1" })));
    expect(res.status).toBe(200);

    const ticketUpdate = serviceMock.calls.find(
      (c) => c.table === "tickets" && c.op === "update",
    );
    expect(ticketUpdate?.payload).toEqual({ quantite_restante: 10 });
    // Retrait de l'attendee Google tenté (email du client résolu via profiles).
    expect(patchEventMock).toHaveBeenCalledTimes(1);
  });

  it("recredit:false → AUCUN recrédit du ticket", async () => {
    serviceMock.queueResult("bookings", "select", { data: booking(48), error: null });
    serviceMock.queueResult("bookings", "update", {
      data: { id: "booking-1" },
      error: null,
    });
    serviceMock.queueResult("profiles", "select", {
      data: { email: "cliente@x.fr" },
      error: null,
    });

    const { POST } = await import("@/app/api/admin/bookings/cancel/route");
    const res = asMockResponse(
      await POST(makeReq({ bookingId: "booking-1", recredit: false })),
    );
    expect(res.status).toBe(200);
    const ticketUpdate = serviceMock.calls.find(
      (c) => c.table === "tickets" && c.op === "update",
    );
    expect(ticketUpdate).toBeUndefined();
  });
});

describe("GET /api/admin/bookings/cancel", () => {
  it("renvoie 405 (méthode non autorisée)", async () => {
    const { GET } = await import("@/app/api/admin/bookings/cancel/route");
    const res = asMockResponse(GET());
    expect(res.status).toBe(405);
  });
});
