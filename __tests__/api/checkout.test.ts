import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeSupabaseMock, asMockResponse, type MockSupabase } from "../helpers/supabase-mock";

/**
 * Tests de POST /api/checkout — création d'une Checkout Session Stripe.
 *
 * Comportements clés couverts :
 *   - 401 sans auth ;
 *   - { ready: false } si la clé Stripe n'est pas configurée (fail-safe) ;
 *   - 400 sur une formule inconnue / corps invalide (validation zod) ;
 *   - 400 sur une formule connue mais price id non configuré ;
 *   - 200 + url quand la session est créée (fetch Stripe mocké) ;
 *   - 502 si Stripe renvoie une erreur.
 *
 * L'appel HTTP Stripe est mocké via `fetch` global — aucun appel réseau réel.
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

const USER = { id: "user-1", email: "cliente@example.com", user_metadata: {} };

function makeReq(body: unknown, headers: Record<string, string> = {}): Request {
  return {
    json: async () => body,
    headers: {
      get: (k: string) => headers[k.toLowerCase()] ?? null,
    },
  } as unknown as Request;
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  serverMock = makeSupabaseMock(USER);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/checkout", () => {
  it("renvoie 401 sans authentification", async () => {
    serverMock = makeSupabaseMock(null);
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    const { POST } = await import("@/app/api/checkout/route");
    const res = asMockResponse(await POST(makeReq({ formule: "collectif" })));
    expect(res.status).toBe(401);
  });

  it("renvoie { ready: false } quand STRIPE_SECRET_KEY est absent (fail-safe)", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    const { POST } = await import("@/app/api/checkout/route");
    const res = asMockResponse(await POST(makeReq({ formule: "collectif" })));
    expect((res.body as { ready?: boolean }).ready).toBe(false);
    // fetch Stripe ne doit pas avoir été appelé.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renvoie 400 sur une formule inconnue (validation zod)", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    const { POST } = await import("@/app/api/checkout/route");
    const res = asMockResponse(await POST(makeReq({ formule: "premium" })));
    expect(res.status).toBe(400);
  });

  it("renvoie 400 si ni formule ni priceId ne sont fournis", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    const { POST } = await import("@/app/api/checkout/route");
    const res = asMockResponse(await POST(makeReq({})));
    expect(res.status).toBe(400);
  });

  it("renvoie 400 si la formule est connue mais son price id n'est pas configuré", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    // STRIPE_PRICE_COLLECTIF non défini → resolveFormule renvoie null.
    const { POST } = await import("@/app/api/checkout/route");
    const res = asMockResponse(await POST(makeReq({ formule: "collectif" })));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("happy path : crée la session et renvoie l'url Stripe", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    vi.stubEnv("STRIPE_PRICE_COLLECTIF", "price_collectif_123");
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ url: "https://checkout.stripe.com/c/session_abc" }),
    });

    const { POST } = await import("@/app/api/checkout/route");
    const res = asMockResponse(await POST(
      makeReq({ formule: "collectif" }, { origin: "https://app.yoga-sculpt.fr" }),
    ));

    expect(res.status).toBe(200);
    expect((res.body as { url?: string }).url).toBe(
      "https://checkout.stripe.com/c/session_abc",
    );
    // Vérifie qu'on a bien tapé l'API Stripe avec le bon price + le user lié.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
    const bodyStr = (init.body as URLSearchParams).toString();
    expect(bodyStr).toContain("line_items%5B0%5D%5Bprice%5D=price_collectif_123");
    expect(bodyStr).toContain("client_reference_id=user-1");
    expect(bodyStr).toContain("metadata%5Btype%5D=collectif");
    expect(bodyStr).toContain("metadata%5Bquantite%5D=1");
  });

  it("renvoie 502 si Stripe répond une erreur", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    vi.stubEnv("STRIPE_PRICE_COLLECTIF", "price_collectif_123");
    fetchMock.mockResolvedValue({
      ok: false,
      status: 402,
      text: async () => "card_declined",
    });
    const { POST } = await import("@/app/api/checkout/route");
    const res = asMockResponse(await POST(makeReq({ formule: "collectif" })));
    expect(res.status).toBe(502);
  });
});
