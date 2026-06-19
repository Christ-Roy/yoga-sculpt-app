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

  it("400 sur un payload JSON invalide (signature OK mais corps non-JSON)", async () => {
    const now = Math.floor(Date.now() / 1000);
    const body = "ceci-n-est-pas-du-json";
    const sig = await signStripe(body, now);
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const res = asMockResponse(await POST(makeReq(body, sig)));
    expect(res.status).toBe(400);
    expect(serviceMock.calls.find((c) => c.op === "upsert")).toBeUndefined();
  });

  it("ACK 200 sans créditer quand metadata.user_id est absent (rien d'exploitable)", async () => {
    const now = Math.floor(Date.now() / 1000);
    // payment_status paid mais AUCUNE metadata → crediterTickets sort sans erreur.
    const body = JSON.stringify({
      id: "evt_4",
      type: "checkout.session.completed",
      data: {
        object: { id: "cs_nometa", payment_status: "paid", metadata: {} },
      },
    });
    const sig = await signStripe(body, now);
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const res = asMockResponse(await POST(makeReq(body, sig)));
    // ACK 200 : rejouer n'aiderait pas (la session est inexploitable).
    expect(res.status).toBe(200);
    expect(serviceMock.calls.find((c) => c.op === "upsert")).toBeUndefined();
  });

  it("ACK 200 sans créditer quand quantite est ≤ 0 ou non numérique", async () => {
    const now = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({
      id: "evt_5",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_badqty",
          payment_status: "paid",
          metadata: { user_id: "user-1", type: "collectif", quantite: "0" },
        },
      },
    });
    const sig = await signStripe(body, now);
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const res = asMockResponse(await POST(makeReq(body, sig)));
    expect(res.status).toBe(200);
    expect(serviceMock.calls.find((c) => c.op === "upsert")).toBeUndefined();
  });

  it("500 si l'écriture DB échoue → Stripe re-tentera (l'upsert reste idempotent)", async () => {
    const now = Math.floor(Date.now() / 1000);
    const body = completedEvent("cs_dberr");
    const sig = await signStripe(body, now);
    // L'upsert tickets renvoie une erreur DB.
    serviceMock.queueResult("tickets", "upsert", {
      data: null,
      error: { message: "deadlock detected" },
    });
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const res = asMockResponse(await POST(makeReq(body, sig)));
    expect(res.status).toBe(500);
  });

  it("ATTRIBUTION ADS : écrit la conversion purchase quand le user a un gclid (paiement → Google)", async () => {
    const now = Math.floor(Date.now() / 1000);
    // Session payée AVEC amount_total (2000 centimes = 20 €).
    const body = JSON.stringify({
      id: "evt_ads_ok",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_ads",
          client_reference_id: "user-1",
          payment_intent: "pi_ads",
          payment_status: "paid",
          amount_total: 2000,
          metadata: { user_id: "user-1", type: "collectif", quantite: "1" },
        },
      },
    });
    const sig = await signStripe(body, now);
    serviceMock.queueResult("tickets", "upsert", { data: null, error: null });
    // getUserGclid → le profil porte un gclid (user venu d'un clic Ads).
    serviceMock.queueResult("profiles", "select", {
      data: { gclid: "GCLID_TEST_ABC" },
      error: null,
    });

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const res = asMockResponse(await POST(makeReq(body, sig)));
    expect(res.status).toBe(200);

    // Une conversion purchase doit être enregistrée (journal ads_conversions),
    // attribuée au gclid, valeur = montant payé, idempotente sur (kind, source_ref).
    const conv = serviceMock.calls.find(
      (c) => c.table === "ads_conversions" && c.op === "upsert",
    );
    expect(conv).toBeDefined();
    expect(conv?.payload).toMatchObject({
      user_id: "user-1",
      kind: "purchase",
      source_ref: "cs_ads",
      gclid: "GCLID_TEST_ABC",
      value_eur: 20,
      uploaded: false,
    });
    expect(conv?.options).toMatchObject({
      onConflict: "kind,source_ref",
      ignoreDuplicates: true,
    });
  });

  it("ATTRIBUTION ADS : N'écrit AUCUNE conversion quand le user n'a pas de gclid (pas venu de l'Ads)", async () => {
    const now = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({
      id: "evt_ads_nogclid",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_nogclid",
          client_reference_id: "user-1",
          payment_intent: "pi_x",
          payment_status: "paid",
          amount_total: 2000,
          metadata: { user_id: "user-1", type: "collectif", quantite: "1" },
        },
      },
    });
    const sig = await signStripe(body, now);
    serviceMock.queueResult("tickets", "upsert", { data: null, error: null });
    // getUserGclid → profil SANS gclid.
    serviceMock.queueResult("profiles", "select", {
      data: { gclid: null },
      error: null,
    });

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const res = asMockResponse(await POST(makeReq(body, sig)));
    expect(res.status).toBe(200);
    // Aucune écriture dans ads_conversions (rien à attribuer).
    expect(
      serviceMock.calls.find((c) => c.table === "ads_conversions"),
    ).toBeUndefined();
  });

  it("accepte le fallback client_reference_id quand metadata.user_id est absent", async () => {
    const now = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({
      id: "evt_6",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_fallback",
          client_reference_id: "user-fallback",
          payment_status: "paid",
          metadata: { type: "collectif", quantite: "5" },
        },
      },
    });
    const sig = await signStripe(body, now);
    serviceMock.queueResult("tickets", "upsert", { data: null, error: null });
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const res = asMockResponse(await POST(makeReq(body, sig)));
    expect(res.status).toBe(200);
    const upsert = serviceMock.calls.find(
      (c) => c.table === "tickets" && c.op === "upsert",
    );
    expect(upsert?.payload).toMatchObject({
      user_id: "user-fallback",
      type: "collectif",
      quantite_initiale: 5,
    });
  });
});

describe("GET /api/webhooks/stripe", () => {
  it("renvoie 405 (méthode non autorisée)", async () => {
    const { GET } = await import("@/app/api/webhooks/stripe/route");
    const res = asMockResponse(GET());
    expect(res.status).toBe(405);
  });
});
