"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarCheck } from "lucide-react";

import type { Booking } from "@/lib/db-types";
import {
  DELAI_ANNULATION_HEURES,
  dansMoinsDe,
  formaterDateLongueFr,
  formaterPlageFr,
  libelleType,
} from "@/lib/reservation";
import type { SeanceAgenda } from "@/lib/calendar-export";
import { AddToCalendar } from "@/components/AddToCalendar";
import { LieuMaps } from "@/components/LieuMaps";
import { useToast } from "@/components/ui/toast";
import { Spinner } from "@/components/ui/spinner";
import { WidgetCard, WidgetEmpty } from "@/components/espace/WidgetCard";

/**
 * Widget « Mes séances à venir » — version compacte des réservations confirmées
 * pour le tableau de bord `/espace`.
 *
 * Réutilise la logique d'annulation (`POST /api/annuler`, garde 24h UI + serveur)
 * et le bloc « Ajouter à mon agenda » (`AddToCalendar`). On limite l'affichage aux
 * `limite` prochaines séances ; un lien « Voir tout » renvoie vers la page dédiée.
 *
 * État vide ENGAGEANT (demande Robert) : invite explicite à réserver une 1re séance.
 */

export interface SeanceWidget {
  id: string;
  type: Booking["type"];
  starts_at: string;
  ends_at: string;
  /**
   * Lieu RÉEL de la séance (champ « Lieu » de l'event Google), relu par la page.
   * Absent (`undefined`) si Google est indisponible ou le lieu non saisi → on
   * affiche « Lieu à confirmer » plutôt qu'un lieu potentiellement faux.
   */
  lieu?: string;
}

function versSeanceAgenda(s: SeanceWidget): SeanceAgenda {
  return {
    id: s.id,
    titre: `${libelleType(s.type)} — Yoga Sculpt`,
    starts_at: s.starts_at,
    ends_at: s.ends_at,
    lieu: s.lieu?.trim() || undefined,
    description: "Séance Yoga Sculpt avec Alice Gaudry.",
  };
}

export function SeancesAVenirWidget({
  seancesInitiales,
  limite = 2,
}: {
  seancesInitiales: SeanceWidget[];
  /** Nombre de séances montrées dans le widget (le reste via « Voir tout »). */
  limite?: number;
}) {
  const [seances, setSeances] = useState<SeanceWidget[]>(seancesInitiales);
  const [enCours, setEnCours] = useState<string | null>(null);
  const { toast } = useToast();

  async function annuler(s: SeanceWidget) {
    setEnCours(s.id);
    try {
      const res = await fetch("/api/annuler", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId: s.id }),
      });
      if (res.ok) {
        setSeances((list) => list.filter((x) => x.id !== s.id));
        toast("Réservation annulée.", "success");
        return;
      }
      if (res.status === 404) {
        setSeances((list) => list.filter((x) => x.id !== s.id));
        toast("Réservation introuvable.", "error");
        return;
      }
      if (res.status === 409) {
        toast("Annulation impossible à moins de 24h du cours.", "error");
        return;
      }
      if (res.status === 403) {
        toast("Cette réservation ne vous appartient pas.", "error");
        return;
      }
      toast("L'annulation a échoué. Réessayez.", "error");
    } catch {
      toast("Problème de connexion. Réessayez.", "error");
    } finally {
      setEnCours(null);
    }
  }

  const visibles = seances.slice(0, limite);
  const reste = seances.length - visibles.length;

  return (
    <WidgetCard
      title="Mes séances à venir"
      titleId="widget-seances-title"
      icon={CalendarCheck}
      accent
      action={
        seances.length > 0 ? (
          <Link
            href="/espace/reservations"
            className="text-sm text-accent transition-colors hover:text-accent-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Voir tout
          </Link>
        ) : null
      }
    >
      {seances.length === 0 ? (
        <WidgetEmpty message="Vous n'avez aucune séance à venir.">
          <Link
            href="/espace/reserver"
            className="inline-flex min-h-[44px] items-center justify-center rounded-[4px] bg-accent px-5 py-2.5 text-sm font-medium text-[#0e0e0e] transition-colors hover:bg-accent-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Réservez votre première séance
          </Link>
        </WidgetEmpty>
      ) : (
        <ul className="flex flex-col gap-3">
          {visibles.map((s) => {
            const tropTard = dansMoinsDe(s.starts_at, DELAI_ANNULATION_HEURES);
            return (
              <li
                key={s.id}
                className="rounded-[4px] border border-border bg-surface p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs uppercase tracking-wider ${
                        s.type === "particulier"
                          ? "border border-accent/60 bg-accent/10 text-accent"
                          : "border border-border bg-surface-2 text-text-secondary"
                      }`}
                    >
                      {libelleType(s.type)}
                    </span>
                    <p className="mt-2 text-sm font-medium text-text">
                      {formaterDateLongueFr(s.starts_at)}
                    </p>
                    <p className="text-sm text-text-secondary">
                      {formaterPlageFr(s.starts_at, s.ends_at)}
                    </p>
                    <div className="mt-1.5">
                      <LieuMaps lieu={s.lieu} />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void annuler(s)}
                    disabled={tropTard || enCours === s.id}
                    title={
                      tropTard ? "Annulation possible jusqu'à 24h avant" : undefined
                    }
                    aria-label={
                      tropTard
                        ? "Annulation impossible (moins de 24h avant la séance)"
                        : `Annuler la réservation du ${formaterDateLongueFr(s.starts_at)}`
                    }
                    className="inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-[4px] border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-red-500/50 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border disabled:hover:text-text-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    {enCours === s.id ? (
                      <>
                        <Spinner className="size-3.5" />
                        Annulation…
                      </>
                    ) : (
                      "Annuler"
                    )}
                  </button>
                </div>

                <div className="mt-3 border-t border-border pt-3">
                  <AddToCalendar
                    bookingId={s.id}
                    seance={versSeanceAgenda(s)}
                    compact
                  />
                </div>
              </li>
            );
          })}

          {reste > 0 && (
            <li>
              <Link
                href="/espace/reservations"
                className="block rounded-[4px] border border-dashed border-border px-4 py-2.5 text-center text-sm text-text-secondary transition-colors hover:border-accent/50 hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                + {reste} autre{reste > 1 ? "s" : ""} séance{reste > 1 ? "s" : ""}
              </Link>
            </li>
          )}
        </ul>
      )}
    </WidgetCard>
  );
}
