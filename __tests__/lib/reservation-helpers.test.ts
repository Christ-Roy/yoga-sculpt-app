import { describe, it, expect } from "vitest";
import {
  // Conversion DST / instants
  instantDepuisHeureMurale,
  genererSlotsLibres,
  validerSlotParticulier,
  // Bornes & mapping event → créneau
  bornEventToIso,
  eventVersCreneau,
  deduireTypeDepuisEvent,
  // Attendees
  ajouterAttendee,
  retirerAttendee,
  // Formatage FR
  cleJour,
  formaterDateLongueFr,
  formaterHeureFr,
  formaterPlageFr,
  libelleType,
  dansMoinsDe,
  // Fenêtre
  fenetreCreneaux,
  CRENEAUX_HORIZON_JOURS,
  PARTICULIER_HEURE_DEBUT,
  PARTICULIER_HEURE_FIN,
  DELAI_MIN_RESERVATION_HEURES,
} from "@/lib/reservation";
import type {
  GoogleCalendarEvent,
  GoogleCalendarAttendee,
} from "@/lib/google-calendar";

/**
 * Tests COMPLÉMENTAIRES de src/lib/reservation.ts (QA — comble les trous laissés
 * par reservation.test.ts) :
 *   - conversion DST Paris↔UTC sur les DEUX bascules (printemps + automne) ;
 *   - bornes EXACTES de la plage 9h-21h dans validerSlotParticulier ;
 *   - délai de réservation 24h PILE (frontière exacte) ;
 *   - slot dans le passé (genererSlotsLibres) ;
 *   - helpers purs jusqu'ici NON couverts : bornEventToIso, eventVersCreneau
 *     (annulé / sans id / sans bornes / lieu vide), ajouterAttendee /
 *     retirerAttendee (idempotence, casse), formatage FR + dansMoinsDe +
 *     fenetreCreneaux.
 *
 * 100 % pur : aucune I/O, instants injectés, assertions déterministes.
 */

const TZ = "Europe/Paris";

/** Heure murale Paris (0-23) d'un instant ISO. */
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

// ════════════════════════════════════════════════════════════════════════════
// instantDepuisHeureMurale — bascules DST printemps & automne 2026
//   Bascule printemps FR 2026 : 29 mars (avant = UTC+1, après = UTC+2).
//   Bascule automne   FR 2026 : 25 octobre (avant = UTC+2, après = UTC+1).
// ════════════════════════════════════════════════════════════════════════════
describe("instantDepuisHeureMurale — bascules DST", () => {
  it("veille de la bascule de printemps (28 mars) = heure d'HIVER (UTC+1)", () => {
    expect(instantDepuisHeureMurale(2026, 3, 28, 10, TZ).toISOString()).toBe(
      "2026-03-28T09:00:00.000Z",
    );
  });

  it("lendemain de la bascule de printemps (29 mars) = heure d'ÉTÉ (UTC+2)", () => {
    expect(instantDepuisHeureMurale(2026, 3, 29, 10, TZ).toISOString()).toBe(
      "2026-03-29T08:00:00.000Z",
    );
  });

  it("veille de la bascule d'automne (24 octobre) = heure d'ÉTÉ (UTC+2)", () => {
    expect(instantDepuisHeureMurale(2026, 10, 24, 10, TZ).toISOString()).toBe(
      "2026-10-24T08:00:00.000Z",
    );
  });

  it("lendemain de la bascule d'automne (26 octobre) = heure d'HIVER (UTC+1)", () => {
    expect(instantDepuisHeureMurale(2026, 10, 26, 10, TZ).toISOString()).toBe(
      "2026-10-26T09:00:00.000Z",
    );
  });

  it("borne haute de plage (20h) reste cohérente été comme hiver", () => {
    // 20h Paris été = 18:00 UTC ; 20h Paris hiver = 19:00 UTC.
    expect(instantDepuisHeureMurale(2026, 7, 1, 20, TZ).toISOString()).toBe(
      "2026-07-01T18:00:00.000Z",
    );
    expect(instantDepuisHeureMurale(2026, 1, 15, 20, TZ).toISOString()).toBe(
      "2026-01-15T19:00:00.000Z",
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// genererSlotsLibres — cas limites (passé proche, traversée d'une bascule DST)
// ════════════════════════════════════════════════════════════════════════════
describe("genererSlotsLibres — cas limites", () => {
  it("n'émet AUCUN slot dans le passé ni à moins de 24h", () => {
    const NOW = new Date("2026-06-21T06:00:00.000Z"); // dim. 08h Paris
    const slots = genererSlotsLibres({ busy: [], maintenant: NOW, horizonJours: 3 });
    const seuil = NOW.getTime() + DELAI_MIN_RESERVATION_HEURES * 3600 * 1000;
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) {
      expect(new Date(s.starts_at).getTime()).toBeGreaterThanOrEqual(seuil);
      expect(new Date(s.starts_at).getTime()).toBeGreaterThan(NOW.getTime());
    }
  });

  it("génère des slots corrects de part et d'autre de la bascule d'automne (25 oct)", () => {
    // On démarre avant la bascule et on couvre plusieurs jours après.
    const NOW = new Date("2026-10-22T06:00:00.000Z");
    const slots = genererSlotsLibres({ busy: [], maintenant: NOW, horizonJours: 7 });

    // Toutes les heures de début restent dans la plage murale 9h-20h, que le
    // jour soit en été (≤24 oct) ou en hiver (≥26 oct) — preuve que la
    // conversion DST est appliquée par jour et non figée sur un offset.
    for (const s of slots) {
      const h = heureParis(s.starts_at);
      expect(h).toBeGreaterThanOrEqual(PARTICULIER_HEURE_DEBUT);
      expect(h).toBeLessThan(PARTICULIER_HEURE_FIN);
      const dureeMin =
        (new Date(s.ends_at).getTime() - new Date(s.starts_at).getTime()) / 60000;
      expect(dureeMin).toBe(60);
    }

    // Un même créneau mural (9h) existe avant ET après la bascule, avec un offset
    // UTC différent (été 07:00Z vs hiver 08:00Z) → on vérifie qu'au moins un
    // 9h tombe à 07:00Z (été) et un autre à 08:00Z (hiver).
    const neufHeuresUtc = slots
      .filter((s) => heureParis(s.starts_at) === 9)
      .map((s) => s.starts_at.slice(11, 16));
    expect(neufHeuresUtc).toContain("07:00"); // jour d'été
    expect(neufHeuresUtc).toContain("08:00"); // jour d'hiver
  });

  it("ignore les intervalles busy cassés (fin ≤ début, dates invalides)", () => {
    const NOW = new Date("2026-06-21T06:00:00.000Z");
    const busyOk = genererSlotsLibres({ busy: [], maintenant: NOW, horizonJours: 3 }).length;
    const busyCasse = genererSlotsLibres({
      busy: [
        { start: "2026-06-23T10:00:00.000Z", end: "2026-06-23T09:00:00.000Z" }, // fin < début
        { start: "pas-une-date", end: "2026-06-23T12:00:00.000Z" }, // start NaN
      ],
      maintenant: NOW,
      horizonJours: 3,
    }).length;
    // Des busy invalides ne doivent rien élaguer.
    expect(busyCasse).toBe(busyOk);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// validerSlotParticulier — bornes EXACTES & 24h PILE
// ════════════════════════════════════════════════════════════════════════════
describe("validerSlotParticulier — bornes exactes", () => {
  // NOW choisi pour que les frontières testées soient à >24h, sauf test dédié.
  const NOW = new Date("2026-06-21T06:00:00.000Z"); // dim. 08h Paris

  it("ACCEPTE la borne basse 9h pile (PARTICULIER_HEURE_DEBUT)", () => {
    // 9h Paris été = 07:00 UTC.
    const r = validerSlotParticulier("2026-06-23T07:00:00.000Z", { maintenant: NOW });
    expect(r.ok).toBe(true);
  });

  it("REFUSE juste avant la borne basse (8h)", () => {
    const r = validerSlotParticulier("2026-06-23T06:00:00.000Z", { maintenant: NOW });
    expect(r.ok).toBe(false);
  });

  it("ACCEPTE le dernier début 20h (borne FIN exclue à 21h, cours fini à 21h)", () => {
    // 20h Paris été = 18:00 UTC. PARTICULIER_HEURE_FIN = 21 → début < 21 OK.
    const r = validerSlotParticulier("2026-06-23T18:00:00.000Z", { maintenant: NOW });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Fin = 21h Paris = 19:00 UTC.
      expect(r.fin).toBe("2026-06-23T19:00:00.000Z");
    }
  });

  it("REFUSE 21h pile (borne FIN exclue pour un début)", () => {
    // 21h Paris été = 19:00 UTC.
    const r = validerSlotParticulier("2026-06-23T19:00:00.000Z", { maintenant: NOW });
    expect(r.ok).toBe(false);
  });

  it("ACCEPTE à exactement 24h00 (frontière inclusive : < seuil refuse, == seuil passe)", () => {
    // seuil = NOW + 24h = 2026-06-22T06:00:00Z. Un slot DÉBUT à cet instant pile.
    // Mais ce doit aussi être une heure pleine Paris : 06:00Z = 08:00 Paris → hors
    // plage. On prend donc un NOW qui aligne 24h pile sur une heure pleine valide.
    const now2 = new Date("2026-06-22T07:00:00.000Z"); // = 24h avant 23/06 07:00Z (9h Paris)
    const r = validerSlotParticulier("2026-06-23T07:00:00.000Z", { maintenant: now2 });
    expect(r.ok).toBe(true);
  });

  it("REFUSE à 1 ms en-dessous des 24h", () => {
    const now2 = new Date("2026-06-22T07:00:00.001Z"); // 1ms trop tard → début < seuil
    const r = validerSlotParticulier("2026-06-23T07:00:00.000Z", { maintenant: now2 });
    expect(r.ok).toBe(false);
  });

  it("valide correctement une heure murale d'HIVER (offset UTC+1)", () => {
    const now2 = new Date("2026-01-10T00:00:00.000Z");
    // 10h Paris hiver = 09:00 UTC.
    const r = validerSlotParticulier("2026-01-12T09:00:00.000Z", { maintenant: now2 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.debut).toBe("2026-01-12T09:00:00.000Z");
      expect(r.fin).toBe("2026-01-12T10:00:00.000Z");
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// bornEventToIso
// ════════════════════════════════════════════════════════════════════════════
describe("bornEventToIso", () => {
  it("renvoie dateTime tel quel", () => {
    expect(bornEventToIso({ dateTime: "2026-06-23T17:00:00Z" })).toBe(
      "2026-06-23T17:00:00Z",
    );
  });

  it("convertit une journée entière (date) en minuit ISO UTC", () => {
    expect(bornEventToIso({ date: "2026-06-23" })).toBe("2026-06-23T00:00:00.000Z");
  });

  it("renvoie null pour une borne absente ou inexploitable", () => {
    expect(bornEventToIso(undefined)).toBeNull();
    expect(bornEventToIso({})).toBeNull();
    expect(bornEventToIso({ date: "pas-une-date" })).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// deduireTypeDepuisEvent — défaut, accents, summary OU description
// ════════════════════════════════════════════════════════════════════════════
describe("deduireTypeDepuisEvent", () => {
  it("défaut = collectif quand rien n'évoque le particulier", () => {
    expect(deduireTypeDepuisEvent({ summary: "Yoga Sculpt du soir" })).toBe(
      "collectif",
    );
    expect(deduireTypeDepuisEvent({})).toBe("collectif");
  });

  it("'particulier' détecté quelle que soit la casse et la position (summary ou description)", () => {
    expect(deduireTypeDepuisEvent({ summary: "Cours PARTICULIER" })).toBe(
      "particulier",
    );
    expect(
      deduireTypeDepuisEvent({ summary: "Séance", description: "un particulier" }),
    ).toBe("particulier");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// eventVersCreneau — cas de rejet & lieu vide
// ════════════════════════════════════════════════════════════════════════════
describe("eventVersCreneau", () => {
  const base: GoogleCalendarEvent = {
    id: "evt-1",
    summary: "Cours collectif",
    start: { dateTime: "2026-06-23T17:00:00Z" },
    end: { dateTime: "2026-06-23T18:00:00Z" },
  };

  it("mappe un event valide + reporte inscrits", () => {
    const c = eventVersCreneau(base, 5);
    expect(c).not.toBeNull();
    expect(c).toMatchObject({
      id: "evt-1",
      type: "collectif",
      inscrits: 5,
      starts_at: "2026-06-23T17:00:00Z",
      ends_at: "2026-06-23T18:00:00Z",
    });
  });

  it("renvoie null si l'event est annulé (status cancelled)", () => {
    expect(eventVersCreneau({ ...base, status: "cancelled" }, 0)).toBeNull();
  });

  it("renvoie null sans id ou sans bornes exploitables", () => {
    expect(eventVersCreneau({ ...base, id: undefined }, 0)).toBeNull();
    expect(eventVersCreneau({ ...base, start: undefined }, 0)).toBeNull();
    expect(eventVersCreneau({ ...base, end: {} }, 0)).toBeNull();
  });

  it("traite un lieu vide / espaces comme absent (undefined)", () => {
    expect(eventVersCreneau({ ...base, location: "   " }, 0)?.lieu).toBeUndefined();
    expect(eventVersCreneau({ ...base, location: " Studio Bellecour " }, 0)?.lieu).toBe(
      "Studio Bellecour",
    );
  });

  it("summary absent → chaîne vide (jamais undefined)", () => {
    expect(eventVersCreneau({ ...base, summary: undefined }, 0)?.summary).toBe("");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ajouterAttendee / retirerAttendee — idempotence, casse, undefined
// ════════════════════════════════════════════════════════════════════════════
describe("ajouterAttendee", () => {
  const a = (email: string): GoogleCalendarAttendee => ({ email });

  it("ajoute un nouvel attendee à une liste undefined", () => {
    const r = ajouterAttendee(undefined, a("client@x.fr"));
    expect(r).toEqual([{ email: "client@x.fr" }]);
  });

  it("est idempotent (même email, casse ignorée → pas de doublon)", () => {
    const existants = [a("Client@X.fr")];
    const r = ajouterAttendee(existants, a("  client@x.fr  "));
    expect(r).toHaveLength(1);
  });

  it("n'altère pas le tableau source (pas de mutation)", () => {
    const existants = [a("autre@x.fr")];
    const r = ajouterAttendee(existants, a("client@x.fr"));
    expect(existants).toHaveLength(1);
    expect(r).toHaveLength(2);
  });
});

describe("retirerAttendee", () => {
  const a = (email: string): GoogleCalendarAttendee => ({ email });

  it("retire l'attendee ciblé (casse ignorée)", () => {
    const r = retirerAttendee([a("Client@X.fr"), a("autre@x.fr")], "client@x.fr");
    expect(r).toEqual([{ email: "autre@x.fr" }]);
  });

  it("renvoie [] sur une liste undefined", () => {
    expect(retirerAttendee(undefined, "x@x.fr")).toEqual([]);
  });

  it("laisse la liste inchangée si l'email n'y est pas", () => {
    const r = retirerAttendee([a("autre@x.fr")], "absent@x.fr");
    expect(r).toEqual([{ email: "autre@x.fr" }]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Formatage FR (purs)
// ════════════════════════════════════════════════════════════════════════════
describe("formatage FR", () => {
  // 23 juin 2026 17:00 UTC = 19h00 Paris (été).
  const ISO = "2026-06-23T17:00:00.000Z";

  it("formaterHeureFr rend '19h00'", () => {
    expect(formaterHeureFr(ISO)).toBe("19h00");
  });

  it("formaterPlageFr rend '19h00 — 20h00'", () => {
    expect(formaterPlageFr(ISO, "2026-06-23T18:00:00.000Z")).toBe("19h00 — 20h00");
  });

  it("formaterDateLongueFr capitalise le jour ('Mardi 23 juin')", () => {
    expect(formaterDateLongueFr(ISO)).toBe("Mardi 23 juin");
  });

  it("cleJour rend la date murale Paris (et bascule de jour après 22h UTC l'été)", () => {
    expect(cleJour(ISO)).toBe("2026-06-23");
    // 23:30 UTC = 01:30 Paris le lendemain → jour suivant côté Paris.
    expect(cleJour("2026-06-23T23:30:00.000Z")).toBe("2026-06-24");
  });

  it("les formatters renvoient '' sur une date invalide", () => {
    expect(formaterHeureFr("nope")).toBe("");
    expect(formaterDateLongueFr("nope")).toBe("");
    expect(cleJour("nope")).toBe("");
  });

  it("libelleType mappe le type au libellé FR", () => {
    expect(libelleType("particulier")).toBe("Cours particulier");
    expect(libelleType("collectif")).toBe("Cours collectif");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// dansMoinsDe (garde-fou annulation 24h)
// ════════════════════════════════════════════════════════════════════════════
describe("dansMoinsDe", () => {
  const NOW = new Date("2026-06-23T10:00:00.000Z");

  it("vrai si le créneau démarre dans moins de N heures", () => {
    // +12h < 24h.
    expect(dansMoinsDe("2026-06-23T22:00:00.000Z", 24, NOW)).toBe(true);
  });

  it("faux si le créneau démarre dans plus de N heures", () => {
    // +48h > 24h.
    expect(dansMoinsDe("2026-06-25T10:00:00.000Z", 24, NOW)).toBe(false);
  });

  it("faux à exactement N heures (strictement < seuil)", () => {
    expect(dansMoinsDe("2026-06-24T10:00:00.000Z", 24, NOW)).toBe(false);
  });

  it("faux sur une date invalide", () => {
    expect(dansMoinsDe("nope", 24, NOW)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// fenetreCreneaux
// ════════════════════════════════════════════════════════════════════════════
describe("fenetreCreneaux", () => {
  it("timeMin = maintenant, timeMax = maintenant + horizon (défaut 60j)", () => {
    const NOW = new Date("2026-06-23T10:00:00.000Z");
    const { timeMin, timeMax } = fenetreCreneaux(NOW);
    expect(timeMin).toBe(NOW.toISOString());
    const deltaJ =
      (new Date(timeMax).getTime() - new Date(timeMin).getTime()) /
      (24 * 60 * 60 * 1000);
    expect(deltaJ).toBe(CRENEAUX_HORIZON_JOURS);
  });

  it("respecte un horizon custom", () => {
    const NOW = new Date("2026-06-23T10:00:00.000Z");
    const { timeMin, timeMax } = fenetreCreneaux(NOW, 7);
    const deltaJ =
      (new Date(timeMax).getTime() - new Date(timeMin).getTime()) /
      (24 * 60 * 60 * 1000);
    expect(deltaJ).toBe(7);
  });
});
