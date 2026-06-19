import Link from "next/link";
import {
  CalendarCheck,
  CalendarPlus,
  Gift,
  Sparkles,
  Ticket,
  User,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Mosaïque de tuiles de navigation du tableau de bord `/espace`.
 *
 * DEMANDE Robert : sur mobile surtout, l'accueil doit être une mosaïque de
 * cartes tactiles d'accès rapide (Réserver, Mes réservations, Mes tickets,
 * Parrainer, Profil…), agréable au pouce. Grille 2 colonnes sur mobile, 3 dès
 * `sm`, 4 dès `lg`. Chaque tuile est une cible ≥ 44px (en pratique bien plus
 * haute), charte NOIR & OR.
 *
 * La tuile « Vos séances gratuites » (welcome / parrainage) est mise en avant
 * (bordure or + glow) UNIQUEMENT si l'utilisateur a des tickets offerts
 * disponibles : c'est un appel direct à les consommer. Elle occupe 2 colonnes
 * pour ressortir dans la mosaïque.
 *
 * 100 % statique (pas de `"use client"`) : de simples `<Link>` — rendable côté
 * serveur, aucun coût d'hydratation.
 */

interface Tuile {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

const TUILES: Tuile[] = [
  {
    href: "/espace/reserver",
    label: "Réserver",
    description: "Choisir un créneau",
    icon: CalendarPlus,
  },
  {
    href: "/espace/reservations",
    label: "Mes réservations",
    description: "Mes séances à venir",
    icon: CalendarCheck,
  },
  {
    href: "#mes-tickets",
    label: "Mes tickets",
    description: "Solde & achat",
    icon: Ticket,
  },
  {
    href: "/espace/parrainer",
    label: "Parrainer",
    description: "Offrir une séance",
    icon: Gift,
  },
  {
    href: "#mon-profil",
    label: "Mon profil",
    description: "Mes informations",
    icon: User,
  },
];

export function DashboardTiles({
  /** Nombre de séances offertes (welcome + parrainage) encore disponibles. */
  seancesGratuites = 0,
}: {
  seancesGratuites?: number;
}) {
  return (
    <nav aria-label="Accès rapides" className="mb-8">
      <h2 className="sr-only">Accès rapides</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
        {/* Tuile « séances gratuites » — mise en avant, sur 2 colonnes, quand le
            user a des tickets offerts à consommer. */}
        {seancesGratuites > 0 && (
          <Link
            href="/espace/reserver"
            className="group col-span-2 flex min-h-[112px] flex-col justify-between gap-3 rounded-[4px] border border-accent/60 bg-accent/10 p-4 transition-colors hover:bg-accent/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:p-5"
            aria-label={`Vous avez ${seancesGratuites} séance${seancesGratuites > 1 ? "s" : ""} offerte${seancesGratuites > 1 ? "s" : ""} en ligne — réserver`}
          >
            <span className="flex items-start justify-between gap-2">
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-[4px] border border-accent/50 bg-accent/15 text-accent">
                <Sparkles className="size-5" aria-hidden="true" />
              </span>
              <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-accent px-2 font-display text-base text-[#0e0e0e]">
                {seancesGratuites}
              </span>
            </span>
            <span>
              <span className="block font-display text-lg leading-tight text-text">
                Vos séances gratuites en ligne
              </span>
              <span className="mt-1 block text-xs leading-snug text-accent">
                {seancesGratuites > 1
                  ? `${seancesGratuites} séances offertes à utiliser →`
                  : "1 séance offerte à utiliser →"}
              </span>
            </span>
          </Link>
        )}

        {TUILES.map((t) => {
          const Icone = t.icon;
          return (
            <Link
              key={t.href}
              href={t.href}
              className="group flex min-h-[112px] flex-col justify-between gap-3 rounded-[4px] border border-border bg-surface/60 p-4 transition-colors hover:border-accent/50 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:p-5"
            >
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-[4px] border border-accent/40 bg-accent/10 text-accent transition-colors group-hover:border-accent/70">
                <Icone className="size-5" aria-hidden="true" />
              </span>
              <span>
                <span className="block font-display text-base leading-tight text-text sm:text-lg">
                  {t.label}
                </span>
                <span className="mt-1 block text-xs leading-snug text-text-secondary">
                  {t.description}
                </span>
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
