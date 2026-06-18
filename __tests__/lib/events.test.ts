import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeSupabaseMock, type MockSupabase } from "../helpers/supabase-mock";

/**
 * Tests de src/lib/events.ts — helper `logEvent` du journal de tracking.
 *
 * Comportements clés couverts :
 *   - insère bien dans `user_events` avec user_id / event_type / metadata / source ;
 *   - FAIL-SAFE : renvoie false (sans throw) si l'insert échoue (erreur DB) ;
 *   - FAIL-SAFE : renvoie false (sans throw) si createServiceClient throw (env absent) ;
 *   - réutilise un client service passé en option (pas de nouveau client créé) ;
 *   - user_id null toléré (event sans compte rattaché).
 */

let serviceMock: MockSupabase;
const createServiceClientMock = vi.fn(() => serviceMock.client);

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClientMock(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  serviceMock = makeSupabaseMock();
  // Silence les console.error best-effort attendus dans les cas d'échec.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logEvent", () => {
  it("insère l'event dans user_events avec les bons champs", async () => {
    const { logEvent } = await import("@/lib/events");
    const ok = await logEvent(
      "user-1",
      "checkout_started",
      { stripe_session_id: "cs_1", montant: 20 },
      { source: "checkout", ip: "1.2.3.4" },
    );

    expect(ok).toBe(true);
    const insert = serviceMock.calls.find(
      (c) => c.table === "user_events" && c.op === "insert",
    );
    expect(insert).toBeDefined();
    expect(insert?.payload).toMatchObject({
      user_id: "user-1",
      event_type: "checkout_started",
      metadata: { stripe_session_id: "cs_1", montant: 20 },
      source: "checkout",
      ip: "1.2.3.4",
    });
  });

  it("tolère un user_id null (event sans compte rattaché)", async () => {
    const { logEvent } = await import("@/lib/events");
    const ok = await logEvent(null, "referral_blocked", { raison: "ip" });
    expect(ok).toBe(true);
    const insert = serviceMock.calls.find(
      (c) => c.table === "user_events" && c.op === "insert",
    );
    expect(insert?.payload).toMatchObject({
      user_id: null,
      event_type: "referral_blocked",
      ip: null,
      source: null,
    });
  });

  it("renvoie false sans throw si l'insert DB échoue (fail-safe)", async () => {
    serviceMock.queueResult("user_events", "insert", {
      data: null,
      error: { message: "insert refusé" },
    });
    const { logEvent } = await import("@/lib/events");
    const ok = await logEvent("user-1", "booking_created", { booking_id: "b1" });
    expect(ok).toBe(false);
  });

  it("renvoie false sans throw si createServiceClient lève (env manquant)", async () => {
    createServiceClientMock.mockImplementationOnce(() => {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY manquant");
    });
    const { logEvent } = await import("@/lib/events");
    const ok = await logEvent("user-1", "signup", {});
    expect(ok).toBe(false);
  });

  it("réutilise le client service fourni en option (pas de createServiceClient)", async () => {
    const { logEvent } = await import("@/lib/events");
    const ok = await logEvent(
      "user-1",
      "booking_cancelled",
      { booking_id: "b1" },
      { service: serviceMock.client as never },
    );
    expect(ok).toBe(true);
    // Le client a été fourni → on n'instancie PAS un nouveau client.
    expect(createServiceClientMock).not.toHaveBeenCalled();
    const insert = serviceMock.calls.find(
      (c) => c.table === "user_events" && c.op === "insert",
    );
    expect(insert).toBeDefined();
  });
});
