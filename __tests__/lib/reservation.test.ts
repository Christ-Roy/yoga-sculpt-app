import { describe, it, expect } from "vitest";
import {
  genererSlotsLibres,
  validerSlotParticulier,
  instantDepuisHeureMurale,
  chevauche,
  DUREE_COURS_PARTICULIER_MIN,
  PARTICULIER_HEURE_DEBUT,
  PARTICULIER_HEURE_FIN,
} from "@/lib/reservation";

/**
 * Tests PURS de la génération des créneaux libres (cours particulier).
 * Aucun I/O : `busy` + `maintenant` injectés, logique déterministe.
 */

const TZ = "Europe/Paris";

/** Heure murale de Paris (0-23) d'un instant ISO. */
function heureParis(iso: string): number {
  return Number(
    new Intl.DateTimeFormat("fr-FR", {
      timeZone: TZ,
      hour: "2-digit",
      hour12: false,
    })
      .format(new Date(iso))
      .slice(0, 2),
  );
}

describe("instantDepuisHeureMurale", () => {
  it("convertit une heure murale d'été Paris (UTC+2)", () => {
    // 23 juin 2026 10h Paris = 08:00 UTC (heure d'été).
    const d = instantDepuisHeureMurale(2026, 6, 23, 10, TZ);
    expect(d.toISOString()).toBe("2026-06-23T08:00:00.000Z");
  });

  it("convertit une heure murale d'hiver Paris (UTC+1)", () => {
    // 15 janvier 2026 10h Paris = 09:00 UTC (heure d'hiver).
    const d = instantDepuisHeureMurale(2026, 1, 15, 10, TZ);
    expect(d.toISOString()).toBe("2026-01-15T09:00:00.000Z");
  });
});

describe("chevauche", () => {
  it("détecte un chevauchement et l'absence de chevauchement", () => {
    expect(chevauche(10, 20, 15, 25)).toBe(true);
    expect(chevauche(10, 20, 20, 30)).toBe(false); // contigu, pas de chevauchement
    expect(chevauche(10, 20, 5, 10)).toBe(false);
  });
});

describe("genererSlotsLibres", () => {
  // Référence : dimanche 2026-06-21 06:00 UTC (08:00 Paris).
  const NOW = new Date("2026-06-21T06:00:00.000Z");

  it("génère des slots de 60 min, heures pleines, dans la plage 9h-21h", () => {
    const slots = genererSlotsLibres({ busy: [], maintenant: NOW, horizonJours: 3 });
    expect(slots.length).toBeGreaterThan(0);

    for (const s of slots) {
      const dureeMin =
        (new Date(s.ends_at).getTime() - new Date(s.starts_at).getTime()) / 60000;
      expect(dureeMin).toBe(DUREE_COURS_PARTICULIER_MIN);

      const h = heureParis(s.starts_at);
      expect(h).toBeGreaterThanOrEqual(PARTICULIER_HEURE_DEBUT);
      expect(h).toBeLessThan(PARTICULIER_HEURE_FIN); // dernier début à 20h
    }
  });

  it("respecte le délai mini de réservation (24h)", () => {
    const slots = genererSlotsLibres({ busy: [], maintenant: NOW, horizonJours: 5 });
    const seuil = NOW.getTime() + 24 * 60 * 60 * 1000;
    for (const s of slots) {
      expect(new Date(s.starts_at).getTime()).toBeGreaterThanOrEqual(seuil);
    }
  });

  it("élague les slots qui chevauchent un busy", () => {
    // Alice occupée mardi 23 de 10h à 12h Paris (08:00-10:00 UTC).
    const busy = [
      { start: "2026-06-23T08:00:00.000Z", end: "2026-06-23T10:00:00.000Z" },
    ];
    const slots = genererSlotsLibres({ busy, maintenant: NOW, horizonJours: 4 });

    const surMardi = slots.filter(
      (s) =>
        new Intl.DateTimeFormat("en-CA", {
          timeZone: TZ,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(s.starts_at)) === "2026-06-23",
    );
    // 10h et 11h supprimés ; 9h et 12h conservés.
    const heures = surMardi.map((s) => heureParis(s.starts_at));
    expect(heures).not.toContain(10);
    expect(heures).not.toContain(11);
    expect(heures).toContain(9);
    expect(heures).toContain(12);
  });

  it("renvoie une liste triée chronologiquement", () => {
    const slots = genererSlotsLibres({ busy: [], maintenant: NOW, horizonJours: 4 });
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i].starts_at >= slots[i - 1].starts_at).toBe(true);
    }
  });
});

describe("validerSlotParticulier", () => {
  const NOW = new Date("2026-06-21T06:00:00.000Z");

  it("accepte une heure pleine valide à plus de 24h", () => {
    const r = validerSlotParticulier("2026-06-23T08:00:00.000Z", { maintenant: NOW });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.debut).toBe("2026-06-23T08:00:00.000Z");
      // Fin = +60 min.
      expect(r.fin).toBe("2026-06-23T09:00:00.000Z");
    }
  });

  it("refuse une heure non pleine (minutes ≠ 0)", () => {
    const r = validerSlotParticulier("2026-06-23T08:30:00.000Z", { maintenant: NOW });
    expect(r.ok).toBe(false);
  });

  it("refuse une heure hors plage 9h-21h Paris", () => {
    // 06:00 UTC = 08:00 Paris → avant 9h.
    const r = validerSlotParticulier("2026-06-23T06:00:00.000Z", { maintenant: NOW });
    expect(r.ok).toBe(false);
  });

  it("refuse un créneau à moins de 24h", () => {
    // 10h Paris le jour même (NOW = dimanche 08h Paris) → < 24h.
    const r = validerSlotParticulier("2026-06-21T08:00:00.000Z", { maintenant: NOW });
    expect(r.ok).toBe(false);
  });

  it("refuse une date invalide", () => {
    const r = validerSlotParticulier("pas-une-date", { maintenant: NOW });
    expect(r.ok).toBe(false);
  });
});
