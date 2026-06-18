"use client";

import { useState } from "react";
import { Ticket as TicketIcon } from "lucide-react";

import { BuyTickets } from "@/components/BuyTickets";
import { WidgetCard, WidgetEmpty } from "@/components/espace/WidgetCard";
import type { Solde } from "@/components/espace/solde";
import { totalSolde } from "@/components/espace/solde";

/**
 * Widget « Mes tickets » — solde par type bien visible + accès à l'achat.
 *
 * Affiche le solde collectif / particulier en gros chiffres (ou un état vide
 * engageant si zéro), puis un bouton « Prendre des tickets » qui déploie le
 * composant `BuyTickets` existant INLINE (pas de navigation) — montants
 * indicatifs, branche Stripe phase 2.
 *
 * `error` (échec de lecture du solde côté serveur) bascule sur l'état d'erreur :
 * on n'affiche jamais un solde « 0 » trompeur quand la requête a réellement
 * échoué.
 */
export function TicketsWidget({
  solde,
  error = false,
}: {
  solde: Solde;
  error?: boolean;
}) {
  const [achat, setAchat] = useState(false);
  const total = totalSolde(solde);

  return (
    <WidgetCard title="Mes tickets" titleId="widget-tickets-title" icon={TicketIcon}>
      {error ? (
        <WidgetEmpty message="Votre solde n'a pas pu être chargé pour le moment." />
      ) : (
        <>
          {total > 0 ? (
            <div className="grid grid-cols-2 gap-3">
              <SoldeItem label="Collectif" valeur={solde.collectif} />
              <SoldeItem label="Particulier" valeur={solde.particulier} />
            </div>
          ) : (
            <WidgetEmpty message="Vous n'avez pas encore de ticket. Prenez-en pour réserver vos séances quand vous voulez." />
          )}

          <div className="mt-4">
            {!achat ? (
              <button
                type="button"
                onClick={() => setAchat(true)}
                aria-expanded={false}
                className="inline-flex min-h-[44px] w-full items-center justify-center rounded-[4px] bg-accent px-5 py-2.5 text-sm font-medium text-[#0e0e0e] transition-colors hover:bg-accent-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:w-auto"
              >
                Prendre des tickets
              </button>
            ) : (
              <div className="-mx-1">
                {/* BuyTickets apporte sa propre carte ; on neutralise sa bordure
                    pour qu'il s'intègre dans le widget sans double encadré. */}
                <div className="[&>section]:border-0 [&>section]:bg-transparent [&>section]:p-0">
                  <BuyTickets title="Choisir une formule" />
                </div>
                <button
                  type="button"
                  onClick={() => setAchat(false)}
                  className="mt-2 text-sm text-text-secondary transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  Masquer
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </WidgetCard>
  );
}

function SoldeItem({ label, valeur }: { label: string; valeur: number }) {
  return (
    <div className="rounded-[4px] border border-border bg-surface p-3 text-center">
      <p className="font-display text-3xl text-accent">{valeur}</p>
      <p className="mt-0.5 text-xs uppercase tracking-widest text-text-secondary">
        {label}
      </p>
    </div>
  );
}
