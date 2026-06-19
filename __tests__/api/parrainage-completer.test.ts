import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  makeSupabaseMock,
  asMockResponse,
  type MockSupabase,
} from "../helpers/supabase-mock";

/**
 * Tests de POST /api/parrainage/completer — LIAISON du parrainage d'un FILLEUL.
 *
 * ⚠️ ANTI-FARMING (2026-06-19) : cette route NE CRÉDITE PLUS le parrain. Elle se
 * contente de LIER le filleul à son parrain en `pending` (ticket_credite=false).
 * Le ticket du parrain ne tombe qu'à la 1re séance HONORÉE du filleul (cf.
 * crediterParrainsApresSeanceHonoree, testé dans referral-lib.test.ts). Aucun de
 * ces tests ne doit donc jamais observer d'insert dans `tickets`.
 *
 * POINT CRUCIAL : la réponse est TOUJOURS 200 { ok: true } dès lors que la
 * requête est bien formée et l'utilisateur authentifié (échec silencieux).
 *
 * Comportements couverts :
 *   - 401 sans authentification ;
 *   - 400 sur corps invalide / JSON invalide ;
 *   - 200 sans code (on enregistre juste les signaux, aucune liaison) ;
 *   - 200 + LIAISON pending (referral créé, AUCUN ticket) sur code valide ;
 *   - 200 SILENCIEUX sur code inconnu (aucune liaison, aucun ticket) ;
 *   - 200 SILENCIEUX si le filleul tente de se parrainer lui-même (aucun ticket) ;
 *   - JAMAIS de ticket crédité à l'inscription, quel que soit le cas ;
 *   - GET → 405.
 *
 * On utilise le VRAI lib/referral + lib/anti-abuse + lib/fingerprint (logique
 * métier réelle), piloté via le mock Supabase. Aucun appel réseau ni DB réels.
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
let serviceMock: MockSupabase;

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => serverMock.client),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => serviceMock.client),
}));

const FILLEUL = {
  id: "filleul-1",
  email: "filleul@example.com",
  user_metadata: {},
};
const PARRAIN_ID = "parrain-1";
const CODE = "ABCD2345";

/**
 * Construit une requête sans header d'IP (→ getClientIp renvoie null) et sans
 * fingerprint exploitable.
 */
function makeReq(body: unknown): Request {
  return {
    json: async () => body,
    headers: { get: (_k: string) => null },
  } as unknown as Request;
}

/**
 * Programme la séquence Supabase d'une LIAISON pending (nouveau flux). Ordre :
 *   1. enregistrerSignaux  → account_signals::select (existant) puis ::upsert
 *   2. completerReferral :
 *      a. profiles::select  → résolution du parrain via le code
 *      b. lierFilleulSansCrediter → referrals::select (pending existant ?)
 *      c. referrals::insert → création du referral pending à la volée
 *   (PLUS de R4, plafond, ticket, marquage : tout cela est déféré à la séance.)
 */
function queueLegitLink() {
  serviceMock.queueResult("account_signals", "select", { data: null, error: null });
  serviceMock.queueResult("account_signals", "upsert", { data: null, error: null });
  serviceMock.queueResult("profiles", "select", {
    data: { id: PARRAIN_ID },
    error: null,
  });
  // lierFilleulSansCrediter : pas de pending existant → insert.
  serviceMock.queueResult("referrals", "select", { data: null, error: null });
  serviceMock.queueResult("referrals", "insert", { data: null, error: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  serverMock = makeSupabaseMock(FILLEUL);
  serviceMock = makeSupabaseMock(FILLEUL);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/parrainage/completer", () => {
  it("renvoie 401 sans authentification", async () => {
    serverMock = makeSupabaseMock(null);
    const { POST } = await import("@/app/api/parrainage/completer/route");
    const res = asMockResponse(await POST(makeReq({ code: CODE })));
    expect(res.status).toBe(401);
  });

  it("renvoie 400 sur un corps invalide (champ inconnu)", async () => {
    const { POST } = await import("@/app/api/parrainage/completer/route");
    const res = asMockResponse(await POST(makeReq({ wrong: "x" })));
    expect(res.status).toBe(400);
  });

  it("renvoie 400 sur un corps JSON invalide", async () => {
    const badReq = {
      json: async () => {
        throw new SyntaxError("bad json");
      },
      headers: { get: () => null },
    } as unknown as Request;
    const { POST } = await import("@/app/api/parrainage/completer/route");
    const res = asMockResponse(await POST(badReq));
    expect(res.status).toBe(400);
  });

  it("200 sans code : enregistre juste les signaux, aucune liaison (aucun ticket)", async () => {
    serviceMock.queueResult("account_signals", "select", { data: null, error: null });
    serviceMock.queueResult("account_signals", "upsert", { data: null, error: null });

    const { POST } = await import("@/app/api/parrainage/completer/route");
    const res = asMockResponse(await POST(makeReq({})));

    expect(res.status).toBe(200);
    expect((res.body as { ok: boolean }).ok).toBe(true);
    // Aucun ticket inséré (pas de code → completerReferral pas appelé).
    expect(
      serviceMock.calls.find((c) => c.table === "tickets" && c.op === "insert"),
    ).toBeUndefined();
    // Les signaux ont bien été upsertés.
    expect(
      serviceMock.calls.find(
        (c) => c.table === "account_signals" && c.op === "upsert",
      ),
    ).toBeDefined();
  });

  it("200 + LIAISON pending sur code valide — AUCUN ticket crédité à l'inscription", async () => {
    queueLegitLink();

    const { POST } = await import("@/app/api/parrainage/completer/route");
    const res = asMockResponse(await POST(makeReq({ code: CODE })));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    // Le filleul a bien été LIÉ : un referral pending est inséré, lié au filleul.
    const refInsert = serviceMock.calls.find(
      (c) => c.table === "referrals" && c.op === "insert",
    );
    expect(refInsert).toBeDefined();
    expect(refInsert?.payload).toMatchObject({
      parrain_user_id: PARRAIN_ID,
      filleul_user_id: FILLEUL.id,
      status: "pending",
    });

    // ANTI-FARMING : AUCUN ticket crédité à l'inscription (le crédit est déféré).
    expect(
      serviceMock.calls.find((c) => c.table === "tickets" && c.op === "insert"),
    ).toBeUndefined();
  });

  it("200 + LIAISON via update si un referral pending (invitation e-mail) existe déjà", async () => {
    serviceMock.queueResult("account_signals", "select", { data: null, error: null });
    serviceMock.queueResult("account_signals", "upsert", { data: null, error: null });
    serviceMock.queueResult("profiles", "select", {
      data: { id: PARRAIN_ID },
      error: null,
    });
    // lierFilleulSansCrediter : pending existant trouvé → update (rattache filleul).
    serviceMock.queueResult("referrals", "select", {
      data: { id: "ref-invite" },
      error: null,
    });
    serviceMock.queueResult("referrals", "update", { data: null, error: null });

    const { POST } = await import("@/app/api/parrainage/completer/route");
    const res = asMockResponse(await POST(makeReq({ code: CODE })));

    expect(res.status).toBe(200);
    const upd = serviceMock.calls.find(
      (c) => c.table === "referrals" && c.op === "update",
    );
    expect(upd?.payload).toMatchObject({ filleul_user_id: FILLEUL.id });
    expect(
      serviceMock.calls.find((c) => c.table === "tickets" && c.op === "insert"),
    ).toBeUndefined();
  });

  it("200 SILENCIEUX sur code inconnu — aucune liaison, aucun motif révélé", async () => {
    serviceMock.queueResult("account_signals", "select", { data: null, error: null });
    serviceMock.queueResult("account_signals", "upsert", { data: null, error: null });
    // Résolution du parrain : code inconnu → pas de profil.
    serviceMock.queueResult("profiles", "select", { data: null, error: null });

    const { POST } = await import("@/app/api/parrainage/completer/route");
    const res = asMockResponse(await POST(makeReq({ code: "ZZZZ9999" })));

    // Réponse strictement identique au happy path → échec silencieux.
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(
      serviceMock.calls.find((c) => c.table === "tickets" && c.op === "insert"),
    ).toBeUndefined();
    // Code inconnu → on ne lie même pas de referral.
    expect(
      serviceMock.calls.find((c) => c.table === "referrals" && c.op === "insert"),
    ).toBeUndefined();
  });

  it("200 SILENCIEUX si le filleul utilise son PROPRE code (auto-parrainage)", async () => {
    serviceMock.queueResult("account_signals", "select", { data: null, error: null });
    serviceMock.queueResult("account_signals", "upsert", { data: null, error: null });
    // Le code résout vers… le filleul lui-même.
    serviceMock.queueResult("profiles", "select", {
      data: { id: FILLEUL.id },
      error: null,
    });

    const { POST } = await import("@/app/api/parrainage/completer/route");
    const res = asMockResponse(await POST(makeReq({ code: CODE })));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(
      serviceMock.calls.find((c) => c.table === "tickets" && c.op === "insert"),
    ).toBeUndefined();
    // Auto-parrainage : aucune liaison non plus.
    expect(
      serviceMock.calls.find((c) => c.table === "referrals" && c.op === "insert"),
    ).toBeUndefined();
  });
});

describe("GET /api/parrainage/completer", () => {
  it("renvoie 405 (méthode non autorisée)", async () => {
    const { GET } = await import("@/app/api/parrainage/completer/route");
    const res = asMockResponse(GET());
    expect(res.status).toBe(405);
  });
});
