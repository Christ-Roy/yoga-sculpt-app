import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests de POST /api/admin/users/suspendre — suspension / réactivation.
 * Couvre : validation, garde anti-auto-suspension (403), compte introuvable
 * (404), suspension OK, réactivation OK, échec GoTrue → 500, GET → 405.
 */

vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    })),
  },
}));

const requireAdminMock = vi.fn(async () => ({ userId: "admin-1", email: "admin@example.com" }));
vi.mock("@/lib/admin", () => ({ requireAdmin: () => requireAdminMock() }));

const lireUtilisateurMock = vi.fn<
  () => Promise<{ exists: boolean; email: string | null }>
>(async () => ({ exists: true, email: "u@x.fr" }));
const suspendreMock = vi.fn<(id: string) => Promise<void>>(async () => undefined);
const reactiverMock = vi.fn<(id: string) => Promise<void>>(async () => undefined);
vi.mock("@/app/api/admin/users/_lib/auth-admin", () => ({
  lireUtilisateur: () => lireUtilisateurMock(),
  suspendreCompte: (id: string) => suspendreMock(id),
  reactiverCompte: (id: string) => reactiverMock(id),
}));

interface Res {
  body: { ok?: boolean; error?: string; suspendu?: boolean };
  status: number;
}
function makeReq(body: unknown): Request {
  return { json: async () => body } as unknown as Request;
}
const UID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue({ userId: "admin-1", email: "admin@example.com" });
  lireUtilisateurMock.mockResolvedValue({ exists: true, email: "u@x.fr" });
});

describe("POST /api/admin/users/suspendre", () => {
  it("400 sur corps invalide (suspendre non booléen)", async () => {
    const { POST } = await import("@/app/api/admin/users/suspendre/route");
    const res = (await POST(makeReq({ userId: UID, suspendre: "oui" }))) as unknown as Res;
    expect(res.status).toBe(400);
  });

  it("403 si l'admin tente de se suspendre lui-même", async () => {
    requireAdminMock.mockResolvedValue({ userId: UID, email: "admin@example.com" });
    const { POST } = await import("@/app/api/admin/users/suspendre/route");
    const res = (await POST(makeReq({ userId: UID, suspendre: true }))) as unknown as Res;
    expect(res.status).toBe(403);
    expect(suspendreMock).not.toHaveBeenCalled();
  });

  it("404 si le compte est introuvable", async () => {
    lireUtilisateurMock.mockResolvedValue({ exists: false, email: null });
    const { POST } = await import("@/app/api/admin/users/suspendre/route");
    const res = (await POST(makeReq({ userId: UID, suspendre: true }))) as unknown as Res;
    expect(res.status).toBe(404);
  });

  it("200 suspension OK (appelle suspendreCompte)", async () => {
    const { POST } = await import("@/app/api/admin/users/suspendre/route");
    const res = (await POST(makeReq({ userId: UID, suspendre: true }))) as unknown as Res;
    expect(res.status).toBe(200);
    expect(res.body.suspendu).toBe(true);
    expect(suspendreMock).toHaveBeenCalledTimes(1);
    expect(reactiverMock).not.toHaveBeenCalled();
  });

  it("200 réactivation OK (appelle reactiverCompte)", async () => {
    const { POST } = await import("@/app/api/admin/users/suspendre/route");
    const res = (await POST(makeReq({ userId: UID, suspendre: false }))) as unknown as Res;
    expect(res.status).toBe(200);
    expect(res.body.suspendu).toBe(false);
    expect(reactiverMock).toHaveBeenCalledTimes(1);
  });

  it("500 si GoTrue échoue", async () => {
    suspendreMock.mockRejectedValue(new Error("GoTrue down"));
    const { POST } = await import("@/app/api/admin/users/suspendre/route");
    const res = (await POST(makeReq({ userId: UID, suspendre: true }))) as unknown as Res;
    expect(res.status).toBe(500);
  });
});

describe("GET /api/admin/users/suspendre", () => {
  it("405 méthode non autorisée", async () => {
    const { GET } = await import("@/app/api/admin/users/suspendre/route");
    const res = GET() as unknown as Res;
    expect(res.status).toBe(405);
  });
});
