/**
 * Définition centralisée du questionnaire d'onboarding (4 questions yoga/bien-être).
 * `key` correspond à la colonne dans la table `onboarding_responses`.
 */
export type OnboardingStep = {
  key: "goal" | "level" | "frequency" | "availability";
  question: string;
  subtitle?: string;
  options: { value: string; label: string; hint?: string }[];
};

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    key: "goal",
    question: "Quel est votre objectif principal ?",
    subtitle: "Pour adapter vos séances.",
    options: [
      { value: "renforcement", label: "Renforcement", hint: "Tonifier & gainer" },
      {
        value: "souplesse",
        label: "Souplesse & mobilité",
        hint: "Gagner en amplitude",
      },
      {
        value: "detente",
        label: "Détente & anti-stress",
        hint: "Relâcher les tensions",
      },
      {
        value: "remise_en_forme",
        label: "Remise en forme",
        hint: "Retrouver de l'énergie",
      },
    ],
  },
  {
    key: "level",
    question: "Votre niveau ?",
    subtitle: "Aucune mauvaise réponse.",
    options: [
      { value: "debutant", label: "Débutant" },
      { value: "intermediaire", label: "Intermédiaire" },
      { value: "confirme", label: "Confirmé" },
    ],
  },
  {
    key: "frequency",
    question: "À quelle fréquence aimeriez-vous pratiquer ?",
    options: [
      { value: "1_sem", label: "1× / semaine" },
      { value: "2_3_sem", label: "2 à 3× / semaine" },
      { value: "plus", label: "Plus" },
    ],
  },
  {
    key: "availability",
    question: "Vos disponibilités ?",
    subtitle: "Plusieurs créneaux possibles ? Choisissez le principal.",
    options: [
      { value: "matin", label: "Matin" },
      { value: "midi", label: "Midi" },
      { value: "soir", label: "Soir" },
      { value: "week_end", label: "Week-end" },
      { value: "flexible", label: "Flexible" },
    ],
  },
];

/** Mapping value → label lisible (pour l'affichage dans l'espace). */
export function onboardingLabel(
  key: OnboardingStep["key"],
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const step = ONBOARDING_STEPS.find((s) => s.key === key);
  return step?.options.find((o) => o.value === value)?.label ?? value;
}
