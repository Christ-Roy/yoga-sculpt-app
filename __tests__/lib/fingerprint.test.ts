import { describe, it, expect } from "vitest";
import { hashFingerprint } from "@/lib/fingerprint";

/**
 * Tests de src/lib/fingerprint.ts — hash SHA-256 de l'empreinte d'appareil.
 *
 * Module anti-abus (cf. canCreditReferral / canGrantWelcomeTicket) : un
 * fingerprint stable et déterministe est la clé de la détection multi-comptes.
 * Invariants critiques couverts :
 *   - DÉTERMINISME : mêmes composantes → même hash (peu importe l'ordre des clés) ;
 *   - DISCRIMINATION : composantes différentes → hash différent ;
 *   - FAUX POSITIF ÉVITÉ : composantes vides / null / "" → null (pas de hash
 *     « universel » qui matcherait tous les clients sans empreinte entre eux) ;
 *   - FORME : 64 hex chars (SHA-256) ;
 *   - INPUT STRING : une chaîne pré-concaténée est acceptée et trimée.
 *
 * Pur (crypto.subtle dispo sur le runtime edge ET sous Node ≥ 18 / l'env vitest).
 */

const HEX64 = /^[0-9a-f]{64}$/;

describe("hashFingerprint", () => {
  it("renvoie null pour null / undefined", async () => {
    expect(await hashFingerprint(null)).toBeNull();
    expect(await hashFingerprint(undefined)).toBeNull();
  });

  it("renvoie null quand AUCUNE composante exploitable (objet vide ou tout vide)", async () => {
    expect(await hashFingerprint({})).toBeNull();
    expect(
      await hashFingerprint({ ua: "", lang: null, tz: undefined }),
    ).toBeNull();
  });

  it("renvoie null pour une chaîne vide / espaces", async () => {
    expect(await hashFingerprint("")).toBeNull();
    expect(await hashFingerprint("   ")).toBeNull();
  });

  it("produit un hash hexadécimal de 64 caractères (SHA-256)", async () => {
    const h = await hashFingerprint({ ua: "Mozilla/5.0", tz: "Europe/Paris" });
    expect(h).toMatch(HEX64);
  });

  it("est DÉTERMINISTE : mêmes composantes → même hash", async () => {
    const a = await hashFingerprint({ ua: "Chrome", tz: "Europe/Paris", lang: "fr" });
    const b = await hashFingerprint({ ua: "Chrome", tz: "Europe/Paris", lang: "fr" });
    expect(a).toBe(b);
  });

  it("est STABLE à l'ordre des clés (tri interne)", async () => {
    const a = await hashFingerprint({ ua: "Chrome", tz: "Europe/Paris", lang: "fr" });
    const b = await hashFingerprint({ lang: "fr", tz: "Europe/Paris", ua: "Chrome" });
    expect(a).toBe(b);
  });

  it("ignore les champs vides (un champ absent ne pèse pas dans le hash)", async () => {
    const plein = await hashFingerprint({ ua: "Chrome", lang: "fr" });
    const avecVides = await hashFingerprint({
      ua: "Chrome",
      lang: "fr",
      tz: "",
      screen: null,
      fonts: undefined,
    });
    expect(plein).toBe(avecVides);
  });

  it("DISCRIMINE deux empreintes différentes", async () => {
    const a = await hashFingerprint({ ua: "Chrome", tz: "Europe/Paris" });
    const b = await hashFingerprint({ ua: "Firefox", tz: "Europe/Paris" });
    expect(a).not.toBe(b);
  });

  it("normalise les valeurs non-string (number/boolean) avant hash", async () => {
    const num = await hashFingerprint({ width: 1920, retina: true });
    const str = await hashFingerprint({ width: "1920", retina: "true" });
    expect(num).toMatch(HEX64);
    // String(1920) === "1920" et String(true) === "true" → hash identique.
    expect(num).toBe(str);
  });

  it("accepte une chaîne pré-concaténée (et la trime)", async () => {
    const a = await hashFingerprint("ua=Chrome|tz=Europe/Paris");
    const b = await hashFingerprint("  ua=Chrome|tz=Europe/Paris  ");
    expect(a).toMatch(HEX64);
    expect(a).toBe(b);
  });

  it("une chaîne et l'objet équivalent ne sont PAS forcément identiques (formats canoniques distincts)", async () => {
    // L'objet sérialise en "k=v|..." trié ; une chaîne brute est prise telle quelle.
    // On vérifie juste que les deux produisent un hash valide (pas de crash de format).
    const objet = await hashFingerprint({ ua: "Chrome" });
    const chaine = await hashFingerprint("ua=Chrome");
    expect(objet).toMatch(HEX64);
    expect(chaine).toMatch(HEX64);
  });
});
