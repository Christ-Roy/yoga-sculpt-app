import Link from "next/link";
import { Gift } from "lucide-react";

/**
 * Encart « 1ère séance offerte » — affiché tant que le compte dispose encore de
 * son ticket de bienvenue (cf src/lib/welcome-ticket.ts). C'est le levier
 * d'activation clé : on pousse fortement la 1re réservation, qui matérialise la
 * promesse « Essai gratuit » du vitrine.
 *
 * Composant statique (pas de `"use client"`) : un simple CTA vers le calendrier.
 * Disparaît automatiquement dès que le ticket welcome est consommé (la page
 * espace ne le rend que si une séance `source='welcome'` reste disponible).
 */
export function WelcomeTicketBanner() {
  return (
    <div className="mb-8 animate-fade-in-up rounded-[4px] border border-accent/40 bg-accent/5 p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[4px] bg-accent/15 text-accent"
          >
            <Gift className="h-5 w-5" />
          </span>
          <div>
            <p className="font-display text-lg text-text">
              Votre 1ère séance est offerte
            </p>
            <p className="mt-1 text-sm leading-relaxed text-text-secondary">
              Profitez d&apos;une séance collective découverte, gratuite. Choisissez
              le créneau qui vous arrange.
            </p>
          </div>
        </div>
        <Link
          href="/espace/reserver"
          className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-[4px] bg-accent px-5 py-2.5 text-sm font-medium text-[#0e0e0e] transition-colors hover:bg-accent-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Réserver ma séance offerte
        </Link>
      </div>
    </div>
  );
}
