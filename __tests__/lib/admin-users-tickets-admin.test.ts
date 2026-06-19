import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeSupabaseMock, type MockSupabase } from "../helpers/supabase-mock";

/**
 * Tests unitaires de la logique crédit/débit de tickets (admin) :
 * `src/app/api/admin/users/_lib/tickets-admin.ts`.
 *
 * On mocke le service client Supabase. Vérifie :
 *   - crédit : insertion d'un ticket d'ajustement (payload + marqueur opId) ;
 *   - crédit idempotent : si un ticket existe déjà pour l'opId → pas de 2e insert ;
 *   - débit refusé si solde insuffisant ;
 *   - débit OK : décrément LIFO (update conditionnel).
 */

let serviceMock: MockSupabase;
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => serviceMock.client),
}));

const UID = "11111111-1111-4111-8111-111111111111";
const OP = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
  serviceMock = makeSupabaseMock(null);
});

describe("crediterTickets", () => {
  it("insère un ticket d'ajustement marqué admin-adjust:<opId>", async () => {
    // 1) lookup idempotence : aucun ticket existant pour cet opId.
    serviceMock.queueResult("tickets", "select", { data: [], error: null });
    // 2) insert OK.
    serviceMock.queueResult("tickets", "insert", { data: null, error: null });
    // 3) recalcul du solde.
    serviceMock.queueResult("tickets", "select", {
      data: [{ quantite_restante: 2 }],
      error: null,
    });

    const { crediterTickets } = await import(
      "@/app/api/admin/users/_lib/tickets-admin"
    );
    const res = await crediterTickets({
      userId: UID,
      type: "collectif",
      quantite: 2,
      opId: OP,
    });

    expect(res.ok).toBe(true);
    expect(res.soldeApres).toBe(2);
    const insert = serviceMock.calls.find(
      (c) => c.table === "tickets" && c.op === "insert",
    );
    expect(insert?.payload).toMatchObject({
      user_id: UID,
      type: "collectif",
      quantite_initiale: 2,
      quantite_restante: 2,
      stripe_payment_id: `admin-adjust:${OP}`,
    });
  });

  it("ok=false si l'INSERT du ticket de crédit échoue (erreur DB remontée)", async () => {
    serviceMock.queueResult("tickets", "select", { data: [], error: null }); // idempotence
    serviceMock.queueResult("tickets", "insert", {
      data: null,
      error: { message: "permission denied" },
    });
    const { crediterTickets } = await import(
      "@/app/api/admin/users/_lib/tickets-admin"
    );
    const res = await crediterTickets({
      userId: UID,
      type: "collectif",
      quantite: 3,
      opId: OP,
    });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/Crédit échoué/);
  });

  it("est idempotent : un ticket déjà créé pour l'opId → pas de nouvel insert", async () => {
    // lookup idempotence : un ticket existe déjà.
    serviceMock.queueResult("tickets", "select", {
      data: [{ id: "ticket-existant" }],
      error: null,
    });
    // recalcul du solde.
    serviceMock.queueResult("tickets", "select", {
      data: [{ quantite_restante: 2 }],
      error: null,
    });

    const { crediterTickets } = await import(
      "@/app/api/admin/users/_lib/tickets-admin"
    );
    const res = await crediterTickets({
      userId: UID,
      type: "collectif",
      quantite: 2,
      opId: OP,
    });

    expect(res.ok).toBe(true);
    const inserts = serviceMock.calls.filter(
      (c) => c.table === "tickets" && c.op === "insert",
    );
    expect(inserts.length).toBe(0);
  });
});

describe("debiterTickets", () => {
  it("refuse (ok=false) si le solde est insuffisant", async () => {
    // soldeRestant : 1 séance dispo.
    serviceMock.queueResult("tickets", "select", {
      data: [{ quantite_restante: 1 }],
      error: null,
    });

    const { debiterTickets } = await import(
      "@/app/api/admin/users/_lib/tickets-admin"
    );
    const res = await debiterTickets({
      userId: UID,
      type: "collectif",
      quantite: 5,
      opId: OP,
    });

    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/Solde insuffisant/);
  });

  it("débite en LIFO via update conditionnel quand le solde suffit", async () => {
    // 1) soldeRestant (garde) : 3 dispo.
    serviceMock.queueResult("tickets", "select", {
      data: [{ quantite_restante: 3 }],
      error: null,
    });
    // 2) liste des tickets à décrémenter (LIFO).
    serviceMock.queueResult("tickets", "select", {
      data: [{ id: "t1", quantite_restante: 3 }],
      error: null,
    });
    // 3) update du décrément.
    serviceMock.queueResult("tickets", "update", { data: null, error: null });
    // 4) soldeRestant final.
    serviceMock.queueResult("tickets", "select", {
      data: [{ quantite_restante: 1 }],
      error: null,
    });

    const { debiterTickets } = await import(
      "@/app/api/admin/users/_lib/tickets-admin"
    );
    const res = await debiterTickets({
      userId: UID,
      type: "collectif",
      quantite: 2,
      opId: OP,
    });

    expect(res.ok).toBe(true);
    expect(res.soldeApres).toBe(1);
    const update = serviceMock.calls.find(
      (c) => c.table === "tickets" && c.op === "update",
    );
    expect(update?.payload).toMatchObject({ quantite_restante: 1 }); // 3 - 2
  });

  it("ok=false (débit partiel) si une course concurrente vide les tickets pendant le décrément", async () => {
    // 1) soldeRestant (garde) : 3 dispo → on passe la garde.
    serviceMock.queueResult("tickets", "select", {
      data: [{ quantite_restante: 3 }],
      error: null,
    });
    // 2) liste LIFO : un seul ticket de 3.
    serviceMock.queueResult("tickets", "select", {
      data: [{ id: "t1", quantite_restante: 3 }],
      error: null,
    });
    // 3) update conditionnel → ERREUR (course perdue : ligne vidée entre-temps).
    serviceMock.queueResult("tickets", "update", {
      data: null,
      error: { message: "no row updated (guard)" },
    });
    // 4) soldeRestant final.
    serviceMock.queueResult("tickets", "select", {
      data: [{ quantite_restante: 3 }],
      error: null,
    });

    const { debiterTickets } = await import(
      "@/app/api/admin/users/_lib/tickets-admin"
    );
    const res = await debiterTickets({
      userId: UID,
      type: "collectif",
      quantite: 2,
      opId: OP,
    });
    // reste > 0 → débit incomplet : on refuse plutôt que de mentir sur le solde.
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/concurrence|partiel/i);
  });
});
