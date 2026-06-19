import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests des helpers d'ADMINISTRATION AUTH (GoTrue) —
 * `src/app/api/admin/users/_lib/auth-admin.ts`.
 *
 * Ces helpers n'appellent que `supabase.auth.admin.*` (generateLink /
 * inviteUserByEmail / updateUserById / getUserById). On mocke ce sous-objet et on
 * vérifie :
 *   - generateLink(recovery|magiclink) : type/email/redirectTo transmis,
 *     `action_link` remonté, `emailSent:false` (generateLink n'envoie PAS) ;
 *   - inviteUserByEmail : `emailSent:true` + action_link éventuel ;
 *   - suspendre/réactiver : ban_duration ('876000h' / 'none') ;
 *   - lireUtilisateur : exists/email selon la présence du user ;
 *   - propagation des erreurs GoTrue en throw (utilisateur introuvable, etc.).
 */

interface AdminApi {
  generateLink: ReturnType<typeof vi.fn>;
  inviteUserByEmail: ReturnType<typeof vi.fn>;
  updateUserById: ReturnType<typeof vi.fn>;
  getUserById: ReturnType<typeof vi.fn>;
}

let adminApi: AdminApi;
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => ({ auth: { admin: adminApi } })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  adminApi = {
    generateLink: vi.fn(),
    inviteUserByEmail: vi.fn(),
    updateUserById: vi.fn(),
    getUserById: vi.fn(),
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("genererLienRecovery / genererLienMagic", () => {
  it("recovery : appelle generateLink(type:recovery) et remonte action_link (emailSent:false)", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.yoga-sculpt.fr");
    adminApi.generateLink.mockResolvedValue({
      data: { properties: { action_link: "https://app.x/recover?token=abc" } },
      error: null,
    });
    const { genererLienRecovery } = await import(
      "@/app/api/admin/users/_lib/auth-admin"
    );
    const res = await genererLienRecovery("cliente@x.fr");
    expect(res).toEqual({
      actionLink: "https://app.x/recover?token=abc",
      emailSent: false,
    });
    expect(adminApi.generateLink).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "recovery",
        email: "cliente@x.fr",
        options: { redirectTo: "https://app.yoga-sculpt.fr/auth/callback" },
      }),
    );
  });

  it("magiclink : remonte action_link", async () => {
    adminApi.generateLink.mockResolvedValue({
      data: { properties: { action_link: "https://app.x/magic?token=z" } },
      error: null,
    });
    const { genererLienMagic } = await import(
      "@/app/api/admin/users/_lib/auth-admin"
    );
    const res = await genererLienMagic("cliente@x.fr");
    expect(res.actionLink).toBe("https://app.x/magic?token=z");
    expect(res.emailSent).toBe(false);
    expect(adminApi.generateLink).toHaveBeenCalledWith(
      expect.objectContaining({ type: "magiclink" }),
    );
  });

  it("actionLink null si GoTrue ne renvoie pas de properties", async () => {
    adminApi.generateLink.mockResolvedValue({ data: {}, error: null });
    const { genererLienMagic } = await import(
      "@/app/api/admin/users/_lib/auth-admin"
    );
    expect((await genererLienMagic("x@x.fr")).actionLink).toBeNull();
  });

  it("propage l'erreur GoTrue (utilisateur introuvable) en throw", async () => {
    adminApi.generateLink.mockResolvedValue({
      data: {},
      error: { message: "User not found" },
    });
    const { genererLienRecovery } = await import(
      "@/app/api/admin/users/_lib/auth-admin"
    );
    await expect(genererLienRecovery("ghost@x.fr")).rejects.toThrow(/User not found/);
  });
});

describe("inviterEmail", () => {
  it("déclenche l'envoi (emailSent:true) et remonte l'action_link du user créé", async () => {
    adminApi.inviteUserByEmail.mockResolvedValue({
      data: { user: { id: "new-id", action_link: "https://app.x/invite?token=t" } },
      error: null,
    });
    const { inviterEmail } = await import(
      "@/app/api/admin/users/_lib/auth-admin"
    );
    const res = await inviterEmail("nouvelle@x.fr");
    expect(res).toEqual({
      actionLink: "https://app.x/invite?token=t",
      emailSent: true,
    });
  });

  it("emailSent:true même sans action_link sur le user", async () => {
    adminApi.inviteUserByEmail.mockResolvedValue({
      data: { user: { id: "new-id" } },
      error: null,
    });
    const { inviterEmail } = await import(
      "@/app/api/admin/users/_lib/auth-admin"
    );
    const res = await inviterEmail("nouvelle@x.fr");
    expect(res).toEqual({ actionLink: null, emailSent: true });
  });

  it("propage l'erreur (email déjà inscrit) en throw", async () => {
    adminApi.inviteUserByEmail.mockResolvedValue({
      data: { user: null },
      error: { message: "email already registered" },
    });
    const { inviterEmail } = await import(
      "@/app/api/admin/users/_lib/auth-admin"
    );
    await expect(inviterEmail("dej@x.fr")).rejects.toThrow(/already registered/);
  });
});

describe("suspendreCompte / reactiverCompte", () => {
  it("suspend avec ban_duration ≈ 100 ans (876000h)", async () => {
    adminApi.updateUserById.mockResolvedValue({ error: null });
    const { suspendreCompte } = await import(
      "@/app/api/admin/users/_lib/auth-admin"
    );
    await suspendreCompte("user-1");
    expect(adminApi.updateUserById).toHaveBeenCalledWith("user-1", {
      ban_duration: "876000h",
    });
  });

  it("réactive avec ban_duration:'none'", async () => {
    adminApi.updateUserById.mockResolvedValue({ error: null });
    const { reactiverCompte } = await import(
      "@/app/api/admin/users/_lib/auth-admin"
    );
    await reactiverCompte("user-1");
    expect(adminApi.updateUserById).toHaveBeenCalledWith("user-1", {
      ban_duration: "none",
    });
  });

  it("propage l'erreur GoTrue sur suspend en throw", async () => {
    adminApi.updateUserById.mockResolvedValue({
      error: { message: "boom" },
    });
    const { suspendreCompte } = await import(
      "@/app/api/admin/users/_lib/auth-admin"
    );
    await expect(suspendreCompte("user-1")).rejects.toThrow(/boom/);
  });
});

describe("lireUtilisateur", () => {
  it("exists:true + email quand le user est trouvé", async () => {
    adminApi.getUserById.mockResolvedValue({
      data: { user: { id: "u1", email: "found@x.fr" } },
      error: null,
    });
    const { lireUtilisateur } = await import(
      "@/app/api/admin/users/_lib/auth-admin"
    );
    expect(await lireUtilisateur("u1")).toEqual({
      exists: true,
      email: "found@x.fr",
    });
  });

  it("exists:false si GoTrue renvoie une erreur ou aucun user (garde id fantôme)", async () => {
    adminApi.getUserById.mockResolvedValue({
      data: { user: null },
      error: { message: "not found" },
    });
    const { lireUtilisateur } = await import(
      "@/app/api/admin/users/_lib/auth-admin"
    );
    expect(await lireUtilisateur("ghost")).toEqual({
      exists: false,
      email: null,
    });
  });
});
