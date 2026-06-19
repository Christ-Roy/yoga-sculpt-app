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

// Le déclencheur de crédit parrainage (anti-farming) est mocké : on vérifie
// QU'IL EST APPELÉ (ou non) sur les bonnes transitions, sans rejouer sa propre
// séquence DB (testée dans referral-lib.test.ts).
const crediterParrainsMock = vi.fn();
vi.mock("@/lib/referral", () => ({
  crediterParrainsApresSeanceHonoree: (...args: unknown[]) =>
    crediterParrainsMock(...args),
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
  crediterParrainsMock.mockResolvedValue(0);
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

  it("'attended' (transition depuis non-renseigné) → écrit attendance + DÉCLENCHE le crédit parrainage", async () => {
    serviceMock.queueResult("bookings", "select", {
      data: { id: "booking-1", user_id: "filleul-9", attendance: null },
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
    // ANTI-FARMING : le crédit du parrain est déclenché pour le FILLEUL (user_id).
    expect(crediterParrainsMock).toHaveBeenCalledWith(
      serviceMock.client,
      "filleul-9",
    );
  });

  it("'attended' alors que DÉJÀ 'attended' → PAS de re-déclenchement du crédit", async () => {
    serviceMock.queueResult("bookings", "select", {
      data: { id: "booking-1", user_id: "filleul-9", attendance: "attended" },
      error: null,
    });
    serviceMock.queueResult("bookings", "update", { data: null, error: null });
    const { POST } = await import("@/app/api/admin/bookings/attendance/route");
    const res = asMockResponse(
      await POST(makeReq({ bookingId: "booking-1", attendance: "attended" })),
    );
    expect(res.status).toBe(200);
    // Pas de transition → on ne re-déclenche pas (le crédit serait idempotent,
    // mais on évite le travail inutile).
    expect(crediterParrainsMock).not.toHaveBeenCalled();
  });

  it("le pointage reste 200 même si le crédit parrainage jette (best-effort)", async () => {
    serviceMock.queueResult("bookings", "select", {
      data: { id: "booking-1", user_id: "filleul-9", attendance: null },
      error: null,
    });
    serviceMock.queueResult("bookings", "update", { data: null, error: null });
    crediterParrainsMock.mockRejectedValue(new Error("boom"));
    const { POST } = await import("@/app/api/admin/bookings/attendance/route");
    const res = asMockResponse(
      await POST(makeReq({ bookingId: "booking-1", attendance: "attended" })),
    );
    expect(res.status).toBe(200);
  });

  it("'no_show' → écrit attendance='no_show', AUCUN crédit déclenché", async () => {
    serviceMock.queueResult("bookings", "select", {
      data: { id: "booking-1", user_id: "filleul-9", attendance: null },
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
    expect(crediterParrainsMock).not.toHaveBeenCalled();
  });

  it("'pending' → réinitialise (attendance=null, marked_at=null), AUCUN crédit", async () => {
    serviceMock.queueResult("bookings", "select", {
      data: { id: "booking-1", user_id: "filleul-9", attendance: "attended" },
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
    expect(crediterParrainsMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/bookings/attendance", () => {
  it("renvoie 405 (méthode non autorisée)", async () => {
    const { GET } = await import("@/app/api/admin/bookings/attendance/route");
    const res = asMockResponse(GET());
    expect(res.status).toBe(405);
  });
});
