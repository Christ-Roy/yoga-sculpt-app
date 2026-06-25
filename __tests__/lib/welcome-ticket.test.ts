import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeSupabaseMock, type MockSupabase } from "../helpers/supabase-mock";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Tests de src/lib/welcome-ticket.ts — octroi du ticket de bienvenue
 * (« 1ère séance offerte », pivot Essai gratuit).
 *
 * Couvre les invariants critiques :
 *   - IDEMPOTENCE : flag profil déjà posé → no-op (aucun insert ticket) ;
 *   - IDEMPOTENCE concurrente : violation d'unicité (23505) à l'insert → pas de
 *     doublon, on pose le flag, granted:false ;
 *   - ANTI-ABUS : e-mail jetable / IP partagée / fingerprint partagé → pas de
 *     ticket, MAIS le flag est posé (refus figé, pas re-tenté) ;
 *   - CAS NOMINAL : insert ticket collectif `source='welcome'` + flag + event ;
 *   - FAIL-SAFE : erreur de lecture profil → granted:false sans throw.
 *
 * `logEvent` est mocké (best-effort) pour isoler la logique de crédit.
 */

let serviceMock: MockSupabase;
const logEventMock = vi.fn(
  async (...args: unknown[]): Promise<boolean> => {
    void args;
    return true;
  },
);

vi.mock("@/lib/events", () => ({
  logEvent: (...args: unknown[]) => logEventMock(...args),
}));

function asClient(m: MockSupabase): SupabaseClient {
  return m.client as unknown as SupabaseClient;
}

const USER_ID = "user-new";
const EMAIL = "client@gmail.com";

beforeEach(() => {
  vi.clearAllMocks();
  serviceMock = makeSupabaseMock();
  vi.spyOn(console, "error").mockImplementation(() => {});
  // canGrantWelcomeTicket appelle désormais refreshDisposableBlocklist() (fetch
  // GitHub). On le stub en échec → fallback Set statique (jamais fail-open),
  // pas de réseau réel en CI. Le verdict jetable s'appuie sur le plancher statique.
  global.fetch = vi.fn().mockRejectedValue(new Error("no network in unit tests"));
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Helper : insert ticket effectivement tenté ? */
function ticketInsert(svc: MockSupabase) {
  return svc.calls.find((c) => c.table === "tickets" && c.op === "insert");
}

describe("grantWelcomeTicket", () => {
  it("cas nominal : crédite 1 ticket collectif source='welcome', pose le flag, émet l'event", async () => {
    // 1) lecture profil : pas encore accordé.
    serviceMock.queueResult("profiles", "select", {
      data: { welcome_ticket_granted_at: null },
      error: null,
    });
    // 2) anti-abus : aucune IP/fp fournie → pas de lecture account_signals.
    // 3) insert ticket OK.
    serviceMock.queueResult("tickets", "insert", { data: null, error: null });

    const { grantWelcomeTicket } = await import("@/lib/welcome-ticket");
    const res = await grantWelcomeTicket(asClient(serviceMock), {
      userId: USER_ID,
      email: EMAIL,
      ip: null,
      fingerprint: null,
    });

    expect(res).toEqual({ granted: true });

    const insert = ticketInsert(serviceMock);
    expect(insert?.payload).toMatchObject({
      user_id: USER_ID,
      type: "collectif",
      quantite_initiale: 1,
      quantite_restante: 1,
      source: "welcome",
    });
    // Pas de stripe_* sur un ticket offert.
    expect(
      (insert?.payload as Record<string, unknown>).stripe_session_id,
    ).toBeUndefined();

    // Flag posé.
    const flag = serviceMock.calls.find(
      (c) => c.table === "profiles" && c.op === "update",
    );
    expect(flag?.payload).toHaveProperty("welcome_ticket_granted_at");

    // Tracking ticket_acquired { acquisition_source: 'welcome' }.
    expect(logEventMock).toHaveBeenCalledWith(
      USER_ID,
      "ticket_acquired",
      { acquisition_source: "welcome", type: "collectif", quantite: 1 },
      expect.objectContaining({ source: "onboarding" }),
    );
  });

  it("IDEMPOTENCE : flag déjà posé → no-op (aucun insert, aucun event)", async () => {
    serviceMock.queueResult("profiles", "select", {
      data: { welcome_ticket_granted_at: "2026-06-19T10:00:00Z" },
      error: null,
    });

    const { grantWelcomeTicket } = await import("@/lib/welcome-ticket");
    const res = await grantWelcomeTicket(asClient(serviceMock), {
      userId: USER_ID,
      email: EMAIL,
      ip: "203.0.113.7",
      fingerprint: "fp-x",
    });

    expect(res).toEqual({ granted: false });
    expect(ticketInsert(serviceMock)).toBeUndefined();
    expect(logEventMock).not.toHaveBeenCalled();
  });

  it("IDEMPOTENCE concurrente : insert refusé (23505) → pas de doublon, flag posé, granted:false", async () => {
    serviceMock.queueResult("profiles", "select", {
      data: { welcome_ticket_granted_at: null },
      error: null,
    });
    serviceMock.queueResult("tickets", "insert", {
      data: null,
      error: { code: "23505", message: "duplicate key value" },
    });

    const { grantWelcomeTicket } = await import("@/lib/welcome-ticket");
    const res = await grantWelcomeTicket(asClient(serviceMock), {
      userId: USER_ID,
      email: EMAIL,
      ip: null,
      fingerprint: null,
    });

    expect(res).toEqual({ granted: false });
    // L'insert a bien été TENTÉ (la garde unique DB l'a rejeté).
    expect(ticketInsert(serviceMock)).toBeDefined();
    // Et on a quand même posé le flag (alignement sur l'état réel).
    expect(
      serviceMock.calls.find((c) => c.table === "profiles" && c.op === "update"),
    ).toBeDefined();
    // Pas de doublon d'event de crédit.
    expect(logEventMock).not.toHaveBeenCalled();
  });

  it("ANTI-ABUS R1 : e-mail jetable → pas de ticket, flag posé (refus figé), silencieux", async () => {
    serviceMock.queueResult("profiles", "select", {
      data: { welcome_ticket_granted_at: null },
      error: null,
    });

    const { grantWelcomeTicket } = await import("@/lib/welcome-ticket");
    const res = await grantWelcomeTicket(asClient(serviceMock), {
      userId: USER_ID,
      email: "abuser@mailinator.com",
      ip: null,
      fingerprint: null,
    });

    expect(res).toEqual({ granted: false });
    expect(ticketInsert(serviceMock)).toBeUndefined();
    // Le flag est posé : on ne re-tentera pas l'anti-abus à chaque visite.
    expect(
      serviceMock.calls.find((c) => c.table === "profiles" && c.op === "update"),
    ).toBeDefined();
    expect(logEventMock).not.toHaveBeenCalled();
  });

  it("ANTI-ABUS : IP partagée avec un autre compte → pas de ticket, flag posé", async () => {
    serviceMock.queueResult("profiles", "select", {
      data: { welcome_ticket_granted_at: null },
      error: null,
    });
    // hasSharedSignals : un AUTRE compte a la même IP.
    serviceMock.queueResult("account_signals", "select", {
      data: [{ user_id: "autre-compte" }],
      error: null,
    });

    const { grantWelcomeTicket } = await import("@/lib/welcome-ticket");
    const res = await grantWelcomeTicket(asClient(serviceMock), {
      userId: USER_ID,
      email: EMAIL,
      ip: "203.0.113.7",
      fingerprint: null,
    });

    expect(res).toEqual({ granted: false });
    expect(ticketInsert(serviceMock)).toBeUndefined();
    expect(
      serviceMock.calls.find((c) => c.table === "profiles" && c.op === "update"),
    ).toBeDefined();
  });

  it("ANTI-ABUS : fingerprint partagé avec un autre compte → pas de ticket", async () => {
    serviceMock.queueResult("profiles", "select", {
      data: { welcome_ticket_granted_at: null },
      error: null,
    });
    // Pas d'IP → seule la requête fingerprint est lancée : doublon.
    serviceMock.queueResult("account_signals", "select", {
      data: [{ user_id: "autre-compte" }],
      error: null,
    });

    const { grantWelcomeTicket } = await import("@/lib/welcome-ticket");
    const res = await grantWelcomeTicket(asClient(serviceMock), {
      userId: USER_ID,
      email: EMAIL,
      ip: null,
      fingerprint: "fp-partage",
    });

    expect(res).toEqual({ granted: false });
    expect(ticketInsert(serviceMock)).toBeUndefined();
  });

  it("crédite quand IP + fingerprint sont uniques (aucun autre compte)", async () => {
    serviceMock.queueResult("profiles", "select", {
      data: { welcome_ticket_granted_at: null },
      error: null,
    });
    // hasSharedSignals : IP unique puis fingerprint unique.
    serviceMock.queueResult("account_signals", "select", { data: [], error: null });
    serviceMock.queueResult("account_signals", "select", { data: [], error: null });
    serviceMock.queueResult("tickets", "insert", { data: null, error: null });

    const { grantWelcomeTicket } = await import("@/lib/welcome-ticket");
    const res = await grantWelcomeTicket(asClient(serviceMock), {
      userId: USER_ID,
      email: EMAIL,
      ip: "203.0.113.7",
      fingerprint: "fp-unique",
    });

    expect(res).toEqual({ granted: true });
    expect(ticketInsert(serviceMock)?.payload).toMatchObject({ source: "welcome" });
  });

  it("FAIL-SAFE : erreur de lecture du profil → granted:false sans throw, aucun insert", async () => {
    serviceMock.queueResult("profiles", "select", {
      data: null,
      error: { message: "timeout" },
    });

    const { grantWelcomeTicket } = await import("@/lib/welcome-ticket");
    const res = await grantWelcomeTicket(asClient(serviceMock), {
      userId: USER_ID,
      email: EMAIL,
      ip: null,
      fingerprint: null,
    });

    expect(res).toEqual({ granted: false });
    expect(ticketInsert(serviceMock)).toBeUndefined();
  });
});
