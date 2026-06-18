import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests de POST /api/admin/users/inviter — (ré)invitation d'un e-mail.
 * Couvre : validation e-mail, invitation OK, e-mail déjà inscrit (409),
 * échec GoTrue générique (500), GET → 405.
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

const inviterEmailMock = vi.fn();
vi.mock("@/app/api/admin/users/_lib/auth-admin", () => ({
  inviterEmail: (e: string) => inviterEmailMock(e),
}));

interface Res {
  body: { ok?: boolean; error?: string; emailSent?: boolean };
  status: number;
}
function makeReq(body: unknown): Request {
  return { json: async () => body } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/admin/users/inviter", () => {
  it("400 sur e-mail malformé", async () => {
    const { POST } = await import("@/app/api/admin/users/inviter/route");
    const res = (await POST(makeReq({ email: "pas-un-email" }))) as unknown as Res;
    expect(res.status).toBe(400);
    expect(inviterEmailMock).not.toHaveBeenCalled();
  });

  it("200 invitation OK (e-mail normalisé en minuscules)", async () => {
    inviterEmailMock.mockResolvedValue({ actionLink: null, emailSent: true });
    const { POST } = await import("@/app/api/admin/users/inviter/route");
    const res = (await POST(makeReq({ email: "  New@Example.COM " }))) as unknown as Res;
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.emailSent).toBe(true);
    expect(inviterEmailMock).toHaveBeenCalledWith("new@example.com");
  });

  it("409 si l'e-mail est déjà inscrit", async () => {
    inviterEmailMock.mockRejectedValue(new Error("A user with this email address has already been registered"));
    const { POST } = await import("@/app/api/admin/users/inviter/route");
    const res = (await POST(makeReq({ email: "deja@example.com" }))) as unknown as Res;
    expect(res.status).toBe(409);
  });

  it("500 sur échec GoTrue générique", async () => {
    inviterEmailMock.mockRejectedValue(new Error("smtp boom"));
    const { POST } = await import("@/app/api/admin/users/inviter/route");
    const res = (await POST(makeReq({ email: "ok@example.com" }))) as unknown as Res;
    expect(res.status).toBe(500);
  });
});

describe("GET /api/admin/users/inviter", () => {
  it("405 méthode non autorisée", async () => {
    const { GET } = await import("@/app/api/admin/users/inviter/route");
    const res = GET() as unknown as Res;
    expect(res.status).toBe(405);
  });
});
