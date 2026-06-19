import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius)] text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-invalid:border-red-500",
  {
    variants: {
      variant: {
        default:
          "bg-accent text-[#0e0e0e] hover:bg-accent-dark active:bg-accent-dark",
        destructive:
          "bg-red-600 text-white hover:bg-red-600/90 focus-visible:outline-red-600",
        outline:
          "border border-border bg-surface text-text hover:border-accent/60 hover:bg-surface-2",
        secondary:
          "bg-surface-2 text-text hover:bg-surface-2/80 border border-border",
        ghost: "text-text-secondary hover:bg-surface hover:text-text",
        link: "text-accent underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-5 py-2.5 has-[>svg]:px-4",
        sm: "h-9 gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-11 px-6 has-[>svg]:px-4",
        icon: "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

/**
 * Spinner inline pour l'état `loading` du bouton (charte or, hérite `currentColor`).
 * `aria-hidden` : l'état occupé est porté par `aria-busy`/`disabled` sur le bouton.
 * Coupé sous prefers-reduced-motion (pas d'anim de rotation imposée).
 */
function ButtonSpinner() {
  return (
    <svg
      className="size-4 motion-safe:animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M12 2a10 10 0 0 1 10 10h-3a7 7 0 0 0-7-7V2z"
      />
    </svg>
  );
}

function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    /** Affiche un spinner inline et désactive le bouton pendant une action async. */
    loading?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  // `asChild` + spinner injecté casserait Slot (exige un seul enfant) → en mode
  // asChild on n'injecte pas de spinner, on rend l'enfant tel quel.
  const content =
    loading && !asChild ? (
      <>
        <ButtonSpinner />
        {children}
      </>
    ) : (
      children
    );

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={asChild ? undefined : disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {content}
    </Comp>
  );
}

export { Button, buttonVariants };
