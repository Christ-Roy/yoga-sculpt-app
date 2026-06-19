import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeSupabaseMock, type MockSupabase } from "../helpers/supabase-mock";

/**
 * Tests de src/lib/relance.ts — relance email automatique des inactifs.
 *
 * Deux niveaux :
 *   1. classerSegment (PUR) : la logique de sélection des 3 segments + priorité
 *      + cooldown, sans I/O. C'est le cœur métier.
 *   2. scanAndSendRelances (INTÉGRATION) : orchestration (chargement profils /
 *      bookings / tickets, envoi Brevo, horodatage idempotent, event tracking),
 *      avec Supabase + Brevo + logEvent mockés.
 */

// ── Mocks d'I/O ──────────────────────────────────────────────────────────────
let serviceMock: MockSupabase;
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => serviceMock.client),
}));

const sendEmailMock = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("@/lib/brevo", () => ({
  sendTransactionalEmail: (...args: unknown[]) => sendEmailMock(...args),
}));

const logEventMock = vi.fn(async (..._args: unknown[]) => true);
vi.mock("@/lib/events", () => ({
  logEvent: (...args: unknown[]) => logEventMock(...args),
}));

const NOW = new Date("2026-06-19T12:00:00.000Z");
const NOW_MS = NOW.getTime();
const JOUR = 24 * 60 * 60 * 1000;

/** Fabrique un profil minimal (créé il y a `creePresJours`, jamais relancé). */
function profil(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "user-1",
    email: "client@example.com",
    full_name: "Marie Dupont",
    created_at: new Date(NOW_MS - 10 * JOUR).toISOString(),
    relance_jamais_reserve_sent_at: null,
    relance_dormant_sent_at: null,
    relance_ticket_dormant_sent_at: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  serviceMock = makeSupabaseMock();
  sendEmailMock.mockResolvedValue(undefined);
  logEventMock.mockResolvedValue(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ════════════════════════════════════════════════════════════════════════════
// 1. classerSegment — sélection PURE des segments
// ════════════════════════════════════════════════════════════════════════════
describe("classerSegment", () => {
  it("segment 1 (jamais_reserve) : compte assez vieux, 0 booking", async () => {
    const { classerSegment } = await import("@/lib/relance");
    const p = profil({ created_at: new Date(NOW_MS - 5 * JOUR).toISOString() });
    expect(classerSegment(p as never, [], 0, NOW_MS)).toBe("jamais_reserve");
  });

  it("PAS de relance jamais_reserve si le compte est trop récent (< seuil)", async () => {
    const { classerSegment } = await import("@/lib/relance");
    const p = profil({ created_at: new Date(NOW_MS - 1 * JOUR).toISOString() });
    expect(classerSegment(p as never, [], 0, NOW_MS)).toBeNull();
  });

  it("segment 2 (dormant) : dernière résa confirmée > 30j, rien à venir", async () => {
    const { classerSegment } = await import("@/lib/relance");
    const bookings = [
      {
        user_id: "user-1",
        status: "confirmed",
        starts_at: new Date(NOW_MS - 40 * JOUR).toISOString(),
      },
    ];
    expect(classerSegment(profil() as never, bookings, 0, NOW_MS)).toBe(
      "dormant",
    );
  });

  it("PAS dormant si une résa confirmée est À VENIR", async () => {
    const { classerSegment } = await import("@/lib/relance");
    const bookings = [
      {
        user_id: "user-1",
        status: "confirmed",
        starts_at: new Date(NOW_MS - 40 * JOUR).toISOString(),
      },
      {
        user_id: "user-1",
        status: "confirmed",
        starts_at: new Date(NOW_MS + 2 * JOUR).toISOString(),
      },
    ];
    expect(classerSegment(profil() as never, bookings, 0, NOW_MS)).toBeNull();
  });

  it("PAS dormant si la dernière résa est récente (< 30j)", async () => {
    const { classerSegment } = await import("@/lib/relance");
    const bookings = [
      {
        user_id: "user-1",
        status: "confirmed",
        starts_at: new Date(NOW_MS - 10 * JOUR).toISOString(),
      },
    ];
    expect(classerSegment(profil() as never, bookings, 0, NOW_MS)).toBeNull();
  });

  it("une résa ANNULÉE ne compte pas comme dernière résa (reste candidat)", async () => {
    const { classerSegment } = await import("@/lib/relance");
    // Une seule résa, annulée, vieille → pas de "dernière confirmée" donc PAS
    // dormant ; mais il a un booking → PAS jamais_reserve non plus → null.
    const bookings = [
      {
        user_id: "user-1",
        status: "cancelled",
        starts_at: new Date(NOW_MS - 40 * JOUR).toISOString(),
      },
    ];
    expect(classerSegment(profil() as never, bookings, 0, NOW_MS)).toBeNull();
  });

  it("segment 3 (ticket_dormant) : solde > 0, rien à venir, pas dormant", async () => {
    const { classerSegment } = await import("@/lib/relance");
    // A une résa confirmée RÉCENTE (donc ni jamais_reserve ni dormant) mais des
    // tickets en solde et rien à venir → ticket_dormant.
    const bookings = [
      {
        user_id: "user-1",
        status: "confirmed",
        starts_at: new Date(NOW_MS - 5 * JOUR).toISOString(),
      },
    ];
    expect(classerSegment(profil() as never, bookings, 3, NOW_MS)).toBe(
      "ticket_dormant",
    );
  });

  it("priorité : jamais_reserve l'emporte sur ticket_dormant", async () => {
    const { classerSegment } = await import("@/lib/relance");
    // 0 booking + solde > 0 → les deux conditions matchent, jamais_reserve gagne.
    expect(classerSegment(profil() as never, [], 5, NOW_MS)).toBe(
      "jamais_reserve",
    );
  });

  it("cooldown : pas de re-relance du même segment dans la fenêtre", async () => {
    const { classerSegment } = await import("@/lib/relance");
    const p = profil({
      relance_jamais_reserve_sent_at: new Date(NOW_MS - 5 * JOUR).toISOString(),
    });
    // jamais_reserve en cooldown → null (pas d'autre segment applicable).
    expect(classerSegment(p as never, [], 0, NOW_MS)).toBeNull();
  });

  it("cooldown expiré : on relance à nouveau", async () => {
    const { classerSegment } = await import("@/lib/relance");
    const p = profil({
      relance_jamais_reserve_sent_at: new Date(NOW_MS - 90 * JOUR).toISOString(),
    });
    expect(classerSegment(p as never, [], 0, NOW_MS)).toBe("jamais_reserve");
  });

  it("aucun segment : user actif avec résa future → null", async () => {
    const { classerSegment } = await import("@/lib/relance");
    const bookings = [
      {
        user_id: "user-1",
        status: "confirmed",
        starts_at: new Date(NOW_MS + 3 * JOUR).toISOString(),
      },
    ];
    expect(classerSegment(profil() as never, bookings, 5, NOW_MS)).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. scanAndSendRelances — orchestration + idempotence
// ════════════════════════════════════════════════════════════════════════════
describe("scanAndSendRelances", () => {
  it("ne fait rien quand aucun profil candidat", async () => {
    serviceMock.queueResult("profiles", "select", { data: [], error: null });
    const { scanAndSendRelances } = await import("@/lib/relance");
    const res = await scanAndSendRelances(NOW);
    expect(res).toEqual({
      jamaisReserve: 0,
      dormant: 0,
      ticketDormant: 0,
      erreurs: 0,
    });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("envoie une relance jamais_reserve, horodate la colonne et logue l'event", async () => {
    serviceMock.queueResult("profiles", "select", {
      data: [profil({ created_at: new Date(NOW_MS - 5 * JOUR).toISOString() })],
      error: null,
    });
    serviceMock.queueResult("bookings", "select", { data: [], error: null });
    serviceMock.queueResult("tickets", "select", { data: [], error: null });
    serviceMock.queueResult("profiles", "update", { data: null, error: null });

    const { scanAndSendRelances } = await import("@/lib/relance");
    const res = await scanAndSendRelances(NOW);

    expect(res.jamaisReserve).toBe(1);
    expect(res.erreurs).toBe(0);

    // Email parti vers le bon destinataire avec un HTML + texte.
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const sent = sendEmailMock.mock.calls[0][0] as Record<string, string>;
    expect(sent.to).toBe("client@example.com");
    expect(sent.subject).toContain("Yoga Sculpt");
    expect(sent.htmlContent).toContain("Marie"); // prénom dérivé du full_name
    expect(typeof sent.textContent).toBe("string");
    expect(sent.textContent.length).toBeGreaterThan(0);

    // Horodatage de la BONNE colonne sur profiles.
    const upd = serviceMock.calls.find(
      (c) => c.table === "profiles" && c.op === "update",
    );
    expect(upd).toBeTruthy();
    expect(
      (upd?.payload as Record<string, unknown>).relance_jamais_reserve_sent_at,
    ).toBeTruthy();

    // Event tracking émis.
    expect(logEventMock).toHaveBeenCalledWith(
      "user-1",
      "reactivation_sent",
      expect.objectContaining({ segment: "jamais_reserve" }),
      expect.objectContaining({ source: "cron" }),
    );
  });

  it("relance ticket_dormant : solde repris dans le mail", async () => {
    serviceMock.queueResult("profiles", "select", {
      data: [profil()],
      error: null,
    });
    // Une résa confirmée récente → ni jamais_reserve ni dormant.
    serviceMock.queueResult("bookings", "select", {
      data: [
        {
          user_id: "user-1",
          status: "confirmed",
          starts_at: new Date(NOW_MS - 5 * JOUR).toISOString(),
        },
      ],
      error: null,
    });
    serviceMock.queueResult("tickets", "select", {
      data: [
        { user_id: "user-1", quantite_restante: 4, expires_at: null },
      ],
      error: null,
    });
    serviceMock.queueResult("profiles", "update", { data: null, error: null });

    const { scanAndSendRelances } = await import("@/lib/relance");
    const res = await scanAndSendRelances(NOW);

    expect(res.ticketDormant).toBe(1);
    const sent = sendEmailMock.mock.calls[0][0] as Record<string, string>;
    expect(sent.subject).toContain("4 séances");
    expect(logEventMock).toHaveBeenCalledWith(
      "user-1",
      "reactivation_sent",
      expect.objectContaining({ segment: "ticket_dormant", solde_tickets: 4 }),
      expect.objectContaining({ source: "cron" }),
    );
  });

  it("idempotence : un user déjà relancé (colonne fraîche) n'est PAS re-relancé", async () => {
    serviceMock.queueResult("profiles", "select", {
      data: [
        profil({
          created_at: new Date(NOW_MS - 5 * JOUR).toISOString(),
          // Relancé il y a 2 jours → dans le cooldown.
          relance_jamais_reserve_sent_at: new Date(
            NOW_MS - 2 * JOUR,
          ).toISOString(),
        }),
      ],
      error: null,
    });
    serviceMock.queueResult("bookings", "select", { data: [], error: null });
    serviceMock.queueResult("tickets", "select", { data: [], error: null });

    const { scanAndSendRelances } = await import("@/lib/relance");
    const res = await scanAndSendRelances(NOW);

    expect(res).toEqual({
      jamaisReserve: 0,
      dormant: 0,
      ticketDormant: 0,
      erreurs: 0,
    });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("échec d'envoi Brevo : compté en erreur, PAS d'horodatage (retry possible)", async () => {
    serviceMock.queueResult("profiles", "select", {
      data: [profil({ created_at: new Date(NOW_MS - 5 * JOUR).toISOString() })],
      error: null,
    });
    serviceMock.queueResult("bookings", "select", { data: [], error: null });
    serviceMock.queueResult("tickets", "select", { data: [], error: null });
    sendEmailMock.mockRejectedValueOnce(new Error("Brevo 500"));

    const { scanAndSendRelances } = await import("@/lib/relance");
    const res = await scanAndSendRelances(NOW);

    expect(res.jamaisReserve).toBe(0);
    expect(res.erreurs).toBe(1);
    // On n'a PAS horodaté (l'envoi a échoué).
    const upd = serviceMock.calls.find(
      (c) => c.table === "profiles" && c.op === "update",
    );
    expect(upd).toBeUndefined();
  });

  it("best-effort : un scan profils en erreur ne throw pas, renvoie 0", async () => {
    serviceMock.queueResult("profiles", "select", {
      data: null,
      error: { message: "DB down" },
    });
    const { scanAndSendRelances } = await import("@/lib/relance");
    const res = await scanAndSendRelances(NOW);
    expect(res).toEqual({
      jamaisReserve: 0,
      dormant: 0,
      ticketDormant: 0,
      erreurs: 0,
    });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
