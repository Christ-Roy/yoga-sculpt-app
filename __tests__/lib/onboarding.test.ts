import { describe, it, expect } from "vitest";
import { onboardingLabel, ONBOARDING_STEPS } from "@/lib/onboarding";

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
    expect(ONBOARDING_STEPS.map((s) => s.key)).toEqual([
      "goal",
      "level",
      "frequency",
      "availability",
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
