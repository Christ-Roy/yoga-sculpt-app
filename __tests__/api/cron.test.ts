import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests de GET /api/cron — déclencheur des rappels mail (J-1 / H-2).
 * On mocke `scanAndSendReminders` : ici on teste UNIQUEMENT la garde d'auth
 * (CRON_SECRET) et le routage des réponses, pas la logique d'envoi (testée
 * ailleurs au niveau de lib/reminders).
 */

const scanMock = vi.fn();
vi.mock("@/lib/reminders", () => ({
  scanAndSendReminders: () => scanMock(),
}));

// Passes annexes du même tick : mockées pour isoler la garde d'auth + le routage.
const attendanceMock = vi.fn(async () => ({ marquees: 0, erreurs: 0 }));
vi.mock("@/lib/attendance", () => ({
  markPastBookingsAttended: () => attendanceMock(),
}));

const relancesMock = vi.fn(async () => ({
  jamaisReserve: 0,
  dormant: 0,
  ticketDormant: 0,
  erreurs: 0,
}));
vi.mock("@/lib/relance", () => ({
  scanAndSendRelances: () => relancesMock(),
}));

function req(opts: { header?: string; query?: string } = {}) {
  const url = opts.query
    ? `https://app.yoga-sculpt.fr/api/cron?secret=${opts.query}`
    : "https://app.yoga-sculpt.fr/api/cron";
  const headers = new Headers();
  if (opts.header) headers.set("x-cron-secret", opts.header);
  return new Request(url, { headers });
}

describe("GET /api/cron", () => {
  beforeEach(() => {
    scanMock.mockReset();
    attendanceMock.mockClear();
    relancesMock.mockClear();
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("503 si CRON_SECRET n'est pas configuré (fail-safe)", async () => {
    delete process.env.CRON_SECRET;
    const { GET } = await import("@/app/api/cron/route");
    const res = await GET(req({ header: "peu-importe" }));
    expect(res.status).toBe(503);
    expect(scanMock).not.toHaveBeenCalled();
  });

  it("401 si le secret est absent de la requête", async () => {
    process.env.CRON_SECRET = "secret-attendu";
    const { GET } = await import("@/app/api/cron/route");
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(scanMock).not.toHaveBeenCalled();
  });

  it("401 si le secret fourni est faux", async () => {
    process.env.CRON_SECRET = "secret-attendu";
    const { GET } = await import("@/app/api/cron/route");
    const res = await GET(req({ header: "mauvais-secret-de-meme-longueur" }));
    expect(res.status).toBe(401);
    expect(scanMock).not.toHaveBeenCalled();
  });

  it("200 + lance le scan si le secret est correct (header)", async () => {
    process.env.CRON_SECRET = "secret-attendu";
    scanMock.mockResolvedValue({ j1: 2, h2: 1 });
    const { GET } = await import("@/app/api/cron/route");
    const res = await GET(req({ header: "secret-attendu" }));
    expect(res.status).toBe(200);
    expect(scanMock).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.j1).toBe(2);
  });

  it("accepte aussi le secret via query param ?secret=", async () => {
    process.env.CRON_SECRET = "abc";
    scanMock.mockResolvedValue({ j1: 0, h2: 0 });
    const { GET } = await import("@/app/api/cron/route");
    const res = await GET(req({ query: "abc" }));
    expect(res.status).toBe(200);
    expect(scanMock).toHaveBeenCalledTimes(1);
  });

  it("500 si le scan échoue", async () => {
    process.env.CRON_SECRET = "abc";
    scanMock.mockRejectedValue(new Error("supabase down"));
    const { GET } = await import("@/app/api/cron/route");
    const res = await GET(req({ header: "abc" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });
});

describe("GET /api/cron — passe relance des inactifs", () => {
  beforeEach(() => {
    scanMock.mockReset();
    scanMock.mockResolvedValue({ j1Envoyes: 0, h2Envoyes: 0, erreurs: 0 });
    attendanceMock.mockClear();
    relancesMock.mockClear();
    relancesMock.mockResolvedValue({
      jamaisReserve: 0,
      dormant: 0,
      ticketDormant: 0,
      erreurs: 0,
    });
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.CRON_SECRET;
    vi.restoreAllMocks();
  });

  it("déclenche la passe relance et remonte son bilan dans la réponse", async () => {
    process.env.CRON_SECRET = "abc";
    relancesMock.mockResolvedValue({
      jamaisReserve: 2,
      dormant: 1,
      ticketDormant: 3,
      erreurs: 0,
    });
    const { GET } = await import("@/app/api/cron/route");
    const res = await GET(req({ header: "abc" }));
    expect(res.status).toBe(200);
    expect(relancesMock).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.relances).toEqual({
      jamaisReserve: 2,
      dormant: 1,
      ticketDormant: 3,
      erreurs: 0,
    });
  });

  it("une passe relance qui throw n'échoue PAS le cron (best-effort)", async () => {
    process.env.CRON_SECRET = "abc";
    relancesMock.mockRejectedValue(new Error("relance KO"));
    const { GET } = await import("@/app/api/cron/route");
    const res = await GET(req({ header: "abc" }));
    // Les rappels (passe 1) ont réussi → 200, relances avec erreur signalée.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.relances.erreurs).toBe(1);
  });

  it("ne déclenche PAS la passe relance sans secret valide", async () => {
    process.env.CRON_SECRET = "abc";
    const { GET } = await import("@/app/api/cron/route");
    const res = await GET(req({ header: "faux-secret-meme-longueur-xx" }));
    expect(res.status).toBe(401);
    expect(relancesMock).not.toHaveBeenCalled();
  });
});
