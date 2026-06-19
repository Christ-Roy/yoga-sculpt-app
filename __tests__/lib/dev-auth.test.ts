import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computeDevAuthBypass } from "@/lib/dev-auth";

/**
 * Tests de la GARDE du bypass d'auth DEV (src/lib/dev-auth.ts).
 *
 * Le test CRITIQUE (sécurité) : prouver que `NODE_ENV=production` neutralise le
 * bypass MÊME quand `NEXT_PUBLIC_DEV_AUTH_BYPASS=1`. C'est l'invariant qui rend
 * impossible l'activation du bypass en prod/staging.
 *
 * On teste la FONCTION PURE `computeDevAuthBypass(env)` (et non le drapeau global
 * `DEV_AUTH_BYPASS` figé au chargement du module) : c'est exactement la même
 * logique que celle utilisée pour calculer le drapeau, mais paramétrable, donc
 * déterministe et testable sans tripoter `process.env` au runtime.
 */
describe("computeDevAuthBypass — garde combinée (env + NODE_ENV)", () => {
  it("🔴 CRITIQUE : NODE_ENV=production neutralise le bypass MÊME si la var =1", () => {
    expect(
      computeDevAuthBypass({
        NEXT_PUBLIC_DEV_AUTH_BYPASS: "1",
        NODE_ENV: "production",
      }),
    ).toBe(false);
  });

  it("actif uniquement si var=1 ET NODE_ENV != production (dev)", () => {
    expect(
      computeDevAuthBypass({
        NEXT_PUBLIC_DEV_AUTH_BYPASS: "1",
        NODE_ENV: "development",
      }),
    ).toBe(true);
  });

  it("actif aussi en NODE_ENV=test (tout sauf production)", () => {
    expect(
      computeDevAuthBypass({
        NEXT_PUBLIC_DEV_AUTH_BYPASS: "1",
        NODE_ENV: "test",
      }),
    ).toBe(true);
  });

  it("inactif si la var est absente, même hors production", () => {
    expect(
      computeDevAuthBypass({ NODE_ENV: "development" }),
    ).toBe(false);
  });

  it("inactif pour toute valeur de var différente de la chaîne exacte \"1\"", () => {
    for (const v of ["0", "", "true", "yes", "1 ", " 1", "01", "ON"]) {
      expect(
        computeDevAuthBypass({
          NEXT_PUBLIC_DEV_AUTH_BYPASS: v,
          NODE_ENV: "development",
        }),
      ).toBe(false);
    }
  });

  it("inactif si NODE_ENV=production quelle que soit la var (balayage)", () => {
    for (const v of ["1", "0", undefined, "true"]) {
      expect(
        computeDevAuthBypass({
          NEXT_PUBLIC_DEV_AUTH_BYPASS: v,
          NODE_ENV: "production",
        }),
      ).toBe(false);
    }
  });

  it("inactif si les deux conditions manquent (défaut sûr)", () => {
    expect(computeDevAuthBypass({})).toBe(false);
  });
});

/**
 * Tests de `loadDevBypassUser` — chargement best-effort du user de test (DEV).
 * Mémorisé au niveau module → `vi.resetModules()` entre les cas pour repartir
 * d'un cache vide. On mocke le service client (auth.admin.getUserById).
 */
const getUserByIdMock = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => ({
    auth: { admin: { getUserById: getUserByIdMock } },
  })),
}));

describe("loadDevBypassUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renvoie le user de test quand le service le trouve", async () => {
    getUserByIdMock.mockResolvedValue({
      data: { user: { id: "dev-user", email: "onboarding-dev@yoga-sculpt.fr" } },
      error: null,
    });
    const { loadDevBypassUser } = await import("@/lib/dev-auth");
    const user = await loadDevBypassUser();
    expect(user?.id).toBe("dev-user");
    // 2e appel : sert depuis le cache mémoire (pas de 2e requête).
    await loadDevBypassUser();
    expect(getUserByIdMock).toHaveBeenCalledTimes(1);
  });

  it("renvoie null si le compte de test est introuvable (best-effort)", async () => {
    getUserByIdMock.mockResolvedValue({
      data: { user: null },
      error: { message: "not found" },
    });
    const { loadDevBypassUser } = await import("@/lib/dev-auth");
    expect(await loadDevBypassUser()).toBeNull();
  });

  it("renvoie null si l'appel jette (clé service absente, etc.)", async () => {
    getUserByIdMock.mockRejectedValue(new Error("no service key"));
    const { loadDevBypassUser } = await import("@/lib/dev-auth");
    expect(await loadDevBypassUser()).toBeNull();
  });
});
