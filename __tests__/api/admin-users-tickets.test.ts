import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests de POST /api/admin/users/tickets — crédit / débit manuel par l'admin.
 *
 * Couvre : gate admin, validation stricte du corps, garde « compte existe »,
 * crédit OK, débit OK, débit refusé (solde insuffisant → 409), GET → 405.
 *
 * Dépendances mockées : `requireAdmin`, les helpers `_lib/tickets-admin` et
 * `_lib/auth-admin` (lireUtilisateur). Aucun appel réseau / DB réel.
 */

vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    })),
  },
}));

const requireAdminMock = vi.fn(async () => ({
  userId: "admin-1",
  email: "admin@example.com",
}));
vi.mock("@/lib/admin", () => ({
  requireAdmin: () => requireAdminMock(),
}));

const lireUtilisateurMock = vi.fn<
  (id?: string) => Promise<{ exists: boolean; email: string | null }>
>(async () => ({ exists: true, email: "u@x.fr" }));
vi.mock("@/app/api/admin/users/_lib/auth-admin", () => ({
  lireUtilisateur: (id: string) => lireUtilisateurMock(id),
}));

const crediterMock = vi.fn();
const debiterMock = vi.fn();
vi.mock("@/app/api/admin/users/_lib/tickets-admin", () => ({
  crediterTickets: (p: unknown) => crediterMock(p),
  debiterTickets: (p: unknown) => debiterMock(p),
}));

interface Res {
  body: { ok?: boolean; error?: string; soldeApres?: number; message?: string };
  status: number;
}
function makeReq(body: unknown): Request {
  return { json: async () => body } as unknown as Request;
}
const UID = "11111111-1111-4111-8111-111111111111";
const OP = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue({ userId: "admin-1", email: "admin@example.com" });
  lireUtilisateurMock.mockResolvedValue({ exists: true, email: "u@x.fr" });
});

describe("POST /api/admin/users/tickets", () => {
  it("400 sur corps invalide (champ inconnu / userId non-UUID)", async () => {
    const { POST } = await import("@/app/api/admin/users/tickets/route");
    const res = (await POST(makeReq({ userId: "pas-uuid" }))) as unknown as Res;
    expect(res.status).toBe(400);
  });

  it("400 sur quantite hors bornes (> 50)", async () => {
    const { POST } = await import("@/app/api/admin/users/tickets/route");
    const res = (await POST(
      makeReq({ userId: UID, type: "collectif", sens: "credit", quantite: 99, opId: OP }),
    )) as unknown as Res;
    expect(res.status).toBe(400);
  });

  it("404 si le compte cible n'existe pas", async () => {
    lireUtilisateurMock.mockResolvedValue({ exists: false, email: null });
    const { POST } = await import("@/app/api/admin/users/tickets/route");
    const res = (await POST(
      makeReq({ userId: UID, type: "collectif", sens: "credit", quantite: 1, opId: OP }),
    )) as unknown as Res;
    expect(res.status).toBe(404);
  });

  it("200 sur crédit OK (appelle crediterTickets, pas debiterTickets)", async () => {
    crediterMock.mockResolvedValue({ ok: true, soldeApres: 3, message: "Crédit de 1." });
    const { POST } = await import("@/app/api/admin/users/tickets/route");
    const res = (await POST(
      makeReq({ userId: UID, type: "collectif", sens: "credit", quantite: 1, opId: OP }),
    )) as unknown as Res;
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.soldeApres).toBe(3);
    expect(crediterMock).toHaveBeenCalledTimes(1);
    expect(debiterMock).not.toHaveBeenCalled();
  });

  it("200 sur débit OK (appelle debiterTickets)", async () => {
    debiterMock.mockResolvedValue({ ok: true, soldeApres: 1, message: "Débit de 1." });
    const { POST } = await import("@/app/api/admin/users/tickets/route");
    const res = (await POST(
      makeReq({ userId: UID, type: "particulier", sens: "debit", quantite: 1, opId: OP }),
    )) as unknown as Res;
    expect(res.status).toBe(200);
    expect(debiterMock).toHaveBeenCalledTimes(1);
  });

  it("409 si débit refusé pour solde insuffisant", async () => {
    debiterMock.mockResolvedValue({
      ok: false,
      soldeApres: 0,
      message: "Solde insuffisant : 0 séance(s) collectif disponibles, 5 demandée(s).",
    });
    const { POST } = await import("@/app/api/admin/users/tickets/route");
    const res = (await POST(
      makeReq({ userId: UID, type: "collectif", sens: "debit", quantite: 5, opId: OP }),
    )) as unknown as Res;
    expect(res.status).toBe(409);
  });

  it("500 si l'écriture échoue (message non « Solde insuffisant »)", async () => {
    crediterMock.mockResolvedValue({ ok: false, soldeApres: 0, message: "Crédit échoué : boom" });
    const { POST } = await import("@/app/api/admin/users/tickets/route");
    const res = (await POST(
      makeReq({ userId: UID, type: "collectif", sens: "credit", quantite: 1, opId: OP }),
    )) as unknown as Res;
    expect(res.status).toBe(500);
  });
});

describe("GET /api/admin/users/tickets", () => {
  it("405 méthode non autorisée", async () => {
    const { GET } = await import("@/app/api/admin/users/tickets/route");
    const res = GET() as unknown as Res;
    expect(res.status).toBe(405);
  });
});
