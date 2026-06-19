/**
 * Définition centralisée du questionnaire d'onboarding (4 questions yoga/bien-être).
 * `key` correspond à la colonne dans la table `onboarding_responses`.
 */
/** `icon` = nom d'une icône lucide-react (résolu dans OnboardingFlow).
 * `layout` : "list" (cartes liste, défaut) | "split" (2 grandes images gauche/droite
 *   + une option centrale). `image` = chemin public pour le layout "split". */
export type OnboardingStep = {
  key: "goal" | "level" | "availability" | "format";
  question: string;
  subtitle?: string;
  layout?: "list" | "split";
  options: {
    value: string;
    label: string;
    hint?: string;
    icon: string;
    image?: string;
  }[];
};

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    key: "goal",
    question: "Quel est votre objectif principal ?",
    subtitle: "Pour adapter vos séances.",
    options: [
      { value: "renforcement", label: "Renforcement", hint: "Tonifier & gainer", icon: "Dumbbell" },
      {
        value: "souplesse",
        label: "Souplesse & mobilité",
        hint: "Gagner en amplitude",
        icon: "Wind",
      },
      {
        value: "detente",
        label: "Détente & anti-stress",
        hint: "Relâcher les tensions",
        icon: "Leaf",
      },
      {
        value: "remise_en_forme",
        label: "Remise en forme",
        hint: "Retrouver de l'énergie",
        icon: "Sparkles",
      },
    ],
  },
  {
    key: "level",
    question: "Votre niveau ?",
    subtitle: "Aucune mauvaise réponse.",
    options: [
      { value: "debutant", label: "Débutant", icon: "Sprout" },
      { value: "intermediaire", label: "Intermédiaire", icon: "TrendingUp" },
      { value: "confirme", label: "Confirmé", icon: "Award" },
    ],
  },
  {
    key: "availability",
    question: "Vos disponibilités ?",
    subtitle: "Plusieurs créneaux possibles ? Choisissez le principal.",
    options: [
      { value: "matin", label: "Matin", icon: "Sunrise" },
      { value: "midi", label: "Midi", icon: "Sun" },
      { value: "soir", label: "Soir", icon: "Sunset" },
      { value: "week_end", label: "Week-end", icon: "CalendarRange" },
      { value: "flexible", label: "Flexible", icon: "Shuffle" },
    ],
  },
  {
    key: "format",
    question: "Quel format de cours préférez-vous ?",
    subtitle: "Vous pourrez toujours changer ensuite.",
    layout: "split",
    options: [
      {
        value: "particulier",
        label: "Cours particulier",
        hint: "À domicile, rien que pour vous",
        icon: "User",
        image: "/images/onboarding/particulier.webp",
      },
      {
        value: "collectif",
        label: "Cours collectif",
        hint: "En petit groupe, plein air",
        icon: "Users",
        image: "/images/onboarding/collectif.webp",
      },
      {
        value: "les_deux",
        label: "Les deux !",
        hint: "Le meilleur des deux mondes",
        icon: "Heart",
      },
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
