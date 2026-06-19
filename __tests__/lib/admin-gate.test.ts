import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeSupabaseMock, type MockSupabase } from "../helpers/supabase-mock";

/**
 * Tests de la GARDE admin serveur — `src/lib/admin.ts`.
 *
 * C'est LA vérification qui fait foi (défense en profondeur, ne se repose PAS sur
 * le seul middleware edge — cf CVE-2025-29927). On prouve ici :
 *   - getAdminEmails : parsing CSV, normalisation casse/espaces, fail-safe set VIDE
 *     quand `ADMIN_EMAILS` absent (personne admin par défaut) ;
 *   - estAdmin : insensible à la casse / aux espaces, false sur null/undefined/"" ;
 *   - requireAdmin : redirect('/login') sans session, redirect('/espace') si non
 *     whitelisté, contexte renvoyé si autorisé.
 *
 * `redirect()` de next/navigation lève une exception de contrôle de flux : on la
 * mocke pour qu'elle THROW (comme en vrai) afin de prouver que le code en aval ne
 * s'exécute pas quand l'accès est refusé.
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

let serverMock: MockSupabase;
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => serverMock.client),
}));

// dev-auth neutralisé par défaut (NODE_ENV=test mais bypass OFF, var absente) :
// DEV_AUTH_BYPASS est figé au chargement du module. On ne touche pas au bypass
// ici (couvert par dev-auth.test.ts) ; on veut le flux PROD standard.

beforeEach(() => {
  vi.clearAllMocks();
  serverMock = makeSupabaseMock(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getAdminEmails", () => {
  it("parse un CSV en normalisant casse + espaces", async () => {
    vi.stubEnv("ADMIN_EMAILS", " Alice@Example.FR , bob@x.fr ");
    const { getAdminEmails } = await import("@/lib/admin");
    const set = getAdminEmails();
    expect(set.has("alice@example.fr")).toBe(true);
    expect(set.has("bob@x.fr")).toBe(true);
    expect(set.size).toBe(2);
  });

  it("ignore les entrées vides (virgules superflues)", async () => {
    vi.stubEnv("ADMIN_EMAILS", "a@x.fr,,, ,b@x.fr,");
    const { getAdminEmails } = await import("@/lib/admin");
    expect(getAdminEmails().size).toBe(2);
  });

  it("FAIL-SAFE : set VIDE si ADMIN_EMAILS absent (personne admin par défaut)", async () => {
    vi.stubEnv("ADMIN_EMAILS", "");
    const { getAdminEmails } = await import("@/lib/admin");
    expect(getAdminEmails().size).toBe(0);
  });
});

describe("estAdmin", () => {
  it("true uniquement pour un email whitelisté (casse/espaces ignorés)", async () => {
    vi.stubEnv("ADMIN_EMAILS", "alice@example.fr");
    const { estAdmin } = await import("@/lib/admin");
    expect(estAdmin("ALICE@example.fr")).toBe(true);
    expect(estAdmin("  alice@example.fr  ")).toBe(true);
    expect(estAdmin("mallory@evil.fr")).toBe(false);
  });

  it("false sur null / undefined / chaîne vide", async () => {
    vi.stubEnv("ADMIN_EMAILS", "alice@example.fr");
    const { estAdmin } = await import("@/lib/admin");
    expect(estAdmin(null)).toBe(false);
    expect(estAdmin(undefined)).toBe(false);
    expect(estAdmin("")).toBe(false);
  });
});

describe("requireAdmin", () => {
  it("redirige vers /login sans session", async () => {
    vi.stubEnv("ADMIN_EMAILS", "alice@example.fr");
    serverMock = makeSupabaseMock(null); // pas d'utilisateur
    const { requireAdmin } = await import("@/lib/admin");
    await expect(requireAdmin()).rejects.toMatchObject({
      destination: "/login",
    });
  });

  it("redirige vers /espace si connecté mais HORS whitelist (pas de 403 bavard)", async () => {
    vi.stubEnv("ADMIN_EMAILS", "alice@example.fr");
    serverMock = makeSupabaseMock({ id: "u-1", email: "cliente@example.fr" });
    const { requireAdmin } = await import("@/lib/admin");
    await expect(requireAdmin()).rejects.toMatchObject({
      destination: "/espace",
    });
  });

  it("renvoie le contexte admin (userId + email) si whitelisté", async () => {
    vi.stubEnv("ADMIN_EMAILS", "alice@example.fr,bob@x.fr");
    serverMock = makeSupabaseMock({ id: "admin-id", email: "Alice@Example.fr" });
    const { requireAdmin } = await import("@/lib/admin");
    const ctx = await requireAdmin();
    expect(ctx).toEqual({ userId: "admin-id", email: "Alice@Example.fr" });
  });
});
