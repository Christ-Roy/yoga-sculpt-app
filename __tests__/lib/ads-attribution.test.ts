import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests de l'attribution Google Ads server-side.
 *
 * Couvre :
 *   - parseGclidCookie : JSON valide / vide / illisible / sans identifiant de clic ;
 *   - captureGclidOnProfile : first-touch (n'écrase pas un gclid existant) ;
 *   - recordAdsConversion : no-op si pas de gclid, upsert idempotent sinon ;
 *   - getUserGclid ;
 *   - google-ads : formatConversionDateTime + sélection gclid/gbraid/wbraid +
 *     readAdsEnv (config incomplète → null) ;
 *   - drainAdsConversions : skip si config absente, upload OK, marquage uploaded.
 *
 * Aucun appel réseau réel : fetch est mocké pour le drain.
 */

import {
  parseGclidCookie,
  captureGclidOnProfile,
  recordAdsConversion,
  getUserGclid,
  drainAdsConversions,
  FREE_TICKET_VALUE_EUR,
} from "@/lib/ads-attribution";
import {
  formatConversionDateTime,
  readAdsEnv,
} from "@/lib/google-ads";

// ── Mock log (évite le bruit console pendant les tests). ───────────────────────
vi.mock("@/lib/log", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  serializeError: (e: unknown) => ({ message: e instanceof Error ? e.message : String(e) }),
}));

// ── Petit mock Supabase chaînable suffisant pour ces fonctions. ────────────────
type Row = Record<string, unknown>;
function makeService(opts: {
  profileRow?: Row | null;
  upsertSpy?: (args: unknown) => void;
  updateSpy?: (table: string, args: unknown) => void;
  pendingRows?: Row[];
}) {
  const update = (table: string) => ({
    update: (vals: unknown) => {
      opts.updateSpy?.(table, vals);
      return { eq: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }), };
    },
  });
  return {
    from(table: string) {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: opts.profileRow ?? null, error: null }) }),
          }),
          update: (vals: unknown) => {
            opts.updateSpy?.("profiles", vals);
            return { eq: () => Promise.resolve({ data: null, error: null }) };
          },
        };
      }
      if (table === "ads_conversions") {
        return {
          upsert: (vals: unknown) => {
            opts.upsertSpy?.(vals);
            return Promise.resolve({ data: null, error: null });
          },
          select: () => ({
            eq: () => ({
              not: () => ({
                order: () => ({
                  limit: () => Promise.resolve({ data: opts.pendingRows ?? [], error: null }),
                }),
              }),
            }),
          }),
          update: (vals: unknown) => {
            opts.updateSpy?.("ads_conversions", vals);
            return { eq: () => Promise.resolve({ data: null, error: null }) };
          },
        };
      }
      return update(table);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("parseGclidCookie", () => {
  it("parse un cookie gclid valide", () => {
    const raw = encodeURIComponent(JSON.stringify({ gclid: "ABC", landing: "/", ts: "2026-06-19T12:00:00Z" }));
    expect(parseGclidCookie(raw)?.gclid).toBe("ABC");
  });
  it("retourne null si absent / vide", () => {
    expect(parseGclidCookie(undefined)).toBeNull();
    expect(parseGclidCookie("")).toBeNull();
  });
  it("retourne null si illisible", () => {
    expect(parseGclidCookie("pas-du-json")).toBeNull();
  });
  it("retourne null si aucun identifiant de clic", () => {
    const raw = encodeURIComponent(JSON.stringify({ landing: "/", ts: "x" }));
    expect(parseGclidCookie(raw)).toBeNull();
  });
  it("accepte gbraid / wbraid", () => {
    const gb = encodeURIComponent(JSON.stringify({ gbraid: "GB1" }));
    expect(parseGclidCookie(gb)?.gbraid).toBe("GB1");
  });
});

describe("captureGclidOnProfile — first-touch", () => {
  it("écrit le gclid si le profil n'en a pas", async () => {
    const updates: unknown[] = [];
    const svc = makeService({ profileRow: { gclid: null }, updateSpy: (_t, v) => updates.push(v) });
    await captureGclidOnProfile(svc, "user-1", { gclid: "NEW" });
    expect(updates).toHaveLength(1);
    expect((updates[0] as Row).gclid).toBe("NEW");
  });
  it("n'écrase PAS un gclid déjà présent (first-touch)", async () => {
    const updates: unknown[] = [];
    const svc = makeService({ profileRow: { gclid: "OLD" }, updateSpy: (_t, v) => updates.push(v) });
    await captureGclidOnProfile(svc, "user-1", { gclid: "NEW" });
    expect(updates).toHaveLength(0);
  });
  it("no-op si payload null", async () => {
    const updates: unknown[] = [];
    const svc = makeService({ profileRow: { gclid: null }, updateSpy: (_t, v) => updates.push(v) });
    await captureGclidOnProfile(svc, "user-1", null);
    expect(updates).toHaveLength(0);
  });
});

describe("recordAdsConversion", () => {
  it("no-op si pas de gclid (user non-Ads)", async () => {
    const upserts: unknown[] = [];
    const svc = makeService({ upsertSpy: (v) => upserts.push(v) });
    await recordAdsConversion(svc, { userId: "u", kind: "purchase", sourceRef: "s1", gclid: null, valueEur: 50 });
    expect(upserts).toHaveLength(0);
  });
  it("upsert idempotent avec gclid", async () => {
    const upserts: Row[] = [];
    const svc = makeService({ upsertSpy: (v) => upserts.push(v as Row) });
    await recordAdsConversion(svc, { userId: "u", kind: "purchase", sourceRef: "sess_1", gclid: "G", valueEur: 60 });
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({ kind: "purchase", source_ref: "sess_1", gclid: "G", value_eur: 60, uploaded: false });
  });
});

describe("getUserGclid", () => {
  it("retourne le gclid du profil", async () => {
    const svc = makeService({ profileRow: { gclid: "G42" } });
    expect(await getUserGclid(svc, "u")).toBe("G42");
  });
  it("retourne null si absent", async () => {
    const svc = makeService({ profileRow: { gclid: null } });
    expect(await getUserGclid(svc, "u")).toBeNull();
  });
});

describe("google-ads helpers", () => {
  it("formatConversionDateTime → format Ads UTC", () => {
    expect(formatConversionDateTime("2026-06-19T12:34:56.000Z")).toBe("2026-06-19 12:34:56+00:00");
  });
  it("readAdsEnv → null si config incomplète", () => {
    expect(readAdsEnv({})).toBeNull();
    expect(readAdsEnv({ GOOGLE_ADS_OAUTH_CLIENT_ID: "x" })).toBeNull();
  });
  it("readAdsEnv → strip les tirets des customer ids", () => {
    const env = readAdsEnv({
      GOOGLE_ADS_OAUTH_CLIENT_ID: "id", GOOGLE_ADS_OAUTH_CLIENT_SECRET: "sec",
      GOOGLE_ADS_REFRESH_TOKEN: "rt", GOOGLE_ADS_DEVELOPER_TOKEN: "dt",
      GOOGLE_ADS_LOGIN_CUSTOMER_ID: "643-719-1896", YOGA_SCULPT_ADS_CUSTOMER_ID: "647-893-8833",
    });
    expect(env?.loginCustomerId).toBe("6437191896");
    expect(env?.customerId).toBe("6478938833");
  });
});

describe("drainAdsConversions", () => {
  const baseEnv = {
    GOOGLE_ADS_OAUTH_CLIENT_ID: "id", GOOGLE_ADS_OAUTH_CLIENT_SECRET: "sec",
    GOOGLE_ADS_REFRESH_TOKEN: "rt", GOOGLE_ADS_DEVELOPER_TOKEN: "dt",
    GOOGLE_ADS_LOGIN_CUSTOMER_ID: "6437191896", YOGA_SCULPT_ADS_CUSTOMER_ID: "6478938833",
    ADS_CONV_ACTION_PURCHASE: "customers/6478938833/conversionActions/111",
  };

  beforeEach(() => {
    global.fetch = vi.fn();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skip si config Ads incomplète", async () => {
    const svc = makeService({ pendingRows: [{ id: "1", kind: "purchase", gclid: "G", value_eur: 60, created_at: "2026-06-19T12:00:00Z", source_ref: "s", user_id: "u" }] });
    const r = await drainAdsConversions(svc, {});
    expect(r).toEqual({ uploaded: 0, failed: 0, skipped: 0 });
  });

  it("skip une conversion dont l'action n'est pas configurée", async () => {
    const svc = makeService({ pendingRows: [{ id: "1", kind: "referral_value", gclid: "G", value_eur: 10, created_at: "2026-06-19T12:00:00Z", source_ref: "s", user_id: "u" }] });
    // referral n'a pas d'ADS_CONV_ACTION_REFERRAL dans baseEnv → skipped, pas de fetch.
    const r = await drainAdsConversions(svc, baseEnv);
    expect(r.skipped).toBe(1);
    expect(r.uploaded).toBe(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("upload une conversion purchase + marque uploaded", async () => {
    const updates: Array<{ table: string; vals: Row }> = [];
    const svc = makeService({
      pendingRows: [{ id: "1", kind: "purchase", gclid: "G", value_eur: 60, created_at: "2026-06-19T12:00:00Z", source_ref: "sess_1", user_id: "u" }],
      updateSpy: (table, vals) => updates.push({ table, vals: vals as Row }),
    });
    // 1er fetch = OAuth token, 2e fetch = uploadClickConversions
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "tok" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    const r = await drainAdsConversions(svc, baseEnv);
    expect(r.uploaded).toBe(1);
    expect(r.failed).toBe(0);
    // a marqué la ligne uploaded=true
    const marked = updates.find((u) => u.table === "ads_conversions");
    expect(marked?.vals.uploaded).toBe(true);
  });

  it("marque l'erreur (reste pending) si l'upload échoue", async () => {
    const updates: Array<{ table: string; vals: Row }> = [];
    const svc = makeService({
      pendingRows: [{ id: "1", kind: "purchase", gclid: "G", value_eur: 60, created_at: "2026-06-19T12:00:00Z", source_ref: "sess_1", user_id: "u" }],
      updateSpy: (table, vals) => updates.push({ table, vals: vals as Row }),
    });
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "tok" }) })
      .mockResolvedValueOnce({ ok: false, status: 400, text: async () => "bad request" });

    const r = await drainAdsConversions(svc, baseEnv);
    expect(r.failed).toBe(1);
    expect(r.uploaded).toBe(0);
    const errored = updates.find((u) => u.table === "ads_conversions");
    expect(errored?.vals.upload_error).toBeTruthy();
    expect(errored?.vals.uploaded).toBeUndefined(); // pas marqué uploaded
  });
});

describe("constantes", () => {
  it("FREE_TICKET_VALUE_EUR = 10", () => {
    expect(FREE_TICKET_VALUE_EUR).toBe(10);
  });
});
