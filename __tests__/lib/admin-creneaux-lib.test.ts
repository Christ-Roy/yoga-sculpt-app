import { describe, it, expect } from "vitest";
import {
  buildEventBody,
  buildEventBodyFromPreset,
  buildSummary,
  buildDescription,
  validerCoherence,
  creneauInputSchema,
  presetInputSchema,
  applyPresetSchema,
  isoFromCivil,
  addMinutesIso,
  expanserDatesHebdo,
} from "@/app/api/admin/creneaux/lib";
import {
  deduireTypeDepuisEvent,
  eventVersCreneau,
} from "@/lib/reservation";
import type { GoogleCalendarEvent } from "@/lib/google-calendar";

/**
 * Tests de la logique PURE de la gestion admin des créneaux.
 *
 * Le test CLÉ : un event construit ici doit être RELISIBLE par le parsing de
 * `reservation.ts` (type + lieu + bornes), sinon les créneaux écrits par l'admin
 * seraient invisibles côté /api/creneaux. On vérifie donc le round-trip
 * buildEventBody → deduireTypeDepuisEvent / eventVersCreneau.
 */

describe("validation des inputs (zod)", () => {
  it("accepte un créneau collectif valide et applique les défauts", () => {
    const r = creneauInputSchema.safeParse({
      date: "2026-07-03",
      heureDebut: "18:00",
      heureFin: "19:00",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.type).toBe("collectif");
      expect(r.data.lieu).toBe("Parc de la Tête d'Or");
    }
  });

  it("rejette une date au mauvais format", () => {
    const r = creneauInputSchema.safeParse({
      date: "03/07/2026",
      heureDebut: "18:00",
      heureFin: "19:00",
    });
    expect(r.success).toBe(false);
  });

  it("rejette une heure invalide (25:00)", () => {
    const r = creneauInputSchema.safeParse({
      date: "2026-07-03",
      heureDebut: "25:00",
      heureFin: "26:00",
    });
    expect(r.success).toBe(false);
  });

  it("rejette une capacité négative ou nulle", () => {
    expect(
      creneauInputSchema.safeParse({
        date: "2026-07-03",
        heureDebut: "18:00",
        heureFin: "19:00",
        capacite: 0,
      }).success,
    ).toBe(false);
  });

  it("rejette tout champ inconnu (strict)", () => {
    const r = creneauInputSchema.safeParse({
      date: "2026-07-03",
      heureDebut: "18:00",
      heureFin: "19:00",
      hax: true,
    });
    expect(r.success).toBe(false);
  });

  it("valide un preset et sa récurrence hebdomadaire", () => {
    const r = presetInputSchema.safeParse({
      label: "Collectif vendredi 18h",
      dureeMin: 60,
      heureDebut: "18:00",
      recurrence: { frequence: "hebdomadaire", occurrences: 8 },
    });
    expect(r.success).toBe(true);
  });

  it("rejette une récurrence non hebdomadaire", () => {
    const r = presetInputSchema.safeParse({
      label: "X",
      dureeMin: 60,
      heureDebut: "18:00",
      recurrence: { frequence: "mensuelle", occurrences: 3 },
    });
    expect(r.success).toBe(false);
  });

  it("apply exige un presetId uuid et une date valide", () => {
    expect(
      applyPresetSchema.safeParse({ presetId: "pas-un-uuid", date: "2026-07-03" }).success,
    ).toBe(false);
    expect(
      applyPresetSchema.safeParse({
        presetId: "550e8400-e29b-41d4-a716-446655440000",
        date: "2026-07-03",
      }).success,
    ).toBe(true);
  });
});

describe("cohérence horaire (fin > début)", () => {
  it("accepte fin après début", () => {
    expect(validerCoherence("18:00", "19:00")).toBeNull();
  });
  it("refuse fin = début", () => {
    expect(validerCoherence("18:00", "18:00")).not.toBeNull();
  });
  it("refuse fin avant début", () => {
    expect(validerCoherence("19:00", "18:00")).not.toBeNull();
  });
});

describe("encodage du type dans le summary (contrat reservation.ts)", () => {
  it("collectif → summary SANS le mot 'particulier'", () => {
    const s = buildSummary("collectif");
    expect(s.toLowerCase()).not.toContain("particulier");
  });
  it("particulier → summary AVEC le mot 'particulier'", () => {
    expect(buildSummary("particulier").toLowerCase()).toContain("particulier");
  });
  it("custom incohérent (collectif + 'particulier') → ignoré au profit du défaut", () => {
    const s = buildSummary("collectif", "Mon cours particulier perso");
    expect(s.toLowerCase()).not.toContain("particulier");
  });
  it("custom particulier sans le mot → préfixé pour rester relisible", () => {
    const s = buildSummary("particulier", "Séance Sophie");
    expect(s.toLowerCase()).toContain("particulier");
  });
});

describe("description : capacité encodée (informatif)", () => {
  it("collectif avec capacité → mentionne les places", () => {
    expect(buildDescription("collectif", 8)).toContain("8 places");
  });
  it("particulier → pas de capacité", () => {
    expect(buildDescription("particulier", 8).toLowerCase()).not.toContain("places");
  });
});

describe("conversion date civile Paris → ISO", () => {
  it("CEST (été) : 18:00 Paris = 16:00Z", () => {
    const iso = isoFromCivil("2026-07-03", "18:00");
    expect(new Date(iso).toISOString()).toBe("2026-07-03T16:00:00.000Z");
  });
  it("CET (hiver) : 18:00 Paris = 17:00Z", () => {
    const iso = isoFromCivil("2026-01-15", "18:00");
    expect(new Date(iso).toISOString()).toBe("2026-01-15T17:00:00.000Z");
  });
  it("addMinutesIso ajoute la durée", () => {
    const start = isoFromCivil("2026-07-03", "18:00");
    expect(new Date(addMinutesIso(start, 60)).toISOString()).toBe(
      "2026-07-03T17:00:00.000Z",
    );
  });
});

describe("récurrence hebdomadaire : expansion des dates", () => {
  it("génère N dates espacées de 7 jours", () => {
    expect(expanserDatesHebdo("2026-07-03", 3)).toEqual([
      "2026-07-03",
      "2026-07-10",
      "2026-07-17",
    ]);
  });
  it("1 occurrence = la date de départ seule", () => {
    expect(expanserDatesHebdo("2026-07-03", 1)).toEqual(["2026-07-03"]);
  });
});

describe("ROUND-TRIP : event écrit relisible par reservation.ts", () => {
  it("créneau collectif → deduireType=collectif, lieu/bornes corrects", () => {
    const body = buildEventBody({
      date: "2026-07-03",
      heureDebut: "18:00",
      heureFin: "19:00",
      type: "collectif",
      lieu: "Parc de la Tête d'Or",
      capacite: 8,
    });
    // Simule l'event tel que renvoyé par Google (id + status + champs écrits).
    const event: GoogleCalendarEvent = {
      id: "evt-1",
      status: "confirmed",
      summary: body.summary,
      description: body.description,
      location: body.location,
      start: body.start,
      end: body.end,
    };
    expect(deduireTypeDepuisEvent(event)).toBe("collectif");
    const creneau = eventVersCreneau(event, 0);
    expect(creneau).not.toBeNull();
    expect(creneau?.type).toBe("collectif");
    expect(creneau?.lieu).toBe("Parc de la Tête d'Or");
    // `starts_at` est l'heure murale Paris avec offset explicite (= 16:00Z).
    expect(new Date(creneau!.starts_at).toISOString()).toBe(
      "2026-07-03T16:00:00.000Z",
    );
  });

  it("créneau particulier → deduireType=particulier", () => {
    const body = buildEventBody({
      date: "2026-07-03",
      heureDebut: "10:00",
      heureFin: "11:00",
      type: "particulier",
      lieu: "Studio Bellecour",
    });
    const event: GoogleCalendarEvent = {
      id: "evt-2",
      status: "confirmed",
      summary: body.summary,
      description: body.description,
      location: body.location,
      start: body.start,
      end: body.end,
    };
    expect(deduireTypeDepuisEvent(event)).toBe("particulier");
    expect(eventVersCreneau(event, 0)?.type).toBe("particulier");
  });

  it("event depuis preset → durée appliquée + relisible", () => {
    const body = buildEventBodyFromPreset(
      { type: "collectif", dureeMin: 75, heureDebut: "18:00", lieu: "Tête d'Or", capacite: 10 },
      "2026-07-03",
    );
    const event: GoogleCalendarEvent = {
      id: "evt-3",
      status: "confirmed",
      summary: body.summary,
      description: body.description,
      location: body.location,
      start: body.start,
      end: body.end,
    };
    expect(deduireTypeDepuisEvent(event)).toBe("collectif");
    // 18:00 + 75 min = 19:15 → 17:15Z en CEST.
    expect(new Date(eventVersCreneau(event, 0)!.ends_at).toISOString()).toBe(
      "2026-07-03T17:15:00.000Z",
    );
  });
});
