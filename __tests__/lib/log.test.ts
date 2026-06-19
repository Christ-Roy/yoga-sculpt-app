import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLogger, serializeError } from "@/lib/log";

/**
 * Tests de src/lib/log.ts — logger structuré JSON `createLogger`.
 *
 * Comportements clés couverts :
 *   - chaque niveau (error/warn/info) route vers la bonne méthode console ;
 *   - le payload émis est UNE ligne JSON valide `{ level, scope, msg, ts, ...ctx }` ;
 *   - `ts` est un timestamp ISO 8601 valide ;
 *   - le `ctx` est mergé à la racine (ids, codes) ;
 *   - les `Error` du ctx sont réduites à `{ name, message }` (pas de stack) ;
 *   - NE THROW JAMAIS : même si console jette, même si ctx est circulaire ;
 *   - les clés réservées du ctx (level/scope/msg/ts) n'écrasent pas le cadre ;
 *   - filtrage par `LOG_LEVEL` (optionnel).
 */

/** Parse le 1er (et unique) argument string passé à un mock console.* en objet. */
function payloadDe(mock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  expect(mock).toHaveBeenCalledTimes(1);
  const args = mock.mock.calls[0];
  // Le logger n'émet QU'UN seul argument : la ligne JSON.
  expect(args).toHaveLength(1);
  expect(typeof args[0]).toBe("string");
  return JSON.parse(args[0] as string) as Record<string, unknown>;
}

let errSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let infoSpy: ReturnType<typeof vi.spyOn>;
const ORIG_LOG_LEVEL = process.env.LOG_LEVEL;

beforeEach(() => {
  delete process.env.LOG_LEVEL; // défaut : tout passe.
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  if (ORIG_LOG_LEVEL === undefined) delete process.env.LOG_LEVEL;
  else process.env.LOG_LEVEL = ORIG_LOG_LEVEL;
});

describe("createLogger — routage par niveau", () => {
  it("error → console.error (et pas warn/info)", () => {
    createLogger("cron").error("boom");
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it("warn → console.warn", () => {
    createLogger("cron").warn("attention");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it("info → console.info", () => {
    createLogger("cron").info("ok");
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(errSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("createLogger — format JSON", () => {
  it("émet une ligne JSON valide { level, scope, msg, ts }", () => {
    createLogger("webhook:stripe").error("Crédit échoué");
    const p = payloadDe(errSpy as unknown as ReturnType<typeof vi.fn>);
    expect(p.level).toBe("error");
    expect(p.scope).toBe("webhook:stripe");
    expect(p.msg).toBe("Crédit échoué");
    expect(typeof p.ts).toBe("string");
  });

  it("ts est un timestamp ISO 8601 valide", () => {
    createLogger("cron").info("tick");
    const p = payloadDe(infoSpy as unknown as ReturnType<typeof vi.fn>);
    const ts = p.ts as string;
    // ISO 8601 (toISOString) + reparse round-trip identique.
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(new Date(ts).toISOString()).toBe(ts);
  });

  it("merge le ctx à la racine (ids, codes)", () => {
    createLogger("reserver").error("Insert booking échoué", {
      booking_id: "b-1",
      user_id: "u-9",
      code: "23505",
      count: 3,
    });
    const p = payloadDe(errSpy as unknown as ReturnType<typeof vi.fn>);
    expect(p.booking_id).toBe("b-1");
    expect(p.user_id).toBe("u-9");
    expect(p.code).toBe("23505");
    expect(p.count).toBe(3);
    // Le cadre reste présent.
    expect(p.scope).toBe("reserver");
    expect(p.msg).toBe("Insert booking échoué");
  });

  it("réduit une Error du ctx à { name, message } (pas de stack)", () => {
    const err = new TypeError("invalid input");
    createLogger("checkout").error("Appel Stripe échoué", { err });
    const p = payloadDe(errSpy as unknown as ReturnType<typeof vi.fn>);
    expect(p.err).toEqual({ name: "TypeError", message: "invalid input" });
    expect(JSON.stringify(p)).not.toContain("stack");
  });

  it("les clés réservées du ctx n'écrasent pas le cadre", () => {
    createLogger("scope-reel").error("msg-reel", {
      level: "info",
      scope: "usurpé",
      msg: "usurpé",
      ts: "usurpé",
      vrai: "ok",
    });
    const p = payloadDe(errSpy as unknown as ReturnType<typeof vi.fn>);
    expect(p.level).toBe("error");
    expect(p.scope).toBe("scope-reel");
    expect(p.msg).toBe("msg-reel");
    expect(p.ts).not.toBe("usurpé");
    expect(p.vrai).toBe("ok");
  });
});

describe("createLogger — robustesse (ne throw JAMAIS)", () => {
  it("ne throw pas si console.error jette", () => {
    errSpy.mockImplementation(() => {
      throw new Error("console down");
    });
    expect(() => createLogger("cron").error("boom")).not.toThrow();
  });

  it("ne throw pas si le ctx contient une référence circulaire", () => {
    const circulaire: Record<string, unknown> = { a: 1 };
    circulaire.self = circulaire;
    expect(() =>
      createLogger("cron").error("circulaire", circulaire),
    ).not.toThrow();
    // On a quand même émis quelque chose (le cadre minimal).
    expect(errSpy).toHaveBeenCalledTimes(1);
    const p = payloadDe(errSpy as unknown as ReturnType<typeof vi.fn>);
    expect(p.scope).toBe("cron");
    expect(p.msg).toBe("circulaire");
    // Le ctx fautif a été écarté → pas de clé `self`.
    expect(p.self).toBeUndefined();
  });

  it("ne throw pas si le ctx contient un BigInt non sérialisable", () => {
    expect(() =>
      createLogger("cron").info("bigint", { n: BigInt(10) }),
    ).not.toThrow();
    expect(infoSpy).toHaveBeenCalledTimes(1);
  });
});

describe("createLogger — filtrage LOG_LEVEL", () => {
  it("LOG_LEVEL=error : warn et info sont filtrés", () => {
    process.env.LOG_LEVEL = "error";
    const log = createLogger("cron");
    log.error("e");
    log.warn("w");
    log.info("i");
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it("LOG_LEVEL=warn : info filtré, warn+error passent", () => {
    process.env.LOG_LEVEL = "warn";
    const log = createLogger("cron");
    log.error("e");
    log.warn("w");
    log.info("i");
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it("LOG_LEVEL absent/invalide : tout passe (défaut info)", () => {
    process.env.LOG_LEVEL = "n'importe quoi";
    const log = createLogger("cron");
    log.error("e");
    log.warn("w");
    log.info("i");
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).toHaveBeenCalledTimes(1);
  });
});

describe("serializeError", () => {
  it("réduit une Error à { name, message }", () => {
    expect(serializeError(new RangeError("hop"))).toEqual({
      name: "RangeError",
      message: "hop",
    });
  });

  it("encadre une valeur non-Error", () => {
    expect(serializeError("juste un string")).toEqual({
      name: "NonError",
      message: "juste un string",
    });
    expect(serializeError(42)).toEqual({ name: "NonError", message: "42" });
  });
});
