import { describe, it, expect, beforeEach } from "vitest";
import {
  isDisposableEmail,
  getClientIp,
  getClientIpFromHeaders,
  canCreditReferral,
  canGrantWelcomeTicket,
} from "@/lib/anti-abuse";
import { makeSupabaseMock, type MockSupabase } from "../helpers/supabase-mock";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Tests de lib/anti-abuse — logique anti auto-parrainage (V2b).
 *
 * Couvre les 3 fonctions pures/quasi-pures :
 *   - isDisposableEmail : domaine jetable → true, domaine normal → false ;
 *   - getClientIp       : CF-Connecting-IP prioritaire, fallback x-forwarded-for ;
 *   - canCreditReferral : les 4 règles (R1 jetable, R2 IP partagée, R3 fingerprint
 *     partagé, R4 filleul déjà crédité) + fail-safe (erreur DB → refus).
 *
 * Aucune dépendance externe : Supabase est mocké via le helper partagé.
 */

const FILLEUL_ID = "filleul-1";
const FILLEUL_EMAIL = "filleul@example.com";

// Le helper renvoie un client mock dont la surface correspond à SupabaseClient ;
// on caste pour le passer aux fonctions typées.
function asClient(m: MockSupabase): SupabaseClient {
  return m.client as unknown as SupabaseClient;
}

function makeReq(headers: Record<string, string>): Request {
  return {
    headers: {
      get: (k: string) => headers[k] ?? headers[k.toLowerCase()] ?? null,
    },
  } as unknown as Request;
}

describe("isDisposableEmail", () => {
  it("détecte un domaine jetable connu", () => {
    expect(isDisposableEmail("abuser@mailinator.com")).toBe(true);
    expect(isDisposableEmail("x@yopmail.com")).toBe(true);
    expect(isDisposableEmail("y@guerrillamail.net")).toBe(true);
  });

  it("est robuste à la casse et aux espaces", () => {
    expect(isDisposableEmail("  Abuser@MAILINATOR.com  ")).toBe(true);
  });

  it("accepte un domaine normal", () => {
    expect(isDisposableEmail("alice@gmail.com")).toBe(false);
    expect(isDisposableEmail("client@yoga-sculpt.fr")).toBe(false);
  });

  it("renvoie false sur un e-mail malformé (pas de @)", () => {
    expect(isDisposableEmail("pas-un-email")).toBe(false);
    expect(isDisposableEmail("trailing@")).toBe(false);
  });
});

describe("getClientIp", () => {
  it("priorise CF-Connecting-IP (posé par Cloudflare, non spoofable)", () => {
    const req = makeReq({
      "CF-Connecting-IP": "203.0.113.7",
      "x-forwarded-for": "10.0.0.1, 10.0.0.2",
    });
    expect(getClientIp(req)).toBe("203.0.113.7");
  });

  it("retombe sur la 1re IP de x-forwarded-for si pas de CF header", () => {
    const req = makeReq({ "x-forwarded-for": "198.51.100.4, 10.0.0.2" });
    expect(getClientIp(req)).toBe("198.51.100.4");
  });

  it("renvoie null si aucune IP exploitable", () => {
    expect(getClientIp(makeReq({}))).toBeNull();
  });
});

describe("getClientIpFromHeaders", () => {
  it("lit directement un porteur de headers (Server Action)", () => {
    const headers = {
      get: (k: string) =>
        ({ "CF-Connecting-IP": "203.0.113.9" } as Record<string, string>)[k] ??
        null,
    };
    expect(getClientIpFromHeaders(headers)).toBe("203.0.113.9");
  });

  it("retombe sur x-forwarded-for et renvoie null sans header", () => {
    const xff = {
      get: (k: string) =>
        ({ "x-forwarded-for": "198.51.100.4, 10.0.0.2" } as Record<string, string>)[
          k
        ] ?? null,
    };
    expect(getClientIpFromHeaders(xff)).toBe("198.51.100.4");
    expect(getClientIpFromHeaders({ get: () => null })).toBeNull();
  });
});

describe("canCreditReferral", () => {
  let svc: MockSupabase;

  beforeEach(() => {
    svc = makeSupabaseMock();
  });

  it("R1 : e-mail jetable → refus immédiat (aucune lecture DB)", async () => {
    const ok = await canCreditReferral(asClient(svc), {
      filleulUserId: FILLEUL_ID,
      filleulEmail: "abuser@mailinator.com",
      ip: "203.0.113.7",
      fingerprint: "fp-abc",
    });
    expect(ok).toBe(false);
    // Court-circuit avant toute requête.
    expect(svc.calls.length).toBe(0);
  });

  it("R4 : filleul ayant déjà déclenché un crédit → refus", async () => {
    // referrals::select (R4) renvoie une ligne → déjà crédité.
    svc.queueResult("referrals", "select", { data: [{ id: "ref-old" }], error: null });

    const ok = await canCreditReferral(asClient(svc), {
      filleulUserId: FILLEUL_ID,
      filleulEmail: FILLEUL_EMAIL,
      ip: null,
      fingerprint: null,
    });
    expect(ok).toBe(false);
  });

  it("R2 : IP partagée avec un AUTRE compte → refus", async () => {
    svc.queueResult("referrals", "select", { data: [], error: null }); // R4 OK
    // R2 : un autre compte a la même IP.
    svc.queueResult("account_signals", "select", {
      data: [{ user_id: "autre-compte" }],
      error: null,
    });

    const ok = await canCreditReferral(asClient(svc), {
      filleulUserId: FILLEUL_ID,
      filleulEmail: FILLEUL_EMAIL,
      ip: "203.0.113.7",
      fingerprint: null,
    });
    expect(ok).toBe(false);
  });

  it("R3 : fingerprint partagé avec un AUTRE compte → refus", async () => {
    svc.queueResult("referrals", "select", { data: [], error: null }); // R4 OK
    // Pas d'IP fournie → R2 sautée. R3 : empreinte partagée.
    svc.queueResult("account_signals", "select", {
      data: [{ user_id: "autre-compte" }],
      error: null,
    });

    const ok = await canCreditReferral(asClient(svc), {
      filleulUserId: FILLEUL_ID,
      filleulEmail: FILLEUL_EMAIL,
      ip: null,
      fingerprint: "fp-partage",
    });
    expect(ok).toBe(false);
  });

  it("toutes les règles passent → crédit autorisé (true)", async () => {
    svc.queueResult("referrals", "select", { data: [], error: null }); // R4 OK
    // R2 (ip) : aucun autre compte avec cette IP.
    svc.queueResult("account_signals", "select", { data: [], error: null });
    // R3 (fp) : aucun autre compte avec cette empreinte.
    svc.queueResult("account_signals", "select", { data: [], error: null });

    const ok = await canCreditReferral(asClient(svc), {
      filleulUserId: FILLEUL_ID,
      filleulEmail: FILLEUL_EMAIL,
      ip: "203.0.113.7",
      fingerprint: "fp-unique",
    });
    expect(ok).toBe(true);
  });

  it("fail-safe : une erreur DB sur R4 → refus (on ne crédite pas dans le doute)", async () => {
    svc.queueResult("referrals", "select", {
      data: null,
      error: { message: "timeout" },
    });

    const ok = await canCreditReferral(asClient(svc), {
      filleulUserId: FILLEUL_ID,
      filleulEmail: FILLEUL_EMAIL,
      ip: null,
      fingerprint: null,
    });
    expect(ok).toBe(false);
  });

  it("ne lance PAS de requête IP/fingerprint quand ils sont null (pas de faux positif)", async () => {
    svc.queueResult("referrals", "select", { data: [], error: null }); // R4 OK

    const ok = await canCreditReferral(asClient(svc), {
      filleulUserId: FILLEUL_ID,
      filleulEmail: FILLEUL_EMAIL,
      ip: null,
      fingerprint: null,
    });
    expect(ok).toBe(true);
    // Aucune lecture account_signals (R2/R3 sautées faute de signal).
    expect(
      svc.calls.find((c) => c.table === "account_signals"),
    ).toBeUndefined();
  });
});

describe("canGrantWelcomeTicket", () => {
  let svc: MockSupabase;

  beforeEach(() => {
    svc = makeSupabaseMock();
  });

  it("W1 : e-mail jetable → refus immédiat (aucune lecture DB)", async () => {
    const ok = await canGrantWelcomeTicket(asClient(svc), {
      userId: "u1",
      email: "abuser@yopmail.com",
      ip: "203.0.113.7",
      fingerprint: "fp",
    });
    expect(ok).toBe(false);
    expect(svc.calls.length).toBe(0);
  });

  it("W2 : IP partagée avec un autre compte → refus", async () => {
    svc.queueResult("account_signals", "select", {
      data: [{ user_id: "autre" }],
      error: null,
    });
    const ok = await canGrantWelcomeTicket(asClient(svc), {
      userId: "u1",
      email: "client@gmail.com",
      ip: "203.0.113.7",
      fingerprint: null,
    });
    expect(ok).toBe(false);
  });

  it("W3 : fingerprint partagé avec un autre compte → refus", async () => {
    svc.queueResult("account_signals", "select", {
      data: [{ user_id: "autre" }],
      error: null,
    });
    const ok = await canGrantWelcomeTicket(asClient(svc), {
      userId: "u1",
      email: "client@gmail.com",
      ip: null,
      fingerprint: "fp-partage",
    });
    expect(ok).toBe(false);
  });

  it("signaux uniques → octroi autorisé (true)", async () => {
    svc.queueResult("account_signals", "select", { data: [], error: null }); // IP unique
    svc.queueResult("account_signals", "select", { data: [], error: null }); // fp unique
    const ok = await canGrantWelcomeTicket(asClient(svc), {
      userId: "u1",
      email: "client@gmail.com",
      ip: "203.0.113.7",
      fingerprint: "fp-unique",
    });
    expect(ok).toBe(true);
  });

  it("ne lance aucune requête quand IP/fingerprint null → autorisé", async () => {
    const ok = await canGrantWelcomeTicket(asClient(svc), {
      userId: "u1",
      email: "client@gmail.com",
      ip: null,
      fingerprint: null,
    });
    expect(ok).toBe(true);
    expect(svc.calls.find((c) => c.table === "account_signals")).toBeUndefined();
  });

  it("fail-safe : erreur DB sur lecture IP → refus (côté sûr)", async () => {
    svc.queueResult("account_signals", "select", {
      data: null,
      error: { message: "timeout" },
    });
    const ok = await canGrantWelcomeTicket(asClient(svc), {
      userId: "u1",
      email: "client@gmail.com",
      ip: "203.0.113.7",
      fingerprint: null,
    });
    expect(ok).toBe(false);
  });
});
