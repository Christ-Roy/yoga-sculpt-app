import { describe, it, expect, beforeEach } from "vitest";
import { checkRateLimit, __resetRateLimitStore } from "@/lib/rate-limit";

/**
 * Tests du rate-limiter edge-safe in-memory (anti-flood best-effort /invitation).
 *
 * Couvre : fenêtre fixe (laisse passer jusqu'à `limit`, bloque au-delà), reset à
 * l'expiration de la fenêtre, isolation par clé, fail-open sans clé (IP absente),
 * et le calcul de Retry-After.
 */

beforeEach(() => {
  __resetRateLimitStore();
});

describe("checkRateLimit — fenêtre fixe", () => {
  it("laisse passer jusqu'à `limit`, puis bloque", () => {
    const KEY = "invitation:1.2.3.4";
    const t0 = 1_000_000;
    // 3 requêtes autorisées (limit=3).
    for (let i = 1; i <= 3; i++) {
      const r = checkRateLimit(KEY, 3, 60_000, t0 + i);
      expect(r.allowed).toBe(true);
    }
    // 4e requête dans la même fenêtre → bloquée.
    const blocked = checkRateLimit(KEY, 3, 60_000, t0 + 4);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it("décompte `remaining` correctement", () => {
    const KEY = "invitation:5.6.7.8";
    expect(checkRateLimit(KEY, 2, 60_000, 0).remaining).toBe(1);
    expect(checkRateLimit(KEY, 2, 60_000, 1).remaining).toBe(0);
    expect(checkRateLimit(KEY, 2, 60_000, 2).allowed).toBe(false);
  });

  it("réinitialise la fenêtre une fois expirée (re-autorise)", () => {
    const KEY = "invitation:9.9.9.9";
    // Sature la fenêtre.
    checkRateLimit(KEY, 1, 1_000, 0);
    expect(checkRateLimit(KEY, 1, 1_000, 100).allowed).toBe(false);
    // Après expiration de la fenêtre → nouvelle fenêtre, re-autorisé.
    expect(checkRateLimit(KEY, 1, 1_000, 1_001).allowed).toBe(true);
  });

  it("isole les compteurs par clé (IP différentes indépendantes)", () => {
    const A = "invitation:10.0.0.1";
    const B = "invitation:10.0.0.2";
    checkRateLimit(A, 1, 60_000, 0); // A saturé
    expect(checkRateLimit(A, 1, 60_000, 1).allowed).toBe(false);
    // B n'est pas affecté.
    expect(checkRateLimit(B, 1, 60_000, 2).allowed).toBe(true);
  });

  it("fail-open sans clé (IP absente) : toujours autorisé, aucun compteur", () => {
    for (let i = 0; i < 100; i++) {
      const r = checkRateLimit(null, 1, 60_000, i);
      expect(r.allowed).toBe(true);
    }
    expect(checkRateLimit("", 1, 60_000, 0).allowed).toBe(true);
  });
});
