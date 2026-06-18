import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeSupabaseMock, asMockResponse, type MockSupabase } from "../helpers/supabase-mock";

/**
 * Tests de POST /api/webhooks/stripe — réception des événements de paiement.
 *
 * Comportements clés couverts :
 *   - 400 si signature invalide ;
 *   - 400 si la signature est trop ancienne (anti-replay) ;
 *   - 200 + crédit du ticket sur `checkout.session.completed` (assertion upsert) ;
 *   - idempotence : l'upsert est émis avec `onConflict: stripe_session_id` +
 *     `ignoreDuplicates` (un même session_id ne crédite jamais 2×) ;
 *   - 500 si le secret webhook n'est pas configuré (fail-safe) ;
 *   - 200 (ACK) sur un événement non géré.
 *
 * On signe les payloads avec une VRAIE signature HMAC-SHA256 (Web Crypto, dispo
 * sous Node 22) afin de tester le code de vérification réel, pas un mock.
 */

vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    })),
  },
}));

let serviceMock: MockSupabase;
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => serviceMock.client),
}));

const SECRET = "whsec_test_secret";

/** Calcule la signature Stripe `t=...,v1=<hmac hex>` pour un payload donné. */
async function signStripe(rawBody: string, timestamp: number): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const buf = await crypto.subtle.sign("HMAC", key, enc.encode(`${timestamp}.${rawBody}`));
  const hex = [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `t=${timestamp},v1=${hex}`;
}

/** Construit une requête signée (ou avec une signature explicite). */
function makeReq(rawBody: string, signature: string | null): Request {
  return {
    text: async () => rawBody,
    headers: { get: (k: string) => (k === "stripe-signature" ? signature : null) },
  } as unknown as Request;
}

function completedEvent(sessionId: string): string {
  return JSON.stringify({
    id: "evt_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        client_reference_id: "user-1",
        payment_intent: "pi_123",
        payment_status: "paid",
        metadata: { user_id: "user-1", type: "collectif", quantite: "10" },
      },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  serviceMock = makeSupabaseMock();
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/webhooks/stripe", () => {
  it("renvoie 500 si STRIPE_WEBHOOK_SECRET n'est pas configuré (fail-safe)", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const res = asMockResponse(await POST(makeReq("{}", "t=1,v1=deadbeef")));
    expect(res.status).toBe(500);
  });

  it("renvoie 400 sur signature absente", async () => {
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const res = asMockResponse(await POST(makeReq("{}", null)));
    expect(res.status).toBe(400);
  });

  it("renvoie 400 sur signature invalide (HMAC ne correspond pas)", async () => {
    const now = Math.floor(Date.now() / 1000);
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const res = asMockResponse(await POST(makeReq("{}", `t=${now},v1=00aa11bb`)));
    expect(res.status).toBe(400);
    // Aucune écriture DB n'a eu lieu.
    expect(serviceMock.calls.length).toBe(0);
  });

  it("renvoie 400 sur signature trop ancienne (anti-replay > 5 min)", async () => {
    const old = Math.floor(Date.now() / 1000) - 6 * 60; // 6 minutes
    const body = completedEvent("cs_replay");
    const sig = await signStripe(body, old); // signature CORRECTE mais horodatage vieux
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const res = asMockResponse(await POST(makeReq(body, sig)));
    expect(res.status).toBe(400);
  });

  it("crédite le ticket sur checkout.session.completed (upsert idempotent)", async () => {
    const now = Math.floor(Date.now() / 1000);
    const body = completedEvent("cs_ok");
    const sig = await signStripe(body, now);
    serviceMock.queueResult("tickets", "upsert", { data: null, error: null });

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const res = asMockResponse(await POST(makeReq(body, sig)));

    expect(res.status).toBe(200);
    expect((res.body as { received?: boolean }).received).toBe(true);

    const upsertCall = serviceMock.calls.find(
      (c) => c.table === "tickets" && c.op === "upsert",
    );
    expect(upsertCall).toBeDefined();
    expect(upsertCall?.payload).toMatchObject({
      user_id: "user-1",
      type: "collectif",
      quantite_initiale: 10,
      quantite_restante: 10,
      stripe_session_id: "cs_ok",
      stripe_payment_id: "pi_123",
    });
    // Idempotence : l'upsert déduplique sur stripe_session_id et ignore les doublons
    // → un rejeu du même webhook ne crédite JAMAIS deux fois.
    expect(upsertCall?.options).toMatchObject({
      onConflict: "stripe_session_id",
      ignoreDuplicates: true,
    });
  });

  it("ne crédite pas (ACK 200) sur un événement non géré", async () => {
    const now = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({
      id: "evt_2",
      type: "payment_intent.created",
      data: { object: { id: "pi_x" } },
    });
    const sig = await signStripe(body, now);
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const res = asMockResponse(await POST(makeReq(body, sig)));
    expect(res.status).toBe(200);
    const upsertCall = serviceMock.calls.find((c) => c.op === "upsert");
    expect(upsertCall).toBeUndefined();
  });

  it("ignore une session non payée (payment_status != paid) sans créditer", async () => {
    const now = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({
      id: "evt_3",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_unpaid",
          payment_status: "unpaid",
          metadata: { user_id: "user-1", type: "collectif", quantite: "1" },
        },
      },
    });
    const sig = await signStripe(body, now);
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const res = asMockResponse(await POST(makeReq(body, sig)));
    expect(res.status).toBe(200);
    expect(serviceMock.calls.find((c) => c.op === "upsert")).toBeUndefined();
  });
});

describe("GET /api/webhooks/stripe", () => {
  it("renvoie 405 (méthode non autorisée)", async () => {
    const { GET } = await import("@/app/api/webhooks/stripe/route");
    const res = asMockResponse(GET());
    expect(res.status).toBe(405);
  });
});
