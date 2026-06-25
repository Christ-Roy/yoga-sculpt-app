import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeSupabaseMock, type MockSupabase } from "../helpers/supabase-mock";

/**
 * Tests UNITAIRES de `src/lib/referral.ts` — garde-fous PROFONDS du parrainage
 * (argent + anti-farming) non atteignables facilement via la route /completer :
 *
 *   - maxParrainagesCredites : parsing/validation de REFERRAL_MAX_CREDITS
 *     (valeur saine adoptée, valeur douteuse → défaut sûr) ;
 *   - genererCode : 8 chars, alphabet non ambigu ;
 *   - getOrCreateCode : RETRY sur collision unique (23505) puis succès ;
 *   - completerReferral :
 *       · fail-safe DB sur résolution parrain (parrainErr) → credited:false ;
 *       · fail-safe DB sur le comptage du plafond (countErr) → credited:false ;
 *       · échec de crédit du ticket (crediterTicketParrain) → credited:false ;
 *       · course concurrente sur le marquage (!marked) → rollback du ticket doublon
 *         (delete tickets) + credited:false ;
 *       · markErr (log mais crédit considéré fait) → credited:true.
 *
 * On mocke `canCreditReferral` (anti-abus) pour piloter la décision sans rejouer
 * sa propre séquence DB (testée par anti-abuse.test.ts). Le client Supabase est le
 * mock FIFO partagé.
 */

const canCreditMock = vi.fn();
vi.mock("@/lib/anti-abuse", () => ({
  canCreditReferral: (...args: unknown[]) => canCreditMock(...args),
}));

let service: MockSupabase;

beforeEach(() => {
  vi.clearAllMocks();
  service = makeSupabaseMock(null);
  canCreditMock.mockResolvedValue(true); // anti-abus OK par défaut
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const PARRAIN = "parrain-1";
const FILLEUL = "filleul-1";
const CODE = "ABCD2345";

describe("maxParrainagesCredites", () => {
  it("adopte une surcharge entière positive valide", async () => {
    vi.stubEnv("REFERRAL_MAX_CREDITS", "7");
    const { maxParrainagesCredites } = await import("@/lib/referral");
    expect(maxParrainagesCredites()).toBe(7);
  });

  it("retombe sur le défaut métier pour toute valeur douteuse", async () => {
    const { PARRAINAGE_MAX_DEFAUT } = await import("@/lib/referral-config");
    // NB : parseInt("2.5") = 2 (entier positif) → ACCEPTÉ, donc pas « douteux ».
    // On ne teste ici que les valeurs réellement invalides.
    for (const v of ["", "0", "-3", "abc", "  ", "x9"]) {
      vi.stubEnv("REFERRAL_MAX_CREDITS", v);
      vi.resetModules();
      const { maxParrainagesCredites } = await import("@/lib/referral");
      expect(maxParrainagesCredites()).toBe(PARRAINAGE_MAX_DEFAUT);
    }
  });
});

describe("genererCode", () => {
  it("produit 8 caractères de l'alphabet non ambigu", async () => {
    const { genererCode } = await import("@/lib/referral");
    for (let i = 0; i < 50; i++) {
      expect(genererCode()).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
    }
  });
});

describe("getOrCreateCode — collision unique", () => {
  it("régénère puis réussit après une collision 23505", async () => {
    // 1) lecture profil : pas de code.
    service.queueResult("profiles", "select", { data: { referral_code: null }, error: null });
    // 2) 1er update → collision unique (code déjà pris).
    service.queueResult("profiles", "update", {
      data: null,
      error: { code: "23505", message: "duplicate referral_code" },
    });
    // 3) 2e update → OK.
    service.queueResult("profiles", "update", { data: null, error: null });
    // 4) relecture → code posé.
    service.queueResult("profiles", "select", {
      data: { referral_code: "QRST6789" },
      error: null,
    });

    const { getOrCreateCode } = await import("@/lib/referral");
    const code = await getOrCreateCode(service.client as never, PARRAIN);
    expect(code).toBe("QRST6789");
    // Deux tentatives d'update (collision puis succès).
    const updates = service.calls.filter(
      (c) => c.table === "profiles" && c.op === "update",
    );
    expect(updates.length).toBe(2);
  });

  it("renvoie null si l'update échoue sur une erreur NON-unique (fail-safe)", async () => {
    service.queueResult("profiles", "select", { data: { referral_code: null }, error: null });
    service.queueResult("profiles", "update", {
      data: null,
      error: { message: "permission denied" },
    });
    const { getOrCreateCode } = await import("@/lib/referral");
    expect(await getOrCreateCode(service.client as never, PARRAIN)).toBeNull();
  });
});

describe("prenomParrainParCode — landing d'invitation (lookup borné, no PII)", () => {
  it("code valide + nom complet → renvoie le PRÉNOM (1er token)", async () => {
    service.queueResult("profiles", "select", {
      data: { full_name: "Emma Durand" },
      error: null,
    });
    const { prenomParrainParCode } = await import("@/lib/referral");
    expect(await prenomParrainParCode(service.client as never, "ABCD2345")).toBe(
      "Emma",
    );
  });

  it("tolère un nom à espaces multiples / bordés (trim + 1er token)", async () => {
    service.queueResult("profiles", "select", {
      data: { full_name: "  Marie-Claire  De La Tour " },
      error: null,
    });
    const { prenomParrainParCode } = await import("@/lib/referral");
    expect(await prenomParrainParCode(service.client as never, "abcd2345")).toBe(
      "Marie-Claire",
    );
  });

  it("normalise le code (casse/espaces) avant le lookup", async () => {
    service.queueResult("profiles", "select", {
      data: { full_name: "Léa Martin" },
      error: null,
    });
    const { prenomParrainParCode } = await import("@/lib/referral");
    expect(await prenomParrainParCode(service.client as never, "  abcd2345 ")).toBe(
      "Léa",
    );
    // Le SELECT est borné à `full_name` UNIQUEMENT (jamais d'email/tél/id).
    const sel = service.calls.find(
      (c) => c.table === "profiles" && c.op === "select",
    );
    expect(sel).toBeDefined();
  });

  it("code inconnu (aucun profil) → null", async () => {
    service.queueResult("profiles", "select", { data: null, error: null });
    const { prenomParrainParCode } = await import("@/lib/referral");
    expect(
      await prenomParrainParCode(service.client as never, "ZZZZ9999"),
    ).toBeNull();
  });

  it("profil trouvé mais SANS nom (full_name null) → null (fallback landing)", async () => {
    service.queueResult("profiles", "select", {
      data: { full_name: null },
      error: null,
    });
    const { prenomParrainParCode } = await import("@/lib/referral");
    expect(
      await prenomParrainParCode(service.client as never, "ABCD2345"),
    ).toBeNull();
  });

  it("full_name vide / espaces → null", async () => {
    service.queueResult("profiles", "select", {
      data: { full_name: "   " },
      error: null,
    });
    const { prenomParrainParCode } = await import("@/lib/referral");
    expect(
      await prenomParrainParCode(service.client as never, "ABCD2345"),
    ).toBeNull();
  });

  it("code INVALIDE (hors alphabet / mauvaise longueur) → null SANS toucher la DB", async () => {
    const { prenomParrainParCode } = await import("@/lib/referral");
    for (const bad of ["", "abc", "0O1ILo!!", "ABCD234", "ABCD23456", null, undefined]) {
      expect(
        await prenomParrainParCode(service.client as never, bad as never),
      ).toBeNull();
    }
    // Aucune requête n'a été lancée pour ces codes hors-norme (rejet précoce).
    expect(service.calls.length).toBe(0);
  });

  it("erreur DB → null (fail-safe, ne throw pas)", async () => {
    service.queueResult("profiles", "select", {
      data: null,
      error: { message: "permission denied" },
    });
    const { prenomParrainParCode } = await import("@/lib/referral");
    expect(
      await prenomParrainParCode(service.client as never, "ABCD2345"),
    ).toBeNull();
  });
});

describe("parrainPublicParCode — landing enrichie (prénom + avatar + email)", () => {
  it("code valide + nom + avatar + email → renvoie les 3 champs", async () => {
    service.queueResult("profiles", "select", {
      data: { id: PARRAIN, full_name: "Emma Durand", email: "emma@x.fr" },
      error: null,
    });
    service.queueAdminUser({
      data: {
        user: {
          email: "emma@x.fr",
          user_metadata: { avatar_url: "https://lh3.googleusercontent.com/a/emma" },
        },
      },
      error: null,
    });
    const { parrainPublicParCode } = await import("@/lib/referral");
    expect(await parrainPublicParCode(service.client as never, "ABCD2345")).toEqual({
      prenom: "Emma",
      avatarUrl: "https://lh3.googleusercontent.com/a/emma",
      email: "emma@x.fr",
    });
  });

  it("avatar dans `picture` (claim Microsoft) si `avatar_url` absent", async () => {
    service.queueResult("profiles", "select", {
      data: { id: PARRAIN, full_name: "Léa Martin", email: "lea@x.fr" },
      error: null,
    });
    service.queueAdminUser({
      data: {
        user: {
          email: "lea@x.fr",
          user_metadata: { picture: "https://graph.microsoft.com/photo/lea" },
        },
      },
      error: null,
    });
    const { parrainPublicParCode } = await import("@/lib/referral");
    const res = await parrainPublicParCode(service.client as never, "ABCD2345");
    expect(res.avatarUrl).toBe("https://graph.microsoft.com/photo/lea");
    expect(res.prenom).toBe("Léa");
  });

  it("avatar absent (magic-link, pas d'OAuth) → avatarUrl null mais prénom/email OK", async () => {
    service.queueResult("profiles", "select", {
      data: { id: PARRAIN, full_name: "Paul Bernard", email: "paul@x.fr" },
      error: null,
    });
    service.queueAdminUser({
      data: { user: { email: "paul@x.fr", user_metadata: {} } },
      error: null,
    });
    const { parrainPublicParCode } = await import("@/lib/referral");
    expect(await parrainPublicParCode(service.client as never, "ABCD2345")).toEqual({
      prenom: "Paul",
      avatarUrl: null,
      email: "paul@x.fr",
    });
  });

  it("avatar non-http (data:/javascript:) → rejeté (avatarUrl null)", async () => {
    service.queueResult("profiles", "select", {
      data: { id: PARRAIN, full_name: "Ann", email: "ann@x.fr" },
      error: null,
    });
    service.queueAdminUser({
      data: {
        user: {
          email: "ann@x.fr",
          user_metadata: { avatar_url: "javascript:alert(1)" },
        },
      },
      error: null,
    });
    const { parrainPublicParCode } = await import("@/lib/referral");
    expect((await parrainPublicParCode(service.client as never, "ABCD2345")).avatarUrl).toBeNull();
  });

  it("email manquant sur profiles → fallback sur user.email (Admin API)", async () => {
    service.queueResult("profiles", "select", {
      data: { id: PARRAIN, full_name: "Zoé", email: null },
      error: null,
    });
    service.queueAdminUser({
      data: {
        user: {
          email: "zoe@x.fr",
          user_metadata: { avatar_url: "https://x/z.png" },
        },
      },
      error: null,
    });
    const { parrainPublicParCode } = await import("@/lib/referral");
    expect((await parrainPublicParCode(service.client as never, "ABCD2345")).email).toBe(
      "zoe@x.fr",
    );
  });

  it("getUserById en ERREUR → fail-safe : prénom/email gardés, avatar null", async () => {
    service.queueResult("profiles", "select", {
      data: { id: PARRAIN, full_name: "Tom Roy", email: "tom@x.fr" },
      error: null,
    });
    service.queueAdminUser({ data: null, error: { message: "admin down" } });
    const { parrainPublicParCode } = await import("@/lib/referral");
    expect(await parrainPublicParCode(service.client as never, "ABCD2345")).toEqual({
      prenom: "Tom",
      avatarUrl: null,
      email: "tom@x.fr",
    });
  });

  it("code inconnu (aucun profil) → tout null, AUCUN appel Admin API", async () => {
    service.queueResult("profiles", "select", { data: null, error: null });
    const { parrainPublicParCode } = await import("@/lib/referral");
    expect(await parrainPublicParCode(service.client as never, "ZZZZ9999")).toEqual({
      prenom: null,
      avatarUrl: null,
      email: null,
    });
    expect(service.client.auth.admin.getUserById).not.toHaveBeenCalled();
  });

  it("code INVALIDE → tout null SANS toucher la DB ni l'Admin API", async () => {
    const { parrainPublicParCode } = await import("@/lib/referral");
    for (const bad of ["", "abc", "0O1ILo!!", null, undefined]) {
      expect(await parrainPublicParCode(service.client as never, bad as never)).toEqual({
        prenom: null,
        avatarUrl: null,
        email: null,
      });
    }
    expect(service.calls.length).toBe(0);
    expect(service.client.auth.admin.getUserById).not.toHaveBeenCalled();
  });

  it("erreur DB sur le SELECT profiles → tout null (fail-safe, ne throw pas)", async () => {
    service.queueResult("profiles", "select", {
      data: null,
      error: { message: "permission denied" },
    });
    const { parrainPublicParCode } = await import("@/lib/referral");
    expect(await parrainPublicParCode(service.client as never, "ABCD2345")).toEqual({
      prenom: null,
      avatarUrl: null,
      email: null,
    });
  });
});

describe("completerReferral — CRÉDIT À L'INSCRIPTION (aligné UI, anti-abus conservé)", () => {
  const base = {
    code: CODE,
    filleulUserId: FILLEUL,
    filleulEmail: "filleul@x.fr",
    ip: null,
    fingerprint: null,
  };

  it("crédite le parrain DÈS l'inscription quand l'anti-abus est OK (credited:true, 1 ticket)", async () => {
    // parrain résolu, pas de pending → insert d'un referral (retourne son id),
    // puis crediterReferralPending : plafond OK → ticket → marquage completed.
    service.queueResult("profiles", "select", { data: { id: PARRAIN }, error: null });
    service.queueResult("referrals", "select", { data: null, error: null }); // pas de pending
    service.queueResult("referrals", "insert", { data: { id: "ref-new" }, error: null }); // id du lien
    service.queueResult("referrals", "select", { data: null, error: null, count: 0 }); // plafond OK
    service.queueResult("tickets", "insert", { data: null, error: null }); // crédit ticket
    service.queueResult("referrals", "update", { data: { id: "ref-new" }, error: null }); // marquage

    const { completerReferral } = await import("@/lib/referral");
    expect(await completerReferral(service.client as never, base)).toEqual({
      credited: true,
      linked: true,
    });
    // Un ticket de parrainage est bien crédité au PARRAIN à l'inscription.
    const ticket = service.calls.find(
      (c) => c.table === "tickets" && c.op === "insert",
    );
    expect(ticket?.payload).toMatchObject({
      user_id: PARRAIN,
      type: "collectif",
      source: "referral",
    });
    // Le referral est marqué completed/credité.
    const upd = service.calls.find(
      (c) => c.table === "referrals" && c.op === "update",
    );
    expect(upd?.payload).toMatchObject({
      status: "completed",
      ticket_credite: true,
    });
  });

  it("anti-abus refuse à l'inscription → lié mais NON crédité (silencieux)", async () => {
    canCreditMock.mockResolvedValue(false);
    service.queueResult("profiles", "select", { data: { id: PARRAIN }, error: null });
    service.queueResult("referrals", "select", { data: null, error: null });
    service.queueResult("referrals", "insert", { data: { id: "ref-new" }, error: null });

    const { completerReferral } = await import("@/lib/referral");
    expect(await completerReferral(service.client as never, base)).toEqual({
      credited: false,
      linked: true,
    });
    // Anti-farming : aucun ticket si l'anti-abus bloque.
    expect(
      service.calls.find((c) => c.table === "tickets" && c.op === "insert"),
    ).toBeUndefined();
  });

  it("rattache un pending existant (invitation e-mail) via update, puis crédite", async () => {
    service.queueResult("profiles", "select", { data: { id: PARRAIN }, error: null });
    service.queueResult("referrals", "select", {
      data: { id: "ref-invite" },
      error: null,
    });
    service.queueResult("referrals", "update", { data: null, error: null }); // lien filleul
    service.queueResult("referrals", "select", { data: null, error: null, count: 0 }); // plafond OK
    service.queueResult("tickets", "insert", { data: null, error: null });
    service.queueResult("referrals", "update", { data: { id: "ref-invite" }, error: null });

    const { completerReferral } = await import("@/lib/referral");
    expect(await completerReferral(service.client as never, base)).toEqual({
      credited: true,
      linked: true,
    });
    const lien = service.calls.find(
      (c) => c.table === "referrals" && c.op === "update",
    );
    expect(lien?.payload).toMatchObject({ filleul_user_id: FILLEUL });
    expect(
      service.calls.find((c) => c.table === "tickets" && c.op === "insert"),
    ).toBeDefined();
  });

  it("linked:false si la résolution du parrain échoue (fail-safe DB)", async () => {
    service.queueResult("profiles", "select", {
      data: null,
      error: { message: "db down" },
    });
    const { completerReferral } = await import("@/lib/referral");
    expect(await completerReferral(service.client as never, base)).toEqual({
      credited: false,
      linked: false,
    });
  });

  it("linked:false sur code vide après trim (court-circuit)", async () => {
    const { completerReferral } = await import("@/lib/referral");
    expect(
      await completerReferral(service.client as never, { ...base, code: "   " }),
    ).toEqual({ credited: false, linked: false });
  });

  it("linked:false sur code inconnu (aucun profil)", async () => {
    service.queueResult("profiles", "select", { data: null, error: null });
    const { completerReferral } = await import("@/lib/referral");
    expect(await completerReferral(service.client as never, base)).toEqual({
      credited: false,
      linked: false,
    });
    // Code inconnu → aucune liaison.
    expect(
      service.calls.find((c) => c.table === "referrals" && c.op === "insert"),
    ).toBeUndefined();
  });

  it("anti-auto-parrainage : le code résout vers le filleul → linked:false, aucun ticket", async () => {
    service.queueResult("profiles", "select", { data: { id: FILLEUL }, error: null });
    const { completerReferral } = await import("@/lib/referral");
    expect(await completerReferral(service.client as never, base)).toEqual({
      credited: false,
      linked: false,
    });
    expect(
      service.calls.find((c) => c.table === "tickets" && c.op === "insert"),
    ).toBeUndefined();
    // Pas de liaison non plus (on se parraine pas soi-même).
    expect(
      service.calls.find((c) => c.table === "referrals" && c.op === "insert"),
    ).toBeUndefined();
  });
});

describe("crediterParrainsApresSeanceHonoree — crédit à la 1re séance honorée", () => {
  /**
   * Séquence DB d'un crédit légitime (un seul referral pending) :
   *   1. referrals::select  → liste des pending du filleul (array)
   *   2. account_signals::select → signaux persistés du filleul (lireSignauxFilleul)
   *   3. crediterReferralPending :
   *      a. canCreditReferral → MOCKÉ (pas de DB)
   *      b. referrals::select → comptage plafond (count)
   *      c. tickets::insert  → crédit du ticket
   *      d. getUserGclid → profiles::select ; recordAdsConversion → ads_conversions::upsert
   *      e. referrals::update → marquage completed/credite
   */
  function queuePending(refId = "ref-1", parrain = PARRAIN) {
    service.queueResult("referrals", "select", {
      data: [{ id: refId, parrain_user_id: parrain, filleul_email: "filleul@x.fr" }],
      error: null,
    });
    service.queueResult("account_signals", "select", {
      data: { ip_creation: null, device_fingerprint: null },
      error: null,
    });
  }

  it("crédite le parrain quand le filleul est pointé présent (1 ticket, referral completed)", async () => {
    queuePending();
    service.queueResult("referrals", "select", { data: null, error: null, count: 0 }); // plafond OK
    service.queueResult("tickets", "insert", { data: null, error: null });
    service.queueResult("referrals", "update", { data: { id: "ref-1" }, error: null });

    const { crediterParrainsApresSeanceHonoree } = await import("@/lib/referral");
    expect(
      await crediterParrainsApresSeanceHonoree(service.client as never, FILLEUL),
    ).toBe(1);

    const ticket = service.calls.find(
      (c) => c.table === "tickets" && c.op === "insert",
    );
    expect(ticket?.payload).toMatchObject({
      user_id: PARRAIN,
      type: "collectif",
      quantite_initiale: 1,
      quantite_restante: 1,
      source: "referral",
    });
    const upd = service.calls.find(
      (c) => c.table === "referrals" && c.op === "update",
    );
    expect(upd?.payload).toMatchObject({
      status: "completed",
      ticket_credite: true,
      filleul_user_id: FILLEUL,
    });
  });

  it("aucun referral pending → 0 crédité, aucun ticket (compte existant jamais lié / déjà crédité)", async () => {
    service.queueResult("referrals", "select", { data: [], error: null });
    const { crediterParrainsApresSeanceHonoree } = await import("@/lib/referral");
    expect(
      await crediterParrainsApresSeanceHonoree(service.client as never, FILLEUL),
    ).toBe(0);
    expect(
      service.calls.find((c) => c.table === "tickets" && c.op === "insert"),
    ).toBeUndefined();
  });

  it("anti-abus refuse au crédit → 0, aucun ticket (silencieux)", async () => {
    canCreditMock.mockResolvedValue(false);
    queuePending();
    const { crediterParrainsApresSeanceHonoree } = await import("@/lib/referral");
    expect(
      await crediterParrainsApresSeanceHonoree(service.client as never, FILLEUL),
    ).toBe(0);
    expect(
      service.calls.find((c) => c.table === "tickets" && c.op === "insert"),
    ).toBeUndefined();
  });

  it("PLAFOND atteint au crédit → 0, aucun ticket (anti-farming)", async () => {
    queuePending();
    // Le parrain a déjà 3 filleuls crédités (défaut métier 3) → cap atteint.
    service.queueResult("referrals", "select", { data: null, error: null, count: 3 });
    const { crediterParrainsApresSeanceHonoree } = await import("@/lib/referral");
    expect(
      await crediterParrainsApresSeanceHonoree(service.client as never, FILLEUL),
    ).toBe(0);
    expect(
      service.calls.find((c) => c.table === "tickets" && c.op === "insert"),
    ).toBeUndefined();
  });

  it("le plafond se DESSERRE via REFERRAL_MAX_CREDITS (4 < 5 → on crédite)", async () => {
    vi.stubEnv("REFERRAL_MAX_CREDITS", "5");
    queuePending();
    service.queueResult("referrals", "select", { data: null, error: null, count: 4 });
    service.queueResult("tickets", "insert", { data: null, error: null });
    service.queueResult("referrals", "update", { data: { id: "ref-1" }, error: null });
    const { crediterParrainsApresSeanceHonoree } = await import("@/lib/referral");
    expect(
      await crediterParrainsApresSeanceHonoree(service.client as never, FILLEUL),
    ).toBe(1);
    expect(
      service.calls.find((c) => c.table === "tickets" && c.op === "insert"),
    ).toBeDefined();
  });

  it("fail-safe : comptage du plafond en erreur → 0, aucun ticket", async () => {
    queuePending();
    service.queueResult("referrals", "select", {
      data: null,
      error: { message: "count failed" },
      count: null,
    });
    const { crediterParrainsApresSeanceHonoree } = await import("@/lib/referral");
    expect(
      await crediterParrainsApresSeanceHonoree(service.client as never, FILLEUL),
    ).toBe(0);
    expect(
      service.calls.find((c) => c.table === "tickets" && c.op === "insert"),
    ).toBeUndefined();
  });

  it("insert ticket en erreur → 0 (pas de marquage du referral)", async () => {
    queuePending();
    service.queueResult("referrals", "select", { data: null, error: null, count: 0 });
    service.queueResult("tickets", "insert", {
      data: null,
      error: { message: "insert failed" },
    });
    const { crediterParrainsApresSeanceHonoree } = await import("@/lib/referral");
    expect(
      await crediterParrainsApresSeanceHonoree(service.client as never, FILLEUL),
    ).toBe(0);
    // Le referral n'est pas marqué crédité (on a coupé après l'échec du ticket).
    expect(
      service.calls.find((c) => c.table === "referrals" && c.op === "update"),
    ).toBeUndefined();
  });

  it("course concurrente (!marked) → rollback du ticket doublon (delete), 0 crédité", async () => {
    queuePending();
    service.queueResult("referrals", "select", { data: null, error: null, count: 0 });
    service.queueResult("tickets", "insert", { data: null, error: null });
    // marquage : 0 ligne (un appel concurrent a déjà marqué) → maybeSingle null.
    service.queueResult("referrals", "update", { data: null, error: null });
    // retirerDernierTicketParrainage : retrouve puis supprime le doublon.
    service.queueResult("tickets", "select", { data: { id: "tk-dup" }, error: null });
    service.queueResult("tickets", "delete", { data: null, error: null });

    const { crediterParrainsApresSeanceHonoree } = await import("@/lib/referral");
    expect(
      await crediterParrainsApresSeanceHonoree(service.client as never, FILLEUL),
    ).toBe(0);
    expect(
      service.calls.find((c) => c.table === "tickets" && c.op === "delete"),
    ).toBeDefined();
  });

  it("markErr → crédit considéré fait (1), le ticket est déjà inséré", async () => {
    queuePending();
    service.queueResult("referrals", "select", { data: null, error: null, count: 0 });
    service.queueResult("tickets", "insert", { data: null, error: null });
    service.queueResult("referrals", "update", {
      data: null,
      error: { message: "update failed" },
    });
    const { crediterParrainsApresSeanceHonoree } = await import("@/lib/referral");
    expect(
      await crediterParrainsApresSeanceHonoree(service.client as never, FILLEUL),
    ).toBe(1);
  });

  it("fail-safe : liste des pending en erreur → 0, ne throw pas", async () => {
    service.queueResult("referrals", "select", {
      data: null,
      error: { message: "list failed" },
    });
    const { crediterParrainsApresSeanceHonoree } = await import("@/lib/referral");
    expect(
      await crediterParrainsApresSeanceHonoree(service.client as never, FILLEUL),
    ).toBe(0);
  });

  it("filleulUserId vide → 0 sans aucune requête", async () => {
    const { crediterParrainsApresSeanceHonoree } = await import("@/lib/referral");
    expect(
      await crediterParrainsApresSeanceHonoree(service.client as never, ""),
    ).toBe(0);
    expect(service.calls.length).toBe(0);
  });

  it("idempotent : auto-parrainage filtré (parrain == filleul dans la liste)", async () => {
    // Defense en profondeur : un referral où parrain == filleul est ignoré.
    service.queueResult("referrals", "select", {
      data: [{ id: "ref-self", parrain_user_id: FILLEUL, filleul_email: "f@x.fr" }],
      error: null,
    });
    service.queueResult("account_signals", "select", {
      data: { ip_creation: null, device_fingerprint: null },
      error: null,
    });
    const { crediterParrainsApresSeanceHonoree } = await import("@/lib/referral");
    expect(
      await crediterParrainsApresSeanceHonoree(service.client as never, FILLEUL),
    ).toBe(0);
    expect(
      service.calls.find((c) => c.table === "tickets" && c.op === "insert"),
    ).toBeUndefined();
  });
});

describe("enregistrerSignaux", () => {
  it("ne pose pas un null par-dessus une valeur déjà présente (merge non destructif)", async () => {
    // Existant : IP déjà captée, fingerprint absent.
    service.queueResult("account_signals", "select", {
      data: { ip_creation: "1.2.3.4", device_fingerprint: null },
      error: null,
    });
    service.queueResult("account_signals", "upsert", { data: null, error: null });

    const { enregistrerSignaux } = await import("@/lib/referral");
    // 2e appel : on apporte le fingerprint, sans IP → l'IP existante doit survivre.
    await enregistrerSignaux(service.client as never, {
      userId: FILLEUL,
      ip: null,
      fingerprint: "fp-xyz",
    });

    const upsert = service.calls.find(
      (c) => c.table === "account_signals" && c.op === "upsert",
    );
    expect(upsert?.payload).toMatchObject({
      user_id: FILLEUL,
      ip_creation: "1.2.3.4", // préservée
      device_fingerprint: "fp-xyz", // ajouté
    });
  });
});
