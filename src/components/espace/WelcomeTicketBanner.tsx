import Link from "next/link";
import { Gift } from "lucide-react";
import { TicketIcon } from "@/components/TicketIcon";

/**
 * Encart PARRAINAGE — levier d'activation clé du dashboard.
 * Les seules séances gratuites proviennent du parrainage (1 ticket par ami
 * inscrit, jusqu'à 3). On pousse donc fortement vers la page de parrainage,
 * avec un CTA "glow" animé (façon "Essai gratuit" de la LP) pour signaler que
 * c'est l'action importante.
 *
 * Note : le composant garde le nom `WelcomeTicketBanner` (import existant),
 * mais son rôle est désormais "récupérez vos séances offertes en parrainant".
 */
export function WelcomeTicketBanner() {
  return (
    <div className="mb-8 animate-fade-in-up rounded-[4px] border border-accent/40 bg-accent/5 p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <TicketIcon type="collectif" className="mt-0.5 h-9 w-14 shrink-0" />
          <div className="min-w-0">
            <p className="font-display text-lg text-text">
              Vos séances offertes vous attendent
            </p>
            <p className="mt-1 text-sm leading-relaxed text-text-secondary">
              Gagnez une séance gratuite pour chaque ami(e) qui crée son compte
              avec votre lien — jusqu&apos;à 3 séances offertes.
            </p>
          </div>
        </div>
        <Link
          href="/espace/parrainer"
          className="btn-cta-glow max-sm:w-full sm:flex-[0_0_auto]"
          aria-label="Récupérer mes séances offertes en parrainant"
        >
          <Gift className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          Récupérer mes séances offertes
        </Link>
      </div>
    </div>
  );
}
