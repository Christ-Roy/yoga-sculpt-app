import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  normaliserEmail,
  isDisposableEmail,
  refreshDisposableBlocklist,
  canCreditReferral,
  __resetDisposableBlocklistForTests,
} from "@/lib/anti-abuse";
import { makeSupabaseMock, type MockSupabase } from "../helpers/supabase-mock";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Régression du reliquat #2 du ticket anti-abus parrainage :
 *   (1) normalisation/canonicalisation des alias Gmail (+tag et points) →
 *       plusieurs alias d'un même attaquant se réduisent à UNE identité ;
 *   (2) blocklist jetable dynamique (liste publique distante) UNIONnée à la Set
 *       statique, avec fallback SÛR sur la Set statique si le fetch échoue
 *       (jamais fail-open).
 *
 * Aucun appel réseau réel : `global.fetch` est stubé. Le cache mémoire de la
 * blocklist est remis à zéro entre chaque cas.
 */

function asClient(m: MockSupabase): SupabaseClient {
  return m.client as unknown as SupabaseClient;
}

describe("normaliserEmail — canonicalisation des alias", () => {
  it("Gmail : retire le +tag ET les points de la partie locale", () => {
    expect(normaliserEmail("u.s.e.r+promo@gmail.com")).toBe("user@gmail.com");
    expect(normaliserEmail("user@gmail.com")).toBe("user@gmail.com");
    expect(normaliserEmail("US.ER+x@GMAIL.com")).toBe("user@gmail.com");
    expect(normaliserEmail("Jean.Dupont@gmail.com")).toBe("jeandupont@gmail.com");
  });

  it("Tous les alias d'un même attaquant Gmail collapsent vers UNE identité", () => {
    const variantes = [
      "attaquant@gmail.com",
      "a.ttaquant@gmail.com",
      "att.aqu.ant@gmail.com",
      "attaquant+1@gmail.com",
      "at.taquant+ys@gmail.com",
      "  ATTAQUANT+spam@GMail.com  ",
      "attaquant@googlemail.com", // googlemail rabattu sur gmail.com
      "att.aquant+x@googlemail.com",
    ];
    const canon = new Set(variantes.map((e) => normaliserEmail(e)));
    expect(canon.size).toBe(1);
    expect([...canon][0]).toBe("attaquant@gmail.com");
  });

  it("googlemail.com est rabattu sur gmail.com", () => {
    expect(normaliserEmail("user@googlemail.com")).toBe("user@gmail.com");
  });

  it("Domaine non-alias : retire le +tag mais GARDE les points", () => {
    expect(normaliserEmail("client+ys@outlook.com")).toBe("client@outlook.com");
    expect(normaliserEmail("jean.dupont@outlook.com")).toBe("jean.dupont@outlook.com");
    expect(normaliserEmail("Jean.Dupont+x@yoga-sculpt.fr")).toBe(
      "jean.dupont@yoga-sculpt.fr",
    );
  });

  it("trim + lowercase de base, et e-mail malformé renvoyé tel quel (sans @)", () => {
    expect(normaliserEmail("  Alice@GMail.com ")).toBe("alice@gmail.com");
    expect(normaliserEmail("pas-un-email")).toBe("pas-un-email");
    expect(normaliserEmail("  PAS-UN-EMAIL  ")).toBe("pas-un-email");
  });

  it("ne vide jamais la partie locale (garde-fou alias = +tag only)", () => {
    // local entièrement composé d'un +tag → on ne produit pas `@gmail.com`.
    expect(normaliserEmail("+tag@gmail.com")).not.toMatch(/^@/);
  });
});

describe("isDisposableEmail — canonicalisation appliquée", () => {
  beforeEach(() => __resetDisposableBlocklistForTests());

  it("détecte le jetable via la forme canonique (alias gmail ne contourne pas)", () => {
    // gmail n'est pas jetable, mais on vérifie que l'alias ne change pas le verdict.
    expect(isDisposableEmail("ab.us.er+x@gmail.com")).toBe(false);
    // un domaine jetable statique reste détecté, alias ou pas.
    expect(isDisposableEmail("Abuser+tag@mailinator.com")).toBe(true);
  });
});

describe("blocklist jetable dynamique", () => {
  const REMOTE_LIST = "# commentaire\nspambox-temp.io\nthrowaway-xyz.net\n\n  AnotherTemp.org  \nligne avec espace\nsansdomaine\n";

  beforeEach(() => {
    __resetDisposableBlocklistForTests();
    vi.restoreAllMocks();
  });
  afterEach(() => {
    __resetDisposableBlocklistForTests();
    vi.restoreAllMocks();
  });

  it("après un fetch OK, un domaine de la liste distante (absent du statique) est bloqué", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, text: async () => REMOTE_LIST });

    // avant refresh : domaine inconnu → non jetable.
    expect(isDisposableEmail("x@spambox-temp.io")).toBe(false);

    await refreshDisposableBlocklist();

    // après refresh : la liste distante a été unionnée.
    expect(isDisposableEmail("x@spambox-temp.io")).toBe(true);
    expect(isDisposableEmail("y@throwaway-xyz.net")).toBe(true);
    expect(isDisposableEmail("z@anothertemp.org")).toBe(true); // trim + lowercase parse
    // les lignes invalides (commentaire, espace, sans point) sont ignorées.
    expect(isDisposableEmail("a@ligne")).toBe(false);
    expect(isDisposableEmail("b@sansdomaine")).toBe(false);
    // le plancher statique reste actif.
    expect(isDisposableEmail("c@mailinator.com")).toBe(true);
  });

  it("FAIL-SAFE : si le fetch jette, fallback sur la Set statique (jamais fail-open)", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down"));

    await expect(refreshDisposableBlocklist()).resolves.toBeUndefined(); // ne throw jamais

    // domaine distant inconnu → pas bloqué (cache vide), MAIS le statique tient.
    expect(isDisposableEmail("x@spambox-temp.io")).toBe(false);
    expect(isDisposableEmail("abuser@yopmail.com")).toBe(true); // plancher statique
  });

  it("FAIL-SAFE : HTTP non-OK → on garde la Set statique, pas de crash", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 503, text: async () => "" });

    await refreshDisposableBlocklist();
    expect(isDisposableEmail("x@spambox-temp.io")).toBe(false);
    expect(isDisposableEmail("abuser@mailinator.com")).toBe(true);
  });

  it("FAIL-SAFE : réponse vide → on ne remplace pas par du vide, statique conservé", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, text: async () => "# que des commentaires\n\n" });

    await refreshDisposableBlocklist();
    expect(isDisposableEmail("abuser@guerrillamail.com")).toBe(true);
  });

  it("dédoublonne les fetchs concurrents du même isolate (1 seul appel réseau)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, text: async () => REMOTE_LIST });
    global.fetch = fetchMock;

    await Promise.all([
      refreshDisposableBlocklist(),
      refreshDisposableBlocklist(),
      refreshDisposableBlocklist(),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("respecte le TTL : un 2e refresh immédiat ne re-fetch pas", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, text: async () => REMOTE_LIST });
    global.fetch = fetchMock;

    await refreshDisposableBlocklist();
    await refreshDisposableBlocklist(); // cache frais → pas de 2e fetch
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("canCreditReferral — intégration blocklist dynamique", () => {
  let svc: MockSupabase;

  beforeEach(() => {
    svc = makeSupabaseMock();
    __resetDisposableBlocklistForTests();
    vi.restoreAllMocks();
  });
  afterEach(() => {
    __resetDisposableBlocklistForTests();
    vi.restoreAllMocks();
  });

  it("R1 : refuse un domaine présent UNIQUEMENT dans la liste distante", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "spambox-temp.io\n",
    });

    const ok = await canCreditReferral(asClient(svc), {
      filleulUserId: "filleul-1",
      filleulEmail: "attaquant@spambox-temp.io",
      ip: "203.0.113.7",
      fingerprint: null,
    });
    expect(ok).toBe(false);
    // refus immédiat sur R1 → aucune lecture DB.
    expect(svc.calls.length).toBe(0);
  });

  it("R1 fail-safe : fetch KO → email gmail légitime reste créditable (pas de faux refus)", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("down"));
    svc.queueResult("referrals", "select", { data: [], error: null }); // R4 OK

    const ok = await canCreditReferral(asClient(svc), {
      filleulUserId: "filleul-1",
      filleulEmail: "vrai.client+ys@gmail.com", // canonicalisé, non jetable
      ip: null,
      fingerprint: null,
    });
    expect(ok).toBe(true);
  });
});
