import type { ButtonHTMLAttributes } from "react";
import { Button as UiButton } from "@/components/ui/button";

/**
 * Button — alias de compatibilité vers le bouton CANONIQUE `ui/button` (shadcn).
 *
 * Décision design system (QA 2026-06-19) : `ui/button` est le composant unique
 * (cohérent avec sidebar/sheet/tooltip déjà shadcn, et porteur de l'état
 * `loading`). On NE maintient plus deux implémentations divergentes.
 *
 * Ce wrapper conserve l'API historique (`variant: primary|secondary|ghost`)
 * pour les écrans qui l'utilisent (LoginForm/AuthMethods, OnboardingFlow,
 * ProfileCard) en la mappant 1:1 sur les variants shadcn — RENDU IDENTIQUE :
 *   - primary   → default  (bg-accent / texte sombre)
 *   - secondary → outline  (bordure + bg-surface + hover or)  ← PAS `secondary`
 *                 shadcn, qui est bg-surface-2 et diffère du rendu historique.
 *   - ghost     → ghost
 *
 * Préférer importer directement `@/components/ui/button` dans tout NOUVEau code.
 */
type Variant = "primary" | "secondary" | "ghost";

const VARIANT_MAP = {
  primary: "default",
  secondary: "outline",
  ghost: "ghost",
} as const;

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /** Spinner inline + désactivation pendant une action async. */
  loading?: boolean;
}

export function Button({ variant = "primary", ...props }: ButtonProps) {
  return <UiButton variant={VARIANT_MAP[variant]} {...props} />;
}
