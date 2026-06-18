import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  makeSupabaseMock,
  asMockResponse,
  type MockSupabase,
} from "../helpers/supabase-mock";

/**
 * Tests de POST /api/parrainage/completer — complétion du parrainage d'un FILLEUL.
 *
 * POINT CRUCIAL : la réponse est TOUJOURS 200 { ok: true } dès lors que la
 * requête est bien formée et l'utilisateur authentifié — que le crédit ait eu
 * lieu OU PAS (anti-abus, code inconnu, déjà crédité…). On ne révèle JAMAIS le
 * motif d'un non-crédit (échec silencieux).
 *
 * Comportements couverts :
 *   - 401 sans authentification ;
 *   - 400 sur corps invalide / JSON invalide ;
 *   - 200 sans code (on enregistre juste les signaux, aucun crédit) ;
 *   - 200 + crédit RÉEL (insert ticket) sur code valide + anti-abus OK ;
 *   - 200 SILENCIEUX sur code inconnu (aucun ticket) ;
 *   - 200 SILENCIEUX si l'anti-abus refuse (filleul déjà crédité) — aucun ticket ;
 *   - 200 SILENCIEUX si le filleul tente de se parrainer lui-même (aucun ticket) ;
 *   - idempotence : un referral déjà crédité ne re-crédite jamais ;
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
 * fingerprint exploitable → on évite les requêtes R2/R3 de canCreditReferral,
 * ce qui garde le séquencement des mocks simple et déterministe.
 */
function makeReq(body: unknown): Request {
  return {
    json: async () => body,
    headers: { get: (_k: string) => null },
  } as unknown as Request;
}

/**
 * Programme la séquence Supabase d'un crédit LÉGITIME (anti-abus OK), sans IP ni
 * fingerprint. Ordre d'exécution réel de la route :
 *   1. enregistrerSignaux  → account_signals::select (existant) puis ::upsert
 *   2. completerReferral :
 *      a. profiles::select  → résolution du parrain via le code
 *      b. canCreditReferral → referrals::select (R4 : filleul déjà crédité ?)
 *      c. referrals::select → recherche d'un pending (parrain, email)
 *      d. referrals::insert → création du referral à la volée (pas de pending)
 *      e. tickets::insert   → crédit du ticket au parrain
 *      f. referrals::update → marquage completed/credite
 */
function queueLegitCredit() {
  // 1. enregistrerSignaux : pas de signaux existants.
  serviceMock.queueResult("account_signals", "select", { data: null, error: null });
  serviceMock.queueResult("account_signals", "upsert", { data: null, error: null });
  // 2a. parrain résolu via le code.
  serviceMock.queueResult("profiles", "select", {
    data: { id: PARRAIN_ID },
    error: null,
  });
  // 2b. R4 : filleul jamais crédité (liste vide).
  serviceMock.queueResult("referrals", "select", { data: [], error: null });
  // 2c. pas de referral pending existant.
  serviceMock.queueResult("referrals", "select", { data: null, error: null });
  // 2d. création du referral à la volée → renvoie un id.
  serviceMock.queueResult("referrals", "insert", {
    data: { id: "ref-new" },
    error: null,
  });
  // 2e. crédit du ticket.
  serviceMock.queueResult("tickets", "insert", { data: null, error: null });
  // 2f. marquage completed (1 ligne touchée → maybeSingle renvoie un id).
  serviceMock.queueResult("referrals", "update", {
    data: { id: "ref-new" },
    error: null,
  });
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

  it("200 sans code : enregistre juste les signaux, aucun crédit (aucun ticket)", async () => {
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

  it("200 + crédit RÉEL du ticket sur code valide et anti-abus OK", async () => {
    queueLegitCredit();

    const { POST } = await import("@/app/api/parrainage/completer/route");
    const res = asMockResponse(await POST(makeReq({ code: CODE })));

    expect(res.status).toBe(200);
    expect((res.body as { ok: boolean }).ok).toBe(true);

    // Le ticket de parrainage a bien été crédité au PARRAIN (type collectif, offert).
    const ticketInsert = serviceMock.calls.find(
      (c) => c.table === "tickets" && c.op === "insert",
    );
    expect(ticketInsert).toBeDefined();
    expect(ticketInsert?.payload).toMatchObject({
      user_id: PARRAIN_ID,
      type: "collectif",
      quantite_initiale: 1,
      quantite_restante: 1,
    });

    // Le referral a été marqué completed + crédité.
    const refUpdate = serviceMock.calls.find(
      (c) => c.table === "referrals" && c.op === "update",
    );
    expect(refUpdate?.payload).toMatchObject({
      status: "completed",
      ticket_credite: true,
      filleul_user_id: FILLEUL.id,
    });
  });

  it("200 SILENCIEUX sur code inconnu — aucun ticket, aucun motif révélé", async () => {
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
  });

  it("200 SILENCIEUX si l'anti-abus refuse (filleul déjà crédité) — aucun ticket", async () => {
    serviceMock.queueResult("account_signals", "select", { data: null, error: null });
    serviceMock.queueResult("account_signals", "upsert", { data: null, error: null });
    // Parrain résolu…
    serviceMock.queueResult("profiles", "select", {
      data: { id: PARRAIN_ID },
      error: null,
    });
    // …mais R4 : ce filleul a DÉJÀ déclenché un crédit → canCreditReferral=false.
    serviceMock.queueResult("referrals", "select", {
      data: [{ id: "ref-old" }],
      error: null,
    });
    // lierFilleulSansCrediter : cherche un pending (aucun) puis insert best-effort.
    serviceMock.queueResult("referrals", "select", { data: null, error: null });
    serviceMock.queueResult("referrals", "insert", { data: null, error: null });

    const { POST } = await import("@/app/api/parrainage/completer/route");
    const res = asMockResponse(await POST(makeReq({ code: CODE })));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    // Aucun ticket crédité (anti-abus a bloqué).
    expect(
      serviceMock.calls.find((c) => c.table === "tickets" && c.op === "insert"),
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
  });

  it("idempotence : un referral déjà crédité ne re-crédite jamais (200, aucun ticket)", async () => {
    serviceMock.queueResult("account_signals", "select", { data: null, error: null });
    serviceMock.queueResult("account_signals", "upsert", { data: null, error: null });
    // Parrain résolu.
    serviceMock.queueResult("profiles", "select", {
      data: { id: PARRAIN_ID },
      error: null,
    });
    // R4 : filleul pas encore marqué crédité globalement (liste vide).
    serviceMock.queueResult("referrals", "select", { data: [], error: null });
    // Recherche du pending : trouvé ET déjà ticket_credite=true → idempotence.
    serviceMock.queueResult("referrals", "select", {
      data: { id: "ref-existant", ticket_credite: true },
      error: null,
    });

    const { POST } = await import("@/app/api/parrainage/completer/route");
    const res = asMockResponse(await POST(makeReq({ code: CODE })));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    // Pas de double crédit.
    expect(
      serviceMock.calls.find((c) => c.table === "tickets" && c.op === "insert"),
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
