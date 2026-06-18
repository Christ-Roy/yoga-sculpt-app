import { describe, it, expect, vi, beforeEach } from "vitest";
import { asMockResponse } from "../helpers/supabase-mock";

/**
 * Tests de /api/admin/creneaux/presets (GET/POST/PATCH/DELETE) — CRUD modèles.
 * On mocke requireAdmin + la couche data (Supabase service_role).
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

const listerPresetsMock = vi.fn();
const creerPresetMock = vi.fn();
const majPresetMock = vi.fn();
const supprimerPresetMock = vi.fn();
vi.mock("@/app/api/admin/creneaux/data", () => ({
  listerPresets: (...a: unknown[]) => listerPresetsMock(...a),
  creerPreset: (...a: unknown[]) => creerPresetMock(...a),
  majPreset: (...a: unknown[]) => majPresetMock(...a),
  supprimerPreset: (...a: unknown[]) => supprimerPresetMock(...a),
}));

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue({ userId: "admin-1", email: "alice@x.fr" });
});

describe("GET /api/admin/creneaux/presets", () => {
  it("renvoie la liste des presets", async () => {
    listerPresetsMock.mockResolvedValue([{ id: "p1", label: "Vendredi 18h" }]);
    const { GET } = await import("@/app/api/admin/creneaux/presets/route");
    const res = asMockResponse(await GET());
    expect(res.status).toBe(200);
    expect((res.body as { presets: unknown[] }).presets).toHaveLength(1);
  });
});

describe("POST /api/admin/creneaux/presets", () => {
  it("crée un preset (201) et transmet created_by", async () => {
    creerPresetMock.mockResolvedValue({ id: "p1" });
    const { POST } = await import("@/app/api/admin/creneaux/presets/route");
    const res = asMockResponse(
      await POST(
        new Request("http://x", {
          method: "POST",
          body: JSON.stringify({
            label: "Collectif vendredi 18h",
            dureeMin: 60,
            heureDebut: "18:00",
            capacite: 8,
          }),
        }),
      ),
    );
    expect(res.status).toBe(201);
    // 2e argument = userId admin (created_by).
    expect(creerPresetMock.mock.calls[0][1]).toBe("admin-1");
  });

  it("400 si label manquant", async () => {
    const { POST } = await import("@/app/api/admin/creneaux/presets/route");
    const res = asMockResponse(
      await POST(
        new Request("http://x", {
          method: "POST",
          body: JSON.stringify({ dureeMin: 60, heureDebut: "18:00" }),
        }),
      ),
    );
    expect(res.status).toBe(400);
    expect(creerPresetMock).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/admin/creneaux/presets", () => {
  it("édite un preset (200)", async () => {
    majPresetMock.mockResolvedValue({ id: "p1", label: "Nouveau" });
    const { PATCH } = await import("@/app/api/admin/creneaux/presets/route");
    const res = asMockResponse(
      await PATCH(
        new Request("http://x", {
          method: "PATCH",
          body: JSON.stringify({ id: "p1", label: "Nouveau" }),
        }),
      ),
    );
    expect(res.status).toBe(200);
  });

  it("404 si le preset n'existe pas", async () => {
    majPresetMock.mockResolvedValue(null);
    const { PATCH } = await import("@/app/api/admin/creneaux/presets/route");
    const res = asMockResponse(
      await PATCH(
        new Request("http://x", {
          method: "PATCH",
          body: JSON.stringify({ id: "ghost", label: "X" }),
        }),
      ),
    );
    expect(res.status).toBe(404);
  });

  it("400 sans id", async () => {
    const { PATCH } = await import("@/app/api/admin/creneaux/presets/route");
    const res = asMockResponse(
      await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ label: "X" }) })),
    );
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/admin/creneaux/presets", () => {
  it("supprime un preset (200)", async () => {
    supprimerPresetMock.mockResolvedValue(undefined);
    const { DELETE } = await import("@/app/api/admin/creneaux/presets/route");
    const res = asMockResponse(
      await DELETE(new Request("http://x/api/admin/creneaux/presets?id=p1", { method: "DELETE" })),
    );
    expect(res.status).toBe(200);
    expect(supprimerPresetMock).toHaveBeenCalledWith("p1");
  });

  it("400 sans id", async () => {
    const { DELETE } = await import("@/app/api/admin/creneaux/presets/route");
    const res = asMockResponse(
      await DELETE(new Request("http://x/api/admin/creneaux/presets", { method: "DELETE" })),
    );
    expect(res.status).toBe(400);
  });
});
