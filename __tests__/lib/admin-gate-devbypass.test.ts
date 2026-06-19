import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Couvre la BRANCHE DEV-BYPASS de `requireAdmin()` (src/lib/admin.ts) — DEV LOCAL
 * UNIQUEMENT. On mocke `@/lib/dev-auth` pour forcer le bypass actif et piloter le
 * rôle simulé (admin / user) + le user de test, sans dépendre de NODE_ENV ni du
 * client Supabase réel.
 *
 * Rappel sécu : ce chemin est PHYSIQUEMENT mort en prod (DEV_AUTH_BYPASS est figé
 * `false` en NODE_ENV=production, prouvé par dev-auth.test.ts). On teste ici qu'en
 * DEV il se comporte correctement (admin → contexte, user normal → /espace,
 * user introuvable → /login).
 */

class RedirectError extends Error {
  constructor(public destination: string) {
    super(`NEXT_REDIRECT:${destination}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: vi.fn((dest: string) => {
    throw new RedirectError(dest);
  }),
}));

// createClient ne doit JAMAIS être atteint dans la branche bypass.
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => {
    throw new Error("createClient ne doit pas être appelé en mode bypass");
  }),
}));

// Pilotage du module dev-auth (drapeaux figés en vrai → ici on les contrôle).
const loadDevBypassUserMock = vi.fn();
let devBypassIsAdmin = true;
vi.mock("@/lib/dev-auth", () => ({
  get DEV_AUTH_BYPASS() {
    return true;
  },
  get DEV_BYPASS_IS_ADMIN() {
    return devBypassIsAdmin;
  },
  loadDevBypassUser: () => loadDevBypassUserMock(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  devBypassIsAdmin = true;
});

describe("requireAdmin — branche DEV bypass", () => {
  it("DEV_BYPASS_ROLE=admin → renvoie le contexte sans exiger la whitelist", async () => {
    devBypassIsAdmin = true;
    loadDevBypassUserMock.mockResolvedValue({
      id: "dev-id",
      email: "dev@local",
    });
    const { requireAdmin } = await import("@/lib/admin");
    const ctx = await requireAdmin();
    expect(ctx).toEqual({ userId: "dev-id", email: "dev@local" });
  });

  it("bypass user NORMAL (pas admin, hors whitelist) → redirige vers /espace", async () => {
    devBypassIsAdmin = false;
    process.env.ADMIN_EMAILS = "alice@example.fr"; // dev-user n'y figure pas
    loadDevBypassUserMock.mockResolvedValue({
      id: "dev-id",
      email: "lambda@local",
    });
    const { requireAdmin } = await import("@/lib/admin");
    await expect(requireAdmin()).rejects.toMatchObject({ destination: "/espace" });
    delete process.env.ADMIN_EMAILS;
  });

  it("user de test introuvable → redirige vers /login", async () => {
    loadDevBypassUserMock.mockResolvedValue(null);
    const { requireAdmin } = await import("@/lib/admin");
    await expect(requireAdmin()).rejects.toMatchObject({ destination: "/login" });
  });

  it("email par défaut 'dev-admin@local' si le user de test n'a pas d'email", async () => {
    devBypassIsAdmin = true;
    loadDevBypassUserMock.mockResolvedValue({ id: "dev-id" });
    const { requireAdmin } = await import("@/lib/admin");
    const ctx = await requireAdmin();
    expect(ctx.email).toBe("dev-admin@local");
  });
});
