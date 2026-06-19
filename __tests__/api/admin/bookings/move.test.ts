import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  makeSupabaseMock,
  asMockResponse,
  type MockSupabase,
} from "../../../helpers/supabase-mock";

/**
 * Tests de POST /api/admin/bookings/move — déplacement vers un autre créneau.
 *
 * Couvre :
 *   - 400 body invalide ;
 *   - 404 booking introuvable ;
 *   - 409 no-op (même créneau) ;
 *   - 422 type cible incompatible ;
 *   - 409 anti-double-booking (déjà inscrite sur la cible) ;
 *   - 200 happy path (UPDATE vers le nouveau créneau).
 *
 * Mocks : requireAdmin, Supabase service, google-calendar.
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

function inHours(hours: number): string {
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: "booking-1",
    user_id: "user-1",
    type: "collectif",
    google_event_id: "evt-old",
    google_calendar_creneau_id: "evt-old",
    starts_at: inHours(48),
    ends_at: inHours(49),
    status: "confirmed",
    ticket_id: "ticket-1",
    created_at: "2026-06-01T00:00:00.000Z",
    cancelled_at: null,
    attendance: null,
    ...overrides,
  };
}

/** Event Google cible (collectif par défaut). */
function targetEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-new",
    status: "confirmed",
    summary: "Cours collectif",
    start: { dateTime: inHours(72) },
    end: { dateTime: inHours(73) },
    attendees: [],
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
  getEventMock.mockResolvedValue(targetEvent());
  patchEventMock.mockResolvedValue(undefined);
});

describe("POST /api/admin/bookings/move", () => {
  it("renvoie 400 sur un corps invalide", async () => {
    const { POST } = await import("@/app/api/admin/bookings/move/route");
    const res = asMockResponse(await POST(makeReq({ bookingId: "b" })));
    expect(res.status).toBe(400);
  });

  it("renvoie 404 si le booking est introuvable", async () => {
    serviceMock.queueResult("bookings", "select", { data: null, error: null });
    const { POST } = await import("@/app/api/admin/bookings/move/route");
    const res = asMockResponse(
      await POST(makeReq({ bookingId: "ghost", targetCreneauId: "evt-new" })),
    );
    expect(res.status).toBe(404);
  });

  it("renvoie 409 si on déplace vers le même créneau (no-op)", async () => {
    serviceMock.queueResult("bookings", "select", {
      data: booking({ google_calendar_creneau_id: "evt-new" }),
      error: null,
    });
    const { POST } = await import("@/app/api/admin/bookings/move/route");
    const res = asMockResponse(
      await POST(makeReq({ bookingId: "booking-1", targetCreneauId: "evt-new" })),
    );
    expect(res.status).toBe(409);
  });

  it("renvoie 422 si la cible est d'un autre type", async () => {
    serviceMock.queueResult("bookings", "select", { data: booking(), error: null });
    // Cible particulier alors que le booking est collectif.
    getEventMock.mockResolvedValue(
      targetEvent({ summary: "Cours particulier" }),
    );
    const { POST } = await import("@/app/api/admin/bookings/move/route");
    const res = asMockResponse(
      await POST(makeReq({ bookingId: "booking-1", targetCreneauId: "evt-new" })),
    );
    expect(res.status).toBe(422);
  });

  it("renvoie 409 si la cliente est déjà inscrite sur la cible", async () => {
    serviceMock.queueResult("bookings", "select", { data: booking(), error: null });
    // Pré-vérif anti-double-booking : trouve une résa existante.
    serviceMock.queueResult("bookings", "select", {
      data: { id: "deja" },
      error: null,
    });
    const { POST } = await import("@/app/api/admin/bookings/move/route");
    const res = asMockResponse(
      await POST(makeReq({ bookingId: "booking-1", targetCreneauId: "evt-new" })),
    );
    expect(res.status).toBe(409);
  });

  it("happy path : 200 + UPDATE vers le nouveau créneau", async () => {
    serviceMock.queueResult("bookings", "select", { data: booking(), error: null });
    // Pas de doublon sur la cible.
    serviceMock.queueResult("bookings", "select", { data: null, error: null });
    // Update → ligne déplacée.
    serviceMock.queueResult("bookings", "update", {
      data: { ...booking(), google_calendar_creneau_id: "evt-new" },
      error: null,
    });
    serviceMock.queueResult("profiles", "select", {
      data: { email: "cliente@x.fr" },
      error: null,
    });

    const { POST } = await import("@/app/api/admin/bookings/move/route");
    const res = asMockResponse(
      await POST(makeReq({ bookingId: "booking-1", targetCreneauId: "evt-new" })),
    );
    expect(res.status).toBe(200);
    expect((res.body as { ok?: boolean }).ok).toBe(true);

    const update = serviceMock.calls.find(
      (c) => c.table === "bookings" && c.op === "update",
    );
    expect(update?.payload).toMatchObject({
      google_event_id: "evt-new",
      google_calendar_creneau_id: "evt-new",
    });
  });
});

describe("GET /api/admin/bookings/move", () => {
  it("renvoie 405 (méthode non autorisée)", async () => {
    const { GET } = await import("@/app/api/admin/bookings/move/route");
    const res = asMockResponse(GET());
    expect(res.status).toBe(405);
  });
});
