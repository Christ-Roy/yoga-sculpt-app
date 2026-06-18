import { describe, it, expect } from "vitest";
import {
  attendanceToColumn,
  decisionAnnulationAdmin,
  quantiteApresRecredit,
  cancelBodySchema,
  moveBodySchema,
  attendanceBodySchema,
} from "@/app/api/admin/bookings/_logic";

/**
 * Tests UNITAIRES de la logique métier PURE du back-office réservations.
 * (Schémas zod + machine d'état présence + décision d'annulation admin.)
 */

describe("_logic — attendanceToColumn", () => {
  it("mappe les états marquables tels quels", () => {
    expect(attendanceToColumn("attended")).toBe("attended");
    expect(attendanceToColumn("no_show")).toBe("no_show");
  });

  it("mappe 'pending' (réinit) vers NULL en base", () => {
    expect(attendanceToColumn("pending")).toBeNull();
  });
});

describe("_logic — quantiteApresRecredit", () => {
  it("ajoute 1 sous le plafond", () => {
    expect(quantiteApresRecredit(9, 10)).toBe(10);
    expect(quantiteApresRecredit(0, 10)).toBe(1);
  });
  it("ne dépasse jamais quantite_initiale", () => {
    expect(quantiteApresRecredit(10, 10)).toBe(10);
  });
});

describe("_logic — decisionAnnulationAdmin", () => {
  const maintenant = new Date("2026-06-19T12:00:00.000Z");

  it("autorise au-delà de 24h", () => {
    const d = decisionAnnulationAdmin({
      startsAt: "2026-06-21T12:00:00.000Z", // +48h
      overrideGuard: false,
      delaiHeures: 24,
      maintenant,
    });
    expect(d).toEqual({ allowed: true, tooLate: false });
  });

  it("refuse à moins de 24h sans override", () => {
    const d = decisionAnnulationAdmin({
      startsAt: "2026-06-19T20:00:00.000Z", // +8h
      overrideGuard: false,
      delaiHeures: 24,
      maintenant,
    });
    expect(d).toEqual({ allowed: false, tooLate: true });
  });

  it("autorise à moins de 24h SI overrideGuard", () => {
    const d = decisionAnnulationAdmin({
      startsAt: "2026-06-19T20:00:00.000Z", // +8h
      overrideGuard: true,
      delaiHeures: 24,
      maintenant,
    });
    expect(d.allowed).toBe(true);
  });

  it("refuse (fail-safe) sur une date illisible sans override", () => {
    const d = decisionAnnulationAdmin({
      startsAt: "pas-une-date",
      overrideGuard: false,
      delaiHeures: 24,
      maintenant,
    });
    expect(d).toEqual({ allowed: false, tooLate: true });
  });
});

describe("_logic — schémas zod (strict)", () => {
  it("cancelBodySchema applique les défauts (overrideGuard=false, recredit=true)", () => {
    const parsed = cancelBodySchema.parse({ bookingId: "b1" });
    expect(parsed).toEqual({ bookingId: "b1", overrideGuard: false, recredit: true });
  });

  it("cancelBodySchema rejette un champ inconnu (strict)", () => {
    expect(cancelBodySchema.safeParse({ bookingId: "b1", x: 1 }).success).toBe(false);
  });

  it("moveBodySchema exige bookingId + targetCreneauId", () => {
    expect(moveBodySchema.safeParse({ bookingId: "b1" }).success).toBe(false);
    expect(
      moveBodySchema.safeParse({ bookingId: "b1", targetCreneauId: "c1" }).success,
    ).toBe(true);
  });

  it("attendanceBodySchema n'accepte que l'enum présence", () => {
    expect(
      attendanceBodySchema.safeParse({ bookingId: "b1", attendance: "attended" })
        .success,
    ).toBe(true);
    expect(
      attendanceBodySchema.safeParse({ bookingId: "b1", attendance: "nope" }).success,
    ).toBe(false);
  });
});
