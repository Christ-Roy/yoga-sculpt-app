import { describe, it, expect } from "vitest";
import {
  ticketsBodySchema,
  authActionBodySchema,
  suspendBodySchema,
  inviterBodySchema,
} from "@/app/api/admin/users/_lib/validation";

/**
 * Tests unitaires des schémas de validation des routes admin/users.
 * Garantit le rejet strict (champs inconnus, bornes, formats) — la 1re ligne
 * de défense des routes.
 */

const UID = "11111111-1111-4111-8111-111111111111";
const OP = "22222222-2222-4222-8222-222222222222";

describe("ticketsBodySchema", () => {
  it("accepte un crédit valide", () => {
    const r = ticketsBodySchema.safeParse({
      userId: UID,
      type: "collectif",
      sens: "credit",
      quantite: 3,
      opId: OP,
    });
    expect(r.success).toBe(true);
  });

  it("rejette un champ inconnu (strict)", () => {
    const r = ticketsBodySchema.safeParse({
      userId: UID,
      type: "collectif",
      sens: "credit",
      quantite: 3,
      opId: OP,
      extra: "x",
    });
    expect(r.success).toBe(false);
  });

  it("rejette quantite = 0 et quantite > 50", () => {
    expect(
      ticketsBodySchema.safeParse({ userId: UID, type: "collectif", sens: "credit", quantite: 0, opId: OP }).success,
    ).toBe(false);
    expect(
      ticketsBodySchema.safeParse({ userId: UID, type: "collectif", sens: "credit", quantite: 51, opId: OP }).success,
    ).toBe(false);
  });

  it("rejette un type / sens invalide et un userId non-UUID", () => {
    expect(
      ticketsBodySchema.safeParse({ userId: UID, type: "x", sens: "credit", quantite: 1, opId: OP }).success,
    ).toBe(false);
    expect(
      ticketsBodySchema.safeParse({ userId: UID, type: "collectif", sens: "x", quantite: 1, opId: OP }).success,
    ).toBe(false);
    expect(
      ticketsBodySchema.safeParse({ userId: "nope", type: "collectif", sens: "credit", quantite: 1, opId: OP }).success,
    ).toBe(false);
  });
});

describe("authActionBodySchema", () => {
  it("accepte recovery et magiclink, rejette autre chose", () => {
    expect(authActionBodySchema.safeParse({ userId: UID, action: "recovery" }).success).toBe(true);
    expect(authActionBodySchema.safeParse({ userId: UID, action: "magiclink" }).success).toBe(true);
    expect(authActionBodySchema.safeParse({ userId: UID, action: "delete" }).success).toBe(false);
  });
});

describe("suspendBodySchema", () => {
  it("exige un booléen `suspendre`", () => {
    expect(suspendBodySchema.safeParse({ userId: UID, suspendre: true }).success).toBe(true);
    expect(suspendBodySchema.safeParse({ userId: UID, suspendre: "oui" }).success).toBe(false);
  });
});

describe("inviterBodySchema", () => {
  it("normalise (trim + minuscules) et valide le format", () => {
    const r = inviterBodySchema.safeParse({ email: "  New@Example.COM " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.email).toBe("new@example.com");
  });

  it("rejette un e-mail malformé", () => {
    expect(inviterBodySchema.safeParse({ email: "pas-un-email" }).success).toBe(false);
  });
});
