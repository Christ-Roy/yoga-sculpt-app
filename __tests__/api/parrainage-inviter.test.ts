import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  makeSupabaseMock,
  asMockResponse,
  type MockSupabase,
} from "../helpers/supabase-mock";

/**
 * Tests de POST /api/parrainage/inviter — invitation d'un filleul par e-mail.
 *
 * Comportements clés couverts :
 *   - 401 sans authentification ;
 *   - 400 sur corps invalide (champ inconnu / e-mail absent / e-mail malformé) ;
 *   - 400 sur e-mail jetable (anti-spam) ;
 *   - 422 si on tente de s'inviter soi-même ;
 *   - 409 { error: "deja_invite" } si l'unicité (parrain, email) est violée (23505) ;
 *   - 200 { ok, code } happy path + création d'un referral pending (assertion payload) ;
 *   - sans BREVO_API_KEY : invitation enregistrée, envoi e-mail no-op (pas de fetch) ;
 *   - avec BREVO_API_KEY : l'API Brevo est appelée (fetch mocké, lien ?ref=<code>).
 *   - GET → 405 (méthode non autorisée).
 *
 * Dépendances externes mockées : Supabase (server+service) et `fetch` (Brevo).
 * Aucun appel réseau réel.
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

const USER = { id: "parrain-1", email: "parrain@example.com", user_metadata: {} };
const CODE = "ABCD2345";

function makeReq(body: unknown): Request {
  return { json: async () => body } as unknown as Request;
}

const fetchMock = vi.fn();

/** Programme getOrCreateCode pour renvoyer un code DÉJÀ présent sur le profil. */
function queueExistingCode() {
  serviceMock.queueResult("profiles", "select", {
    data: { referral_code: CODE },
    error: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  serverMock = makeSupabaseMock(USER);
  serviceMock = makeSupabaseMock(USER);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/parrainage/inviter", () => {
  it("renvoie 401 sans authentification", async () => {
    serverMock = makeSupabaseMock(null);
    const { POST } = await import("@/app/api/parrainage/inviter/route");
    const res = asMockResponse(await POST(makeReq({ email: "ami@example.com" })));
    expect(res.status).toBe(401);
  });

  it("renvoie 400 sur un corps invalide (champ inconnu / email absent)", async () => {
    const { POST } = await import("@/app/api/parrainage/inviter/route");
    const res = asMockResponse(await POST(makeReq({ wrong: "x" })));
    expect(res.status).toBe(400);
  });

  it("renvoie 400 sur un e-mail malformé", async () => {
    const { POST } = await import("@/app/api/parrainage/inviter/route");
    const res = asMockResponse(await POST(makeReq({ email: "pas-un-email" })));
    expect(res.status).toBe(400);
  });

  it("renvoie 400 sur un corps JSON invalide", async () => {
    const badReq = {
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    } as unknown as Request;
    const { POST } = await import("@/app/api/parrainage/inviter/route");
    const res = asMockResponse(await POST(badReq));
    expect(res.status).toBe(400);
  });

  it("renvoie 400 sur une adresse e-mail jetable (anti-spam)", async () => {
    const { POST } = await import("@/app/api/parrainage/inviter/route");
    const res = asMockResponse(
      await POST(makeReq({ email: "abuser@mailinator.com" })),
    );
    expect(res.status).toBe(400);
    // Aucune écriture DB n'a eu lieu (bloqué avant getOrCreateCode/insert).
    expect(serviceMock.calls.length).toBe(0);
  });

  it("renvoie 422 si on tente de s'inviter soi-même", async () => {
    const { POST } = await import("@/app/api/parrainage/inviter/route");
    // Même e-mail que l'utilisateur connecté (casse/espaces normalisés).
    const res = asMockResponse(
      await POST(makeReq({ email: "  PARRAIN@example.com  " })),
    );
    expect(res.status).toBe(422);
    expect(serviceMock.calls.length).toBe(0);
  });

  it("renvoie 409 deja_invite si l'unicité (parrain, email) est violée", async () => {
    queueExistingCode();
    serviceMock.queueResult("referrals", "insert", {
      data: null,
      error: { code: "23505", message: "duplicate key value" },
    });

    const { POST } = await import("@/app/api/parrainage/inviter/route");
    const res = asMockResponse(await POST(makeReq({ email: "ami@example.com" })));

    expect(res.status).toBe(409);
    expect((res.body as { error: string }).error).toBe("deja_invite");
  });

  it("renvoie 500 si l'insert referral échoue (erreur non-unique)", async () => {
    queueExistingCode();
    serviceMock.queueResult("referrals", "insert", {
      data: null,
      error: { code: "42P01", message: "relation referrals manquante" },
    });

    const { POST } = await import("@/app/api/parrainage/inviter/route");
    const res = asMockResponse(await POST(makeReq({ email: "ami@example.com" })));
    expect(res.status).toBe(500);
  });

  it("happy path SANS BREVO_API_KEY : 200 {ok, code}, referral pending créé, pas d'envoi e-mail", async () => {
    vi.stubEnv("BREVO_API_KEY", ""); // pas de clé → envoi no-op
    queueExistingCode();
    serviceMock.queueResult("referrals", "insert", { data: null, error: null });

    const { POST } = await import("@/app/api/parrainage/inviter/route");
    const res = asMockResponse(
      await POST(makeReq({ email: "Ami@Example.com" })),
    );

    expect(res.status).toBe(200);
    expect((res.body as { ok: boolean }).ok).toBe(true);
    expect((res.body as { code: string }).code).toBe(CODE);

    // Le referral pending a bien été inséré, e-mail NORMALISÉ (minuscules).
    const insertCall = serviceMock.calls.find(
      (c) => c.table === "referrals" && c.op === "insert",
    );
    expect(insertCall?.payload).toMatchObject({
      parrain_user_id: USER.id,
      filleul_email: "ami@example.com",
      code: CODE,
      status: "pending",
    });

    // BREVO_API_KEY absente → aucun appel réseau.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("happy path AVEC BREVO_API_KEY : appelle l'API Brevo avec le lien ?ref=<code>", async () => {
    vi.stubEnv("BREVO_API_KEY", "xkeysib-test");
    queueExistingCode();
    serviceMock.queueResult("referrals", "insert", { data: null, error: null });
    fetchMock.mockResolvedValue({
      ok: true,
      status: 201,
      text: async () => "",
    });

    const { POST } = await import("@/app/api/parrainage/inviter/route");
    const res = asMockResponse(await POST(makeReq({ email: "ami@example.com" })));

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    const sentBody = JSON.parse(init.body as string) as {
      to: Array<{ email: string }>;
      htmlContent: string;
      textContent: string;
    };
    expect(sentBody.to[0].email).toBe("ami@example.com");
    // Le lien d'inscription embarque le code de parrainage.
    expect(sentBody.htmlContent).toContain(`ref=${CODE}`);
    expect(sentBody.textContent).toContain(`ref=${CODE}`);
  });

  it("reste 200 même si l'envoi Brevo échoue (best-effort, non bloquant)", async () => {
    vi.stubEnv("BREVO_API_KEY", "xkeysib-test");
    queueExistingCode();
    serviceMock.queueResult("referrals", "insert", { data: null, error: null });
    // fetch rejette → la route catch et continue.
    fetchMock.mockRejectedValue(new Error("Brevo injoignable"));

    const { POST } = await import("@/app/api/parrainage/inviter/route");
    const res = asMockResponse(await POST(makeReq({ email: "ami@example.com" })));
    expect(res.status).toBe(200);
    expect((res.body as { ok: boolean }).ok).toBe(true);
  });
});

describe("GET /api/parrainage/inviter", () => {
  it("renvoie 405 (méthode non autorisée)", async () => {
    const { GET } = await import("@/app/api/parrainage/inviter/route");
    const res = asMockResponse(GET());
    expect(res.status).toBe(405);
  });
});
