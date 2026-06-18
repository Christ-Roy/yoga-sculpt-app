import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * Coquille de widget du tableau de bord de l'espace client.
 *
 * Carte charte NOIR & OR partagée par tous les widgets de `/espace` :
 *   - bordure (or accentué si `accent`, sinon bordure neutre),
 *   - en-tête avec icône optionnelle, titre `.font-display` (heading de niveau
 *     `headingLevel`, par défaut h2) et action secondaire optionnelle (`action`),
 *   - corps libre (`children`).
 *
 * Accessibilité : le titre est un vrai heading dont le niveau est piloté par
 * `headingLevel` (la page ordonne h1 → h2). Le titre est relié au conteneur via
 * `aria-labelledby` quand `titleId` est fourni (chaque widget passe un id unique).
 *
 * Le composant est 100 % statique (pas de `"use client"`) → rendable côté
 * serveur, réutilisable dans des widgets server ET client.
 */
export function WidgetCard({
  title,
  titleId,
  icon: Icon,
  action,
  accent = false,
  className = "",
  bodyClassName = "",
  headingLevel = 2,
  children,
}: {
  title: string;
  /** Id du titre (pour `aria-labelledby` du <section>). Recommandé. */
  titleId?: string;
  /** Icône lucide affichée dans une pastille or à gauche du titre. */
  icon?: LucideIcon;
  /** Action secondaire en haut à droite (lien « Voir tout », etc.). */
  action?: ReactNode;
  /** Met la carte en avant (bordure or) — pour le widget « héros » éventuel. */
  accent?: boolean;
  className?: string;
  bodyClassName?: string;
  /** Niveau du heading du titre (2 par défaut ; la page porte le h1). */
  headingLevel?: 2 | 3;
  children: ReactNode;
}) {
  const Heading = headingLevel === 3 ? "h3" : "h2";

  return (
    <section
      aria-labelledby={titleId}
      className={`flex h-full flex-col rounded-[4px] border bg-surface/60 p-5 sm:p-6 ${
        accent ? "border-accent/50" : "border-border"
      } ${className}`}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {Icon && (
            <span
              aria-hidden="true"
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-[4px] border border-accent/40 bg-accent/10 text-accent"
            >
              <Icon className="size-4" />
            </span>
          )}
          <Heading
            id={titleId}
            className="truncate font-display text-lg text-text sm:text-xl"
          >
            {title}
          </Heading>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>

      <div className={`flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

/**
 * État vide standard d'un widget (icône discrète + message + CTA optionnel).
 * Réutilisé par les widgets pour ne JAMAIS afficher une carte muette.
 */
export function WidgetEmpty({
  message,
  children,
}: {
  message: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 py-4 text-center">
      <p className="text-sm leading-relaxed text-text-secondary">{message}</p>
      {children}
    </div>
  );
}

/**
 * État d'erreur standard d'un widget (la donnée n'a pas pu être chargée).
 * On reste sobre : pas de stacktrace, juste un message rassurant.
 */
export function WidgetError({
  message = "Cette information n'a pas pu être chargée pour le moment.",
}: {
  message?: string;
}) {
  return (
    <div
      role="status"
      className="flex h-full flex-col items-center justify-center gap-2 py-4 text-center"
    >
      <p className="text-sm leading-relaxed text-text-secondary">{message}</p>
    </div>
  );
}
