import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeSupabaseMock, type MockSupabase } from "../helpers/supabase-mock";

/**
 * Tests de src/lib/attendance.ts — émission idempotente des events
 * booking_attended pour les séances passées (appelé par le cron).
 *
 * Comportements clés couverts :
 *   - aucune séance passée non marquée → 0 marquée, 0 erreur ;
 *   - une séance passée → claim (update attended_event_at) + event booking_attended ;
 *   - claim concurrent perdu (0 ligne touchée) → pas d'event émis (anti-doublon) ;
 *   - scan en erreur → 1 erreur, best-effort (pas de throw).
 */

let serviceMock: MockSupabase;
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => serviceMock.client),
}));

// On observe les events émis via le helper logEvent (mocké).
const logEventMock = vi.fn(async (..._args: unknown[]) => true);
vi.mock("@/lib/events", () => ({
  logEvent: (...args: unknown[]) => logEventMock(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  serviceMock = makeSupabaseMock();
  logEventMock.mockResolvedValue(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("markPastBookingsAttended", () => {
  it("ne fait rien quand aucune séance passée n'est à marquer", async () => {
    serviceMock.queueResult("bookings", "select", { data: [], error: null });
    const { markPastBookingsAttended } = await import("@/lib/attendance");
    const res = await markPastBookingsAttended();
    expect(res).toEqual({ marquees: 0, erreurs: 0 });
    expect(logEventMock).not.toHaveBeenCalled();
  });

  it("marque une séance passée et émet booking_attended", async () => {
    serviceMock.queueResult("bookings", "select", {
      data: [
        {
          id: "b1",
          user_id: "user-1",
          type: "collectif",
          starts_at: "2026-06-01T10:00:00Z",
          google_calendar_creneau_id: "cre1",
        },
      ],
      error: null,
    });
    // Le claim (update ... select maybeSingle) renvoie la ligne → on a gagné.
    serviceMock.queueResult("bookings", "update", {
      data: { id: "b1" },
      error: null,
    });

    const { markPastBookingsAttended } = await import("@/lib/attendance");
    const res = await markPastBookingsAttended();

    expect(res.marquees).toBe(1);
    expect(res.erreurs).toBe(0);
    expect(logEventMock).toHaveBeenCalledTimes(1);
    expect(logEventMock).toHaveBeenCalledWith(
      "user-1",
      "booking_attended",
      expect.objectContaining({ booking_id: "b1", type: "collectif" }),
      expect.objectContaining({ source: "cron" }),
    );
  });

  it("n'émet pas d'event si le claim est perdu (course concurrente)", async () => {
    serviceMock.queueResult("bookings", "select", {
      data: [
        {
          id: "b1",
          user_id: "user-1",
          type: "collectif",
          starts_at: "2026-06-01T10:00:00Z",
          google_calendar_creneau_id: "cre1",
        },
      ],
      error: null,
    });
    // Claim → 0 ligne (un autre tick a déjà marqué).
    serviceMock.queueResult("bookings", "update", { data: null, error: null });

    const { markPastBookingsAttended } = await import("@/lib/attendance");
    const res = await markPastBookingsAttended();

    expect(res.marquees).toBe(0);
    expect(logEventMock).not.toHaveBeenCalled();
  });

  it("renvoie 1 erreur si le scan échoue (best-effort, pas de throw)", async () => {
    serviceMock.queueResult("bookings", "select", {
      data: null,
      error: { message: "scan KO" },
    });
    const { markPastBookingsAttended } = await import("@/lib/attendance");
    const res = await markPastBookingsAttended();
    expect(res).toEqual({ marquees: 0, erreurs: 1 });
  });
});
