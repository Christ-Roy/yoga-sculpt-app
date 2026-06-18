import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  makeSupabaseMock,
  asMockResponse,
  type MockSupabase,
} from "../../../helpers/supabase-mock";

/**
 * Tests de POST /api/admin/bookings/attendance — pointage présent/absent.
 *
 * Couvre :
 *   - 400 body invalide (valeur d'attendance hors enum) ;
 *   - 404 booking introuvable ;
 *   - 200 'attended' → écrit attendance='attended' + horodatage ;
 *   - 200 'no_show' → écrit attendance='no_show' ;
 *   - 200 'pending' → réinitialise (attendance=null, marked_at=null).
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

function makeReq(body: unknown): Request {
  return { json: async () => body } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  serviceMock = makeSupabaseMock(null);
  requireAdminMock.mockResolvedValue({ userId: "admin-1", email: "alice@x.fr" });
});

describe("POST /api/admin/bookings/attendance", () => {
  it("renvoie 400 sur une valeur d'attendance invalide", async () => {
    const { POST } = await import("@/app/api/admin/bookings/attendance/route");
    const res = asMockResponse(
      await POST(makeReq({ bookingId: "b", attendance: "maybe" })),
    );
    expect(res.status).toBe(400);
  });

  it("renvoie 404 si le booking est introuvable", async () => {
    serviceMock.queueResult("bookings", "select", { data: null, error: null });
    const { POST } = await import("@/app/api/admin/bookings/attendance/route");
    const res = asMockResponse(
      await POST(makeReq({ bookingId: "ghost", attendance: "attended" })),
    );
    expect(res.status).toBe(404);
  });

  it("'attended' → écrit attendance='attended' + horodatage", async () => {
    serviceMock.queueResult("bookings", "select", {
      data: { id: "booking-1" },
      error: null,
    });
    serviceMock.queueResult("bookings", "update", { data: null, error: null });
    const { POST } = await import("@/app/api/admin/bookings/attendance/route");
    const res = asMockResponse(
      await POST(makeReq({ bookingId: "booking-1", attendance: "attended" })),
    );
    expect(res.status).toBe(200);
    const update = serviceMock.calls.find(
      (c) => c.table === "bookings" && c.op === "update",
    );
    const payload = update?.payload as {
      attendance: string | null;
      attendance_marked_at: string | null;
    };
    expect(payload.attendance).toBe("attended");
    expect(typeof payload.attendance_marked_at).toBe("string");
  });

  it("'no_show' → écrit attendance='no_show'", async () => {
    serviceMock.queueResult("bookings", "select", {
      data: { id: "booking-1" },
      error: null,
    });
    serviceMock.queueResult("bookings", "update", { data: null, error: null });
    const { POST } = await import("@/app/api/admin/bookings/attendance/route");
    const res = asMockResponse(
      await POST(makeReq({ bookingId: "booking-1", attendance: "no_show" })),
    );
    expect(res.status).toBe(200);
    const update = serviceMock.calls.find(
      (c) => c.table === "bookings" && c.op === "update",
    );
    expect((update?.payload as { attendance: string }).attendance).toBe("no_show");
  });

  it("'pending' → réinitialise (attendance=null, marked_at=null)", async () => {
    serviceMock.queueResult("bookings", "select", {
      data: { id: "booking-1" },
      error: null,
    });
    serviceMock.queueResult("bookings", "update", { data: null, error: null });
    const { POST } = await import("@/app/api/admin/bookings/attendance/route");
    const res = asMockResponse(
      await POST(makeReq({ bookingId: "booking-1", attendance: "pending" })),
    );
    expect(res.status).toBe(200);
    const update = serviceMock.calls.find(
      (c) => c.table === "bookings" && c.op === "update",
    );
    expect(update?.payload).toEqual({
      attendance: null,
      attendance_marked_at: null,
    });
  });
});

describe("GET /api/admin/bookings/attendance", () => {
  it("renvoie 405 (méthode non autorisée)", async () => {
    const { GET } = await import("@/app/api/admin/bookings/attendance/route");
    const res = asMockResponse(GET());
    expect(res.status).toBe(405);
  });
});
