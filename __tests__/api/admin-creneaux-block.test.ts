import { describe, it, expect, vi, beforeEach } from "vitest";
import { asMockResponse } from "../helpers/supabase-mock";

/**
 * Tests de POST /api/admin/creneaux/block — bloque une journée (event all-day).
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

function blockReq(body: unknown) {
  return new Request("http://x/api/admin/creneaux/block", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue({ userId: "admin-1", email: "alice@x.fr" });
  insertEventMock.mockResolvedValue({ id: "off-1" });
});

describe("POST /api/admin/creneaux/block", () => {
  it("crée un event all-day (201) avec end.date = lendemain", async () => {
    const { POST } = await import("@/app/api/admin/creneaux/block/route");
    const res = asMockResponse(await POST(blockReq({ date: "2026-07-03", motif: "Congés" })));
    expect(res.status).toBe(201);
    const written = insertEventMock.mock.calls[0][0];
    expect(written.start.date).toBe("2026-07-03");
    expect(written.end.date).toBe("2026-07-04"); // exclusif côté Google
    expect(written.summary).toContain("Congés");
  });

  it("400 si la date est invalide", async () => {
    const { POST } = await import("@/app/api/admin/creneaux/block/route");
    const res = asMockResponse(await POST(blockReq({ date: "bad" })));
    expect(res.status).toBe(400);
    expect(insertEventMock).not.toHaveBeenCalled();
  });

  it("502 si l'écriture Google échoue", async () => {
    insertEventMock.mockRejectedValueOnce(new Error("down"));
    const { POST } = await import("@/app/api/admin/creneaux/block/route");
    const res = asMockResponse(await POST(blockReq({ date: "2026-07-03" })));
    expect(res.status).toBe(502);
  });
});
