import { describe, it, expect } from "vitest";
import {
  buildIcs,
  googleCalendarUrl,
  icsFileName,
  toIcsUtc,
  type SeanceAgenda,
} from "@/lib/calendar-export";

/**
 * Tests du module d'export agenda (PUR, aucun I/O).
 *
 * Couvre les invariants critiques (demande explicite Robert) :
 *   - DEUX VALARM dans le .ics (-P1D = J-1 et -PT2H = H-2) → rappels imposés ;
 *   - échappement RFC 5545 (virgule / point-virgule / antislash / newline) ;
 *   - format des dates Google Agenda (`dates=START/END` en `YYYYMMDDTHHMMSSZ`).
 */

// Séance de référence : un mardi soir à 19h00 (UTC) → 20h00.
const SEANCE: SeanceAgenda = {
  id: "evt-123",
  titre: "Cours collectif — Yoga Sculpt",
  starts_at: "2026-06-23T19:00:00.000Z",
  ends_at: "2026-06-23T20:00:00.000Z",
  lieu: "Lyon",
  description: "Séance Yoga Sculpt avec Alice Gaudry.",
};

describe("toIcsUtc", () => {
  it("convertit un ISO en estampille UTC basique YYYYMMDDTHHMMSSZ", () => {
    expect(toIcsUtc("2026-06-23T19:00:00.000Z")).toBe("20260623T190000Z");
  });

  it("renvoie une chaîne vide pour une date invalide", () => {
    expect(toIcsUtc("pas-une-date")).toBe("");
  });
});

describe("buildIcs", () => {
  // dtstamp injecté → sortie déterministe.
  const ics = buildIcs(SEANCE, new Date("2026-06-20T08:00:00.000Z"));

  it("contient bien DEUX VALARM (rappels J-1 et H-2)", () => {
    const valarms = ics.match(/BEGIN:VALARM/g) ?? [];
    expect(valarms).toHaveLength(2);
  });

  it("programme un rappel J-1 (TRIGGER:-P1D)", () => {
    expect(ics).toContain("TRIGGER:-P1D");
  });

  it("programme un rappel H-2 (TRIGGER:-PT2H)", () => {
    expect(ics).toContain("TRIGGER:-PT2H");
  });

  it("encadre l'événement par un VCALENDAR + VEVENT valides", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR")).toBe(true);
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("END:VEVENT");
  });

  it("pose DTSTART / DTEND en UTC basique cohérents avec les bornes", () => {
    expect(ics).toContain("DTSTART:20260623T190000Z");
    expect(ics).toContain("DTEND:20260623T200000Z");
    // dtstamp injecté → déterministe.
    expect(ics).toContain("DTSTAMP:20260620T080000Z");
  });

  it("forge un UID stable basé sur l'id + le domaine", () => {
    expect(ics).toContain("UID:evt-123@yoga-sculpt.fr");
  });

  it("joint les lignes en CRLF (RFC 5545)", () => {
    expect(ics).toContain("\r\n");
    expect(ics).not.toMatch(/[^\r]\n/); // pas de LF nu
  });

  it("échappe les caractères spéciaux RFC 5545 (virgule, point-virgule, antislash)", () => {
    const ics2 = buildIcs(
      {
        ...SEANCE,
        titre: "Yoga; Sculpt, niveau\\avancé",
      },
      new Date("2026-06-20T08:00:00.000Z"),
    );
    // Sur la ligne SUMMARY, les caractères doivent être protégés par un antislash.
    const ligneSummary = ics2
      .split("\r\n")
      .join("")
      .match(/SUMMARY:[^\r\n]*/)?.[0];
    expect(ligneSummary).toBeDefined();
    expect(ligneSummary).toContain("\\;");
    expect(ligneSummary).toContain("\\,");
    expect(ligneSummary).toContain("\\\\");
  });

  it("n'émet PAS de ligne LOCATION/DESCRIPTION quand elles sont absentes", () => {
    const icsMin = buildIcs(
      {
        id: "x",
        titre: "Séance",
        starts_at: "2026-06-23T19:00:00.000Z",
        ends_at: "2026-06-23T20:00:00.000Z",
      },
      new Date("2026-06-20T08:00:00.000Z"),
    );
    expect(icsMin).not.toContain("LOCATION:");
    expect(icsMin).not.toContain("DESCRIPTION:Séance Yoga");
  });
});

describe("googleCalendarUrl", () => {
  const url = googleCalendarUrl(SEANCE);

  it("pointe vers le template de création Google Agenda", () => {
    expect(url).toContain("https://calendar.google.com/calendar/render?");
    expect(url).toContain("action=TEMPLATE");
  });

  it("encode la plage `dates=START/END` en UTC basique", () => {
    const parsed = new URL(url);
    expect(parsed.searchParams.get("dates")).toBe(
      "20260623T190000Z/20260623T200000Z",
    );
  });

  it("transmet le titre, le lieu et la description", () => {
    const parsed = new URL(url);
    expect(parsed.searchParams.get("text")).toBe(SEANCE.titre);
    expect(parsed.searchParams.get("location")).toBe("Lyon");
    expect(parsed.searchParams.get("details")).toBe(SEANCE.description);
  });
});

describe("icsFileName", () => {
  it("slugifie le titre (sans accents) et suffixe -yoga-sculpt.ics", () => {
    expect(icsFileName(SEANCE)).toBe("cours-collectif-yoga-sculpt-yoga-sculpt.ics");
  });

  it("retombe sur 'seance' si le titre ne produit aucun slug", () => {
    expect(icsFileName({ ...SEANCE, titre: "***" })).toBe(
      "seance-yoga-sculpt.ics",
    );
  });
});
