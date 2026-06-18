import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  makeSupabaseMock,
  asMockResponse,
  type MockSupabase,
} from "../helpers/supabase-mock";

/**
 * Tests de GET /api/parrainage — état du parrainage du membre connecté.
 *
 * Comportements clés couverts :
 *   - 401 sans authentification ;
 *   - 200 happy path : renvoie le code existant + la liste des filleuls
 *     (mappée) + le compteur `ticketsGagnes` (nb de filleuls crédités) ;
 *   - génération/persistance du code quand le profil n'en a pas encore
 *     (assertion sur l'update `profiles.referral_code`) ;
 *   - 500 si la lecture des filleuls échoue.
 *
 * Dépendances externes mockées : Supabase (server pour l'auth + service pour la
 * lecture). Aucun appel réseau ni DB réels.
 */

// ── Mock NextResponse : on récupère { body, status } sans vrai objet Response. ──
vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    })),
  },
}));

// ── Mocks Supabase : réinjectés à chaque test via les variables ci-dessous. ────
let serverMock: MockSupabase;
let serviceMock: MockSupabase;

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => serverMock.client),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => serviceMock.client),
}));

const USER = { id: "parrain-1", email: "parrain@example.com", user_metadata: {} };

beforeEach(() => {
  vi.clearAllMocks();
  serverMock = makeSupabaseMock(USER);
  serviceMock = makeSupabaseMock(USER);
});

describe("GET /api/parrainage", () => {
  it("renvoie 401 sans authentification", async () => {
    serverMock = makeSupabaseMock(null); // pas d'utilisateur
    const { GET } = await import("@/app/api/parrainage/route");
    const res = asMockResponse(await GET());
    expect(res.status).toBe(401);
  });

  it("happy path : 200 avec code existant, filleuls mappés et ticketsGagnes", async () => {
    // 1) getOrCreateCode : le profil a déjà un code → pas d'update.
    serviceMock.queueResult("profiles", "select", {
      data: { referral_code: "ABCD2345" },
      error: null,
    });
    // 2) Liste des filleuls (1 complété/crédité + 1 pending).
    serviceMock.queueResult("referrals", "select", {
      data: [
        {
          filleul_email: "completed@y.fr",
          status: "completed",
          ticket_credite: true,
          created_at: "2026-06-10T00:00:00.000Z",
          completed_at: "2026-06-11T00:00:00.000Z",
        },
        {
          filleul_email: "pending@y.fr",
          status: "pending",
          ticket_credite: false,
          created_at: "2026-06-09T00:00:00.000Z",
          completed_at: null,
        },
      ],
      error: null,
    });

    const { GET } = await import("@/app/api/parrainage/route");
    const res = asMockResponse(await GET());

    expect(res.status).toBe(200);
    const body = res.body as {
      code: string;
      filleuls: Array<{
        email: string;
        status: string;
        ticketCredite: boolean;
        completedAt: string | null;
      }>;
      ticketsGagnes: number;
    };
    expect(body.code).toBe("ABCD2345");
    expect(body.filleuls).toHaveLength(2);
    expect(body.filleuls[0]).toEqual({
      email: "completed@y.fr",
      status: "completed",
      ticketCredite: true,
      createdAt: "2026-06-10T00:00:00.000Z",
      completedAt: "2026-06-11T00:00:00.000Z",
    });
    // completedAt null préservé pour un pending.
    expect(body.filleuls[1].completedAt).toBeNull();
    // 1 seul filleul crédité → 1 ticket gagné.
    expect(body.ticketsGagnes).toBe(1);
  });

  it("liste vide : code présent, filleuls = [] et ticketsGagnes = 0", async () => {
    serviceMock.queueResult("profiles", "select", {
      data: { referral_code: "WXYZ6789" },
      error: null,
    });
    // referrals::select non programmé → DEFAULT_RESULT { data: null } → [] après ?? [].

    const { GET } = await import("@/app/api/parrainage/route");
    const res = asMockResponse(await GET());

    expect(res.status).toBe(200);
    const body = res.body as { filleuls: unknown[]; ticketsGagnes: number };
    expect(body.filleuls).toEqual([]);
    expect(body.ticketsGagnes).toBe(0);
  });

  it("génère et persiste le code si le profil n'en a pas encore", async () => {
    // 1) Lecture initiale : pas de code.
    serviceMock.queueResult("profiles", "select", {
      data: { referral_code: null },
      error: null,
    });
    // 2) Update OK (aucune erreur).
    serviceMock.queueResult("profiles", "update", { data: null, error: null });
    // 3) Relecture après update : le code posé.
    serviceMock.queueResult("profiles", "select", {
      data: { referral_code: "NEWCODE9" },
      error: null,
    });
    serviceMock.queueResult("referrals", "select", { data: [], error: null });

    const { GET } = await import("@/app/api/parrainage/route");
    const res = asMockResponse(await GET());

    expect(res.status).toBe(200);
    expect((res.body as { code: string }).code).toBe("NEWCODE9");

    // Un update sur profiles.referral_code a bien été émis avec un code généré.
    const updateCall = serviceMock.calls.find(
      (c) => c.table === "profiles" && c.op === "update",
    );
    expect(updateCall).toBeDefined();
    const payload = updateCall?.payload as { referral_code: string };
    // Le code généré fait 8 caractères de l'alphabet non ambigu.
    expect(payload.referral_code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
  });

  it("renvoie 500 si la génération du code échoue durablement", async () => {
    // Lecture initiale : pas de code…
    serviceMock.queueResult("profiles", "select", {
      data: { referral_code: null },
      error: null,
    });
    // …puis l'update échoue avec une erreur non-unique → getOrCreateCode renvoie null.
    serviceMock.queueResult("profiles", "update", {
      data: null,
      error: { message: "permission denied" },
    });

    const { GET } = await import("@/app/api/parrainage/route");
    const res = asMockResponse(await GET());
    expect(res.status).toBe(500);
  });

  it("renvoie 500 si la lecture des filleuls échoue", async () => {
    serviceMock.queueResult("profiles", "select", {
      data: { referral_code: "ABCD2345" },
      error: null,
    });
    serviceMock.queueResult("referrals", "select", {
      data: null,
      error: { message: "relation referrals manquante" },
    });

    const { GET } = await import("@/app/api/parrainage/route");
    const res = asMockResponse(await GET());
    expect(res.status).toBe(500);
  });
});
