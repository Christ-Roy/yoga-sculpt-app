import { describe, it, expect } from "vitest";
import {
  onboardingLabel,
  ONBOARDING_STEPS,
  isAllowedOnboardingValue,
  sanitizeOnboardingDraft,
} from "@/lib/onboarding";

/**
 * Tests de src/lib/onboarding.ts — mapping value → label du questionnaire.
 *
 * Petit helper pur mais avec plusieurs branches non couvertes :
 *   - value null/undefined/"" → null ;
 *   - value connue → label lisible ;
 *   - value inconnue → la value brute (fallback, jamais de crash) ;
 *   - cohérence du barème (4 étapes attendues, clés uniques).
 */

describe("onboardingLabel", () => {
  it("renvoie null pour une value vide / nulle", () => {
    expect(onboardingLabel("goal", null)).toBeNull();
    expect(onboardingLabel("goal", undefined)).toBeNull();
    expect(onboardingLabel("goal", "")).toBeNull();
  });

  it("mappe une value connue vers son label lisible", () => {
    expect(onboardingLabel("goal", "renforcement")).toBe("Renforcement");
    expect(onboardingLabel("level", "debutant")).toBe("Débutant");
    expect(onboardingLabel("availability", "week_end")).toBe("Week-end");
  });

  it("fallback : value inconnue → la value brute (jamais de crash)", () => {
    expect(onboardingLabel("goal", "inexistant")).toBe("inexistant");
  });

  it("fallback : clé d'étape inconnue → la value brute", () => {
    // @ts-expect-error — clé hors union, on vérifie la robustesse runtime.
    expect(onboardingLabel("inconnu", "x")).toBe("x");
  });
});

describe("ONBOARDING_STEPS — cohérence du barème", () => {
  it("expose exactement les 4 étapes attendues, dans l'ordre", () => {
    // Migration 0013 : "frequency" → "format" (split). Cf src/lib/onboarding.ts.
    expect(ONBOARDING_STEPS.map((s) => s.key)).toEqual([
      "goal",
      "level",
      "availability",
      "format",
    ]);
  });

  it("chaque étape a au moins 2 options, toutes avec value + label non vides", () => {
    for (const step of ONBOARDING_STEPS) {
      expect(step.options.length).toBeGreaterThanOrEqual(2);
      for (const o of step.options) {
        expect(o.value.length).toBeGreaterThan(0);
        expect(o.label.length).toBeGreaterThan(0);
      }
      // Values uniques au sein d'une étape.
      const values = step.options.map((o) => o.value);
      expect(new Set(values).size).toBe(values.length);
    }
  });
});

describe("isAllowedOnboardingValue — anti-injection", () => {
  it("accepte une value présente dans le barème", () => {
    expect(isAllowedOnboardingValue("goal", "renforcement")).toBe(true);
    expect(isAllowedOnboardingValue("format", "les_deux")).toBe(true);
  });

  it("refuse une value inconnue, un mauvais type, une value d'une autre étape", () => {
    expect(isAllowedOnboardingValue("goal", "inexistant")).toBe(false);
    expect(isAllowedOnboardingValue("goal", 42)).toBe(false);
    expect(isAllowedOnboardingValue("goal", null)).toBe(false);
    expect(isAllowedOnboardingValue("goal", undefined)).toBe(false);
    // "matin" est valide pour availability, pas pour goal.
    expect(isAllowedOnboardingValue("goal", "matin")).toBe(false);
  });
});

describe("sanitizeOnboardingDraft — brouillon de reprise", () => {
  it("ne conserve QUE les valeurs connues du barème", () => {
    expect(
      sanitizeOnboardingDraft({
        goal: "renforcement",
        level: "debutant",
        availability: "matin",
        format: "collectif",
      }),
    ).toEqual({
      goal: "renforcement",
      level: "debutant",
      availability: "matin",
      format: "collectif",
    });
  });

  it("ignore silencieusement les valeurs invalides / inconnues / mauvais types", () => {
    expect(
      sanitizeOnboardingDraft({
        goal: "renforcement",
        level: "DROP TABLE",
        availability: 123,
        format: null,
        intrus: "x",
      }),
    ).toEqual({ goal: "renforcement" });
  });

  it("valide la phase contre la liste autorisée", () => {
    expect(sanitizeOnboardingDraft({ phase: "invite" })).toEqual({
      phase: "invite",
    });
    expect(sanitizeOnboardingDraft({ phase: "final" })).toEqual({
      phase: "final",
    });
    expect(sanitizeOnboardingDraft({ phase: "bidon" })).toEqual({});
  });

  it("borne stepIndex dans [0, nbQuestions-1] et exige un entier", () => {
    const max = ONBOARDING_STEPS.length - 1;
    expect(sanitizeOnboardingDraft({ stepIndex: 2 })).toEqual({ stepIndex: 2 });
    expect(sanitizeOnboardingDraft({ stepIndex: -5 })).toEqual({ stepIndex: 0 });
    expect(sanitizeOnboardingDraft({ stepIndex: 999 })).toEqual({
      stepIndex: max,
    });
    // non-entier ignoré
    expect(sanitizeOnboardingDraft({ stepIndex: 1.5 })).toEqual({});
  });

  it("entrées non-objet → {} (best-effort, jamais de throw)", () => {
    expect(sanitizeOnboardingDraft(null)).toEqual({});
    expect(sanitizeOnboardingDraft(undefined)).toEqual({});
    expect(sanitizeOnboardingDraft("nope")).toEqual({});
    expect(sanitizeOnboardingDraft(42)).toEqual({});
    expect(sanitizeOnboardingDraft([])).toEqual({});
  });
});
