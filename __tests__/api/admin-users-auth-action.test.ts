import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests de POST /api/admin/users/auth-action — génération de lien recovery /
 * magic-link. Couvre : validation, garde « compte existe », recovery OK,
 * magic-link OK, échec GoTrue → 500, GET → 405.
 *
 * Dépendances mockées : `requireAdmin`, helpers `_lib/auth-admin`.
 */

vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    })),
  },
}));

vi.mock("@/lib/admin", () => ({
  requireAdmin: vi.fn(async () => ({ userId: "admin-1", email: "admin@example.com" })),
}));

const lireUtilisateurMock = vi.fn<
  () => Promise<{ exists: boolean; email: string | null }>
>(async () => ({ exists: true, email: "u@x.fr" }));
const recoveryMock = vi.fn();
const magicMock = vi.fn();
vi.mock("@/app/api/admin/users/_lib/auth-admin", () => ({
  lireUtilisateur: () => lireUtilisateurMock(),
  genererLienRecovery: (e: string) => recoveryMock(e),
  genererLienMagic: (e: string) => magicMock(e),
}));

interface Res {
  body: { ok?: boolean; error?: string; actionLink?: string | null };
  status: number;
}
function makeReq(body: unknown): Request {
  return { json: async () => body } as unknown as Request;
}
const UID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  lireUtilisateurMock.mockResolvedValue({ exists: true, email: "u@x.fr" });
});

describe("POST /api/admin/users/auth-action", () => {
  it("400 sur action invalide", async () => {
    const { POST } = await import("@/app/api/admin/users/auth-action/route");
    const res = (await POST(makeReq({ userId: UID, action: "delete" }))) as unknown as Res;
    expect(res.status).toBe(400);
  });

  it("404 si le compte est introuvable / sans e-mail", async () => {
    lireUtilisateurMock.mockResolvedValue({ exists: false, email: null });
    const { POST } = await import("@/app/api/admin/users/auth-action/route");
    const res = (await POST(makeReq({ userId: UID, action: "recovery" }))) as unknown as Res;
    expect(res.status).toBe(404);
  });

  it("200 recovery : génère le lien et le renvoie (action recovery → genererLienRecovery)", async () => {
    recoveryMock.mockResolvedValue({ actionLink: "https://app/reset#token", emailSent: false });
    const { POST } = await import("@/app/api/admin/users/auth-action/route");
    const res = (await POST(makeReq({ userId: UID, action: "recovery" }))) as unknown as Res;
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.actionLink).toBe("https://app/reset#token");
    expect(recoveryMock).toHaveBeenCalledTimes(1);
    expect(magicMock).not.toHaveBeenCalled();
  });

  it("200 magiclink : appelle genererLienMagic", async () => {
    magicMock.mockResolvedValue({ actionLink: "https://app/magic#token", emailSent: false });
    const { POST } = await import("@/app/api/admin/users/auth-action/route");
    const res = (await POST(makeReq({ userId: UID, action: "magiclink" }))) as unknown as Res;
    expect(res.status).toBe(200);
    expect(magicMock).toHaveBeenCalledTimes(1);
  });

  it("500 si GoTrue échoue", async () => {
    recoveryMock.mockRejectedValue(new Error("GoTrue down"));
    const { POST } = await import("@/app/api/admin/users/auth-action/route");
    const res = (await POST(makeReq({ userId: UID, action: "recovery" }))) as unknown as Res;
    expect(res.status).toBe(500);
  });
});

describe("GET /api/admin/users/auth-action", () => {
  it("405 méthode non autorisée", async () => {
    const { GET } = await import("@/app/api/admin/users/auth-action/route");
    const res = GET() as unknown as Res;
    expect(res.status).toBe(405);
  });
});
