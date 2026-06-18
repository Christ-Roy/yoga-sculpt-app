import { describe, it, expect, vi, beforeEach } from "vitest";
import { asMockResponse } from "../helpers/supabase-mock";

/**
 * Tests de /api/admin/creneaux (GET/POST/PATCH/DELETE) — CRUD créneaux Google.
 *
 * On mocke `requireAdmin` (gate), les wrappers Google Calendar et la couche
 * `data.ts` (comptage des inscrits). On vérifie : validation stricte des inputs,
 * format d'écriture, garde de suppression si des inscrits existent.
 */

vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    })),
  },
}));

const requireAdminMock = vi.fn(async () => ({ userId: "admin-1", email: "alice@x.fr" }));
vi.mock("@/lib/admin", () => ({
  requireAdmin: () => requireAdminMock(),
}));

const listEventsMock = vi.fn();
const insertEventMock = vi.fn();
const patchEventMock = vi.fn();
const deleteEventMock = vi.fn();
const getEventMock = vi.fn();
vi.mock("@/lib/google-calendar", () => ({
  listEvents: (...a: unknown[]) => listEventsMock(...a),
  insertEvent: (...a: unknown[]) => insertEventMock(...a),
  patchEvent: (...a: unknown[]) => patchEventMock(...a),
  deleteEvent: (...a: unknown[]) => deleteEventMock(...a),
  getEvent: (...a: unknown[]) => getEventMock(...a),
}));

const compterReservationsMock = vi.fn(async (..._a: unknown[]) => 0);
vi.mock("@/app/api/admin/creneaux/data", () => ({
  compterReservations: (...a: unknown[]) => compterReservationsMock(...a),
}));

function req(body: unknown, url = "http://x/api/admin/creneaux") {
  return new Request(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue({ userId: "admin-1", email: "alice@x.fr" });
  compterReservationsMock.mockResolvedValue(0);
});

describe("GET /api/admin/creneaux", () => {
  it("liste les créneaux à venir avec inscrits", async () => {
    listEventsMock.mockResolvedValue([
      {
        id: "e1",
        status: "confirmed",
        summary: "Cours collectif — Yoga Sculpt",
        location: "Tête d'Or",
        start: { dateTime: "2026-07-03T16:00:00.000Z" },
        end: { dateTime: "2026-07-03T17:00:00.000Z" },
      },
    ]);
    compterReservationsMock.mockResolvedValue(2);
    const { GET } = await import("@/app/api/admin/creneaux/route");
    const res = asMockResponse(await GET());
    expect(res.status).toBe(200);
    const creneaux = (res.body as { creneaux: Array<{ id: string; inscrits: number }> }).creneaux;
    expect(creneaux[0].id).toBe("e1");
    expect(creneaux[0].inscrits).toBe(2);
  });

  it("502 si l'agenda Google échoue", async () => {
    listEventsMock.mockRejectedValueOnce(new Error("down"));
    const { GET } = await import("@/app/api/admin/creneaux/route");
    const res = asMockResponse(await GET());
    expect(res.status).toBe(502);
  });
});

describe("POST /api/admin/creneaux", () => {
  it("crée un créneau collectif (201) au format relisible", async () => {
    insertEventMock.mockResolvedValue({
      id: "new-1",
      status: "confirmed",
      summary: "Cours collectif — Yoga Sculpt",
      location: "Parc de la Tête d'Or",
      start: { dateTime: "2026-07-03T16:00:00.000Z" },
      end: { dateTime: "2026-07-03T17:00:00.000Z" },
    });
    const { POST } = await import("@/app/api/admin/creneaux/route");
    const res = asMockResponse(
      await POST(req({ date: "2026-07-03", heureDebut: "18:00", heureFin: "19:00", capacite: 8 })),
    );
    expect(res.status).toBe(201);
    // L'event écrit doit avoir un summary collectif + location + bornes dateTime.
    const written = insertEventMock.mock.calls[0][0];
    expect(written.summary.toLowerCase()).not.toContain("particulier");
    expect(written.location).toBe("Parc de la Tête d'Or");
    expect(written.start.dateTime).toBeTruthy();
  });

  it("400 si fin <= début", async () => {
    const { POST } = await import("@/app/api/admin/creneaux/route");
    const res = asMockResponse(
      await POST(req({ date: "2026-07-03", heureDebut: "19:00", heureFin: "18:00" })),
    );
    expect(res.status).toBe(400);
    expect(insertEventMock).not.toHaveBeenCalled();
  });

  it("400 si input invalide (date malformée)", async () => {
    const { POST } = await import("@/app/api/admin/creneaux/route");
    const res = asMockResponse(
      await POST(req({ date: "bad", heureDebut: "18:00", heureFin: "19:00" })),
    );
    expect(res.status).toBe(400);
  });

  it("502 si l'écriture Google échoue", async () => {
    insertEventMock.mockRejectedValueOnce(new Error("boom"));
    const { POST } = await import("@/app/api/admin/creneaux/route");
    const res = asMockResponse(
      await POST(req({ date: "2026-07-03", heureDebut: "18:00", heureFin: "19:00" })),
    );
    expect(res.status).toBe(502);
  });
});

describe("PATCH /api/admin/creneaux", () => {
  it("édite l'horaire (200)", async () => {
    getEventMock.mockResolvedValue({
      id: "e1",
      status: "confirmed",
      summary: "Cours collectif — Yoga Sculpt",
      start: { dateTime: "2026-07-03T16:00:00.000Z" },
      end: { dateTime: "2026-07-03T17:00:00.000Z" },
    });
    patchEventMock.mockResolvedValue({
      id: "e1",
      status: "confirmed",
      summary: "Cours collectif — Yoga Sculpt",
      start: { dateTime: "2026-07-03T17:00:00.000Z" },
      end: { dateTime: "2026-07-03T18:00:00.000Z" },
    });
    const { PATCH } = await import("@/app/api/admin/creneaux/route");
    const res = asMockResponse(
      await PATCH(
        new Request("http://x", {
          method: "PATCH",
          body: JSON.stringify({ eventId: "e1", date: "2026-07-03", heureDebut: "19:00", heureFin: "20:00" }),
        }),
      ),
    );
    expect(res.status).toBe(200);
    expect(patchEventMock).toHaveBeenCalled();
  });

  it("400 si on ne fournit qu'une moitié de l'horaire", async () => {
    getEventMock.mockResolvedValue({ id: "e1", status: "confirmed", summary: "Cours collectif", start: {}, end: {} });
    const { PATCH } = await import("@/app/api/admin/creneaux/route");
    const res = asMockResponse(
      await PATCH(
        new Request("http://x", { method: "PATCH", body: JSON.stringify({ eventId: "e1", date: "2026-07-03" }) }),
      ),
    );
    expect(res.status).toBe(400);
  });

  it("404 si le créneau n'existe pas", async () => {
    getEventMock.mockRejectedValueOnce(new Error("HTTP 404 not found"));
    const { PATCH } = await import("@/app/api/admin/creneaux/route");
    const res = asMockResponse(
      await PATCH(
        new Request("http://x", { method: "PATCH", body: JSON.stringify({ eventId: "ghost", lieu: "X" }) }),
      ),
    );
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/admin/creneaux", () => {
  it("supprime un créneau sans inscrits (200)", async () => {
    compterReservationsMock.mockResolvedValue(0);
    deleteEventMock.mockResolvedValue(undefined);
    const { DELETE } = await import("@/app/api/admin/creneaux/route");
    const res = asMockResponse(
      await DELETE(new Request("http://x/api/admin/creneaux?eventId=e1", { method: "DELETE" })),
    );
    expect(res.status).toBe(200);
    expect(deleteEventMock).toHaveBeenCalledWith("e1");
  });

  it("409 si des inscrits existent et force absent", async () => {
    compterReservationsMock.mockResolvedValue(3);
    const { DELETE } = await import("@/app/api/admin/creneaux/route");
    const res = asMockResponse(
      await DELETE(new Request("http://x/api/admin/creneaux?eventId=e1", { method: "DELETE" })),
    );
    expect(res.status).toBe(409);
    expect((res.body as { needsForce: boolean }).needsForce).toBe(true);
    expect(deleteEventMock).not.toHaveBeenCalled();
  });

  it("supprime malgré les inscrits si force=1", async () => {
    compterReservationsMock.mockResolvedValue(3);
    deleteEventMock.mockResolvedValue(undefined);
    const { DELETE } = await import("@/app/api/admin/creneaux/route");
    const res = asMockResponse(
      await DELETE(new Request("http://x/api/admin/creneaux?eventId=e1&force=1", { method: "DELETE" })),
    );
    expect(res.status).toBe(200);
    expect(deleteEventMock).toHaveBeenCalledWith("e1");
  });

  it("400 sans eventId", async () => {
    const { DELETE } = await import("@/app/api/admin/creneaux/route");
    const res = asMockResponse(
      await DELETE(new Request("http://x/api/admin/creneaux", { method: "DELETE" })),
    );
    expect(res.status).toBe(400);
  });
});
