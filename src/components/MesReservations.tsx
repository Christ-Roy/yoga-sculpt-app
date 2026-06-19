"use client";

import { useState } from "react";
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

/**
 * « Mes réservations » — bookings CONFIRMÉS à venir du user.
 *
 * Pour chaque réservation :
 *   - date / heure / type,
 *   - bloc « Ajouter à mon agenda » (Google + .ics avec rappels),
 *   - bouton « Annuler » → POST `/api/annuler`.
 *
 * 🔴 GARDE-FOU 24h : garde-fou UI (calculé côté client) DOUBLÉ d'une garde
 * serveur dans `/api/annuler` (même seuil DELAI_ANNULATION_HEURES, qui renvoie
 * 409 `{ tooLate: true }` si la séance démarre dans moins de 24h). Si la séance
 * démarre dans moins de 24h, le bouton est DÉSACTIVÉ avec un libellé explicite.
 * On ne désinscrit pas à la dernière minute.
 *
 * RESPONSIVE : cartes empilées, bloc agenda en colonne sur mobile / ligne ≥sm,
 * cibles ≥44px.
 */

/** Données initiales (server component) — sous-ensemble du booking + titre. */
export interface BookingAffichage {
  id: string;
  type: Booking["type"];
  starts_at: string;
  ends_at: string;
  /** Titre éventuel (summary Google), sinon dérivé du type côté UI. */
  titre?: string | null;
  /**
   * Lieu du cours (champ « Lieu » de l'event Google). Le booking ne le stocke
   * pas en base : la page peut le passer si elle l'enrichit depuis Google,
   * sinon il reste absent et on ne l'affiche tout simplement pas ici (pas de
   * « Lieu à confirmer » trompeur — la donnée n'est pas chargée, ce n'est pas
   * une absence de saisie). Le .ics téléchargé, lui, est enrichi côté route
   * `/api/ics` qui relit l'event Google.
   */
  lieu?: string | null;
}

function bookingVersSeance(b: BookingAffichage): SeanceAgenda {
  return {
    id: b.id,
    titre: b.titre?.trim() || `${libelleType(b.type)} — Yoga Sculpt`,
    starts_at: b.starts_at,
    ends_at: b.ends_at,
    // Lieu réel s'il a été enrichi par la page ; sinon absent (la route
    // `/api/ics` réinjecte le vrai lieu depuis Google au téléchargement).
    lieu: b.lieu?.trim() || undefined,
    description: "Séance Yoga Sculpt avec Alice Gaudry.",
  };
}

export function MesReservations({
  bookingsInitiaux,
}: {
  bookingsInitiaux: BookingAffichage[];
}) {
  const [bookings, setBookings] = useState<BookingAffichage[]>(bookingsInitiaux);
  const [enCours, setEnCours] = useState<string | null>(null);
  const { toast } = useToast();

  async function annuler(b: BookingAffichage) {
    setEnCours(b.id);
    try {
      const res = await fetch("/api/annuler", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId: b.id }),
      });
      if (res.ok) {
        setBookings((list) => list.filter((x) => x.id !== b.id));
        toast("Réservation annulée.", "success");
        return;
      }
      if (res.status === 403) {
        toast("Cette réservation ne vous appartient pas.", "error");
        return;
      }
      if (res.status === 404) {
        // Déjà supprimée côté serveur : on retire localement.
        setBookings((list) => list.filter((x) => x.id !== b.id));
        toast("Réservation introuvable.", "error");
        return;
      }
      if (res.status === 409) {
        // Garde serveur 24h (tooLate) : la séance est passée sous le seuil
        // depuis l'affichage. On garde la carte et on explique le refus.
        toast("Annulation impossible à moins de 24h du cours.", "error");
        return;
      }
      toast("L'annulation a échoué. Réessayez.", "error");
    } catch {
      toast("Problème de connexion. Réessayez.", "error");
    } finally {
      setEnCours(null);
    }
  }

  if (bookings.length === 0) {
    return (
      <div className="rounded-[4px] border border-border bg-surface/60 p-8 text-center">
        <p className="text-sm leading-relaxed text-text-secondary">
          Vous n&apos;avez aucune réservation à venir.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-3">
        {bookings.map((b) => {
          const tropTard = dansMoinsDe(b.starts_at, DELAI_ANNULATION_HEURES);
          return (
            <li
              key={b.id}
              className="rounded-[4px] border border-border bg-surface/60 p-4"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs uppercase tracking-wider ${
                      b.type === "particulier"
                        ? "border border-accent/60 bg-accent/10 text-accent"
                        : "border border-border bg-surface-2 text-text-secondary"
                    }`}
                  >
                    {libelleType(b.type)}
                  </span>
                  <p className="mt-2 text-sm font-medium text-text">
                    {formaterDateLongueFr(b.starts_at)}
                  </p>
                  <p className="text-sm text-text-secondary">
                    {formaterPlageFr(b.starts_at, b.ends_at)}
                  </p>
                  {/* Lieu cliquable (Google Maps) — affiché seulement s'il est
                      renseigné (le booking ne stocke pas le lieu en base). */}
                  {b.lieu?.trim() && (
                    <div className="mt-1.5">
                      <LieuMaps lieu={b.lieu} />
                    </div>
                  )}
                </div>

                <div className="shrink-0">
                  <button
                    type="button"
                    onClick={() => void annuler(b)}
                    disabled={tropTard || enCours === b.id}
                    title={
                      tropTard
                        ? "Annulation possible jusqu'à 24h avant"
                        : undefined
                    }
                    aria-label={
                      tropTard
                        ? "Annulation impossible (moins de 24h avant la séance)"
                        : `Annuler la réservation du ${formaterDateLongueFr(b.starts_at)}`
                    }
                    className="inline-flex min-h-[44px] w-full items-center justify-center rounded-[4px] border border-border bg-surface px-4 py-2.5 text-sm font-medium text-text transition-colors hover:border-red-500/50 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border disabled:hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:w-auto"
                  >
                    {enCours === b.id ? (
                      <>
                        <Spinner />
                        Annulation…
                      </>
                    ) : (
                      "Annuler"
                    )}
                  </button>
                </div>
              </div>

              {tropTard && (
                <p className="mt-2 text-xs text-text-secondary">
                  Annulation possible jusqu&apos;à 24h avant la séance.
                </p>
              )}

              <div className="mt-4 border-t border-border pt-4">
                <AddToCalendar
                  bookingId={b.id}
                  seance={bookingVersSeance(b)}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
