import { describe, it, expect, vi, beforeEach } from "vitest";
import { asMockResponse } from "../helpers/supabase-mock";

/**
 * Tests de POST /api/admin/creneaux/apply — applique un preset à une date,
 * avec récurrence hebdomadaire optionnelle (génère N events Google).
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
vi.mock("@/lib/admin", () => ({ requireAdmin: () => requireAdminMock() }));

const insertEventMock = vi.fn();
vi.mock("@/lib/google-calendar", () => ({
  insertEvent: (...a: unknown[]) => insertEventMock(...a),
}));

const chargerPresetMock = vi.fn();
vi.mock("@/app/api/admin/creneaux/data", () => ({
  chargerPreset: (...a: unknown[]) => chargerPresetMock(...a),
}));

const PRESET = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  label: "Collectif vendredi 18h",
  type: "collectif" as const,
  dureeMin: 60,
  heureDebut: "18:00",
  lieu: "Parc de la Tête d'Or",
  capacite: 8,
  recurrence: null,
  createdAt: "2026-06-19T00:00:00Z",
};

function applyReq(body: unknown) {
  return new Request("http://x/api/admin/creneaux/apply", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue({ userId: "admin-1", email: "alice@x.fr" });
  chargerPresetMock.mockResolvedValue(PRESET);
  insertEventMock.mockImplementation(async (b: { start: { dateTime: string } }) => ({
    id: `evt-${b.start.dateTime}`,
    status: "confirmed",
    summary: "Cours collectif — Yoga Sculpt",
    location: "Parc de la Tête d'Or",
    start: b.start,
    end: { dateTime: "2026-07-03T17:00:00.000Z" },
  }));
});

describe("POST /api/admin/creneaux/apply", () => {
  it("applique un preset à une date → 1 event (201)", async () => {
    const { POST } = await import("@/app/api/admin/creneaux/apply/route");
    const res = asMockResponse(
      await POST(applyReq({ presetId: PRESET.id, date: "2026-07-03" })),
    );
    expect(res.status).toBe(201);
    expect(insertEventMock).toHaveBeenCalledTimes(1);
    expect((res.body as { crees: number }).crees).toBe(1);
  });

  it("récurrence hebdo N=4 → 4 events", async () => {
    const { POST } = await import("@/app/api/admin/creneaux/apply/route");
    const res = asMockResponse(
      await POST(
        applyReq({
          presetId: PRESET.id,
          date: "2026-07-03",
          recurrence: { frequence: "hebdomadaire", occurrences: 4 },
        }),
      ),
    );
    expect(res.status).toBe(201);
    expect(insertEventMock).toHaveBeenCalledTimes(4);
    expect((res.body as { crees: number }).crees).toBe(4);
  });

  it("404 si preset introuvable", async () => {
    chargerPresetMock.mockResolvedValue(null);
    const { POST } = await import("@/app/api/admin/creneaux/apply/route");
    const res = asMockResponse(
      await POST(applyReq({ presetId: PRESET.id, date: "2026-07-03" })),
    );
    expect(res.status).toBe(404);
  });

  it("400 si presetId n'est pas un uuid", async () => {
    const { POST } = await import("@/app/api/admin/creneaux/apply/route");
    const res = asMockResponse(await POST(applyReq({ presetId: "bad", date: "2026-07-03" })));
    expect(res.status).toBe(400);
  });

  it("502 si toutes les créations échouent", async () => {
    insertEventMock.mockRejectedValue(new Error("down"));
    const { POST } = await import("@/app/api/admin/creneaux/apply/route");
    const res = asMockResponse(
      await POST(applyReq({ presetId: PRESET.id, date: "2026-07-03" })),
    );
    expect(res.status).toBe(502);
  });

  it("échec partiel → 201 avec compte d'échecs", async () => {
    insertEventMock
      .mockResolvedValueOnce({ id: "ok-1", status: "confirmed", summary: "Cours collectif", start: { dateTime: "2026-07-03T16:00:00Z" }, end: { dateTime: "2026-07-03T17:00:00Z" } })
      .mockRejectedValueOnce(new Error("transient"));
    const { POST } = await import("@/app/api/admin/creneaux/apply/route");
    const res = asMockResponse(
      await POST(
        applyReq({
          presetId: PRESET.id,
          date: "2026-07-03",
          recurrence: { frequence: "hebdomadaire", occurrences: 2 },
        }),
      ),
    );
    expect(res.status).toBe(201);
    expect((res.body as { crees: number; echecs: number }).crees).toBe(1);
    expect((res.body as { echecs: number }).echecs).toBe(1);
  });
});
