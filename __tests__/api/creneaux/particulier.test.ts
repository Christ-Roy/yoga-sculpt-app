import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  makeSupabaseMock,
  asMockResponse,
  type MockSupabase,
} from "../../helpers/supabase-mock";

/**
 * Tests de GET /api/creneaux/particulier — créneaux LIBRES (cours particulier).
 *
 * Comportements clés couverts :
 *   - 401 sans auth ;
 *   - génère la plage 9h-21h sur l'horizon, MOINS les busy d'Alice (freebusy) ;
 *   - respecte le délai mini de réservation (24h) ;
 *   - 502 si freebusy échoue (on n'ouvre PAS tout 9h-21h à l'aveugle).
 */

vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    })),
  },
}));

let serverMock: MockSupabase;
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => serverMock.client),
}));

const freeBusyQueryMock = vi.fn();
vi.mock("@/lib/google-calendar", () => ({
  freeBusyQuery: (...args: unknown[]) => freeBusyQueryMock(...args),
}));

const USER = { id: "user-1", email: "cliente@example.com", user_metadata: {} };

// Horloge figée : lundi 2026-06-22 08:00 UTC (10h Paris, été = UTC+2).
const NOW = new Date("2026-06-22T08:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  serverMock = makeSupabaseMock(USER);
  freeBusyQueryMock.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/creneaux/particulier", () => {
  it("renvoie 401 sans authentification", async () => {
    serverMock = makeSupabaseMock(null);
    const { GET } = await import("@/app/api/creneaux/particulier/route");
    const res = asMockResponse(await GET());
    expect(res.status).toBe(401);
  });

  it("génère des slots 9h-21h (heure pleine) en respectant le délai 24h", async () => {
    const { GET } = await import("@/app/api/creneaux/particulier/route");
    const res = asMockResponse(await GET());
    expect(res.status).toBe(200);

    const slots = (res.body as { slots: Array<{ starts_at: string; ends_at: string }> })
      .slots;
    expect(slots.length).toBeGreaterThan(0);

    // Toutes les durées = 60 min.
    for (const s of slots) {
      const dureeMin =
        (new Date(s.ends_at).getTime() - new Date(s.starts_at).getTime()) /
        60000;
      expect(dureeMin).toBe(60);
    }

    // Tous au moins 24h dans le futur (délai mini de réservation).
    const seuil = NOW.getTime() + 24 * 60 * 60 * 1000;
    for (const s of slots) {
      expect(new Date(s.starts_at).getTime()).toBeGreaterThanOrEqual(seuil);
    }

    // Toutes les heures de début sont dans [9h, 20h] heure de Paris.
    const heuresParis = new Set(
      slots.map((s) =>
        Number(
          new Intl.DateTimeFormat("fr-FR", {
            timeZone: "Europe/Paris",
            hour: "2-digit",
            hour12: false,
          })
            .format(new Date(s.starts_at))
            .slice(0, 2),
        ),
      ),
    );
    for (const h of heuresParis) {
      expect(h).toBeGreaterThanOrEqual(9);
      expect(h).toBeLessThanOrEqual(20);
    }
  });

  it("retire les créneaux qui chevauchent un busy d'Alice", async () => {
    // Alice occupée mardi 2026-06-23 de 10h à 12h (Paris = 08:00-10:00 UTC).
    freeBusyQueryMock.mockResolvedValueOnce([
      { start: "2026-06-23T08:00:00.000Z", end: "2026-06-23T10:00:00.000Z" },
    ]);

    const { GET } = await import("@/app/api/creneaux/particulier/route");
    const res = asMockResponse(await GET());
    const slots = (res.body as { slots: Array<{ starts_at: string }> }).slots;

    // Aucun slot ne doit démarrer à 10h ou 11h le mardi 23 (Paris).
    const occupes = slots.filter((s) => {
      const d = new Date(s.starts_at);
      const jour = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Paris",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(d);
      const heure = Number(
        new Intl.DateTimeFormat("fr-FR", {
          timeZone: "Europe/Paris",
          hour: "2-digit",
          hour12: false,
        })
          .format(d)
          .slice(0, 2),
      );
      return jour === "2026-06-23" && (heure === 10 || heure === 11);
    });
    expect(occupes).toHaveLength(0);

    // 12h le 23 (juste après le busy 10h-12h) reste libre. NB : 9h/10h/11h sont
    // exclus — 10h/11h par le busy, 9h par le délai mini de réservation (NOW =
    // lundi 10h Paris ⇒ seuil 24h = mardi 10h Paris, donc 9h mardi est trop tôt).
    const douzeHeures = slots.some((s) => {
      const d = new Date(s.starts_at);
      const jour = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Paris",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(d);
      const heure = Number(
        new Intl.DateTimeFormat("fr-FR", {
          timeZone: "Europe/Paris",
          hour: "2-digit",
          hour12: false,
        })
          .format(d)
          .slice(0, 2),
      );
      return jour === "2026-06-23" && heure === 12;
    });
    expect(douzeHeures).toBe(true);
  });

  it("renvoie 502 si freebusy échoue", async () => {
    freeBusyQueryMock.mockRejectedValueOnce(new Error("Google down"));
    const { GET } = await import("@/app/api/creneaux/particulier/route");
    const res = asMockResponse(await GET());
    expect(res.status).toBe(502);
  });
});
