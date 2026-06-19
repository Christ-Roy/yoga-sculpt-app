"use client";

import { useEffect, useMemo, useState } from "react";
import type { SlotLibre } from "@/lib/reservation";
import { Spinner } from "@/components/ui/spinner";
import {
  cleJour,
  formaterDateLongueFr,
  formaterHeureFr,
} from "@/lib/reservation";
import type { Booking, TicketType } from "@/lib/db-types";

/**
 * Cours PARTICULIER en créneau LIBRE (décision Robert 2026-06-19).
 *
 * Contrairement au collectif (liste de créneaux figés posés par Alice), le
 * particulier laisse le client choisir librement une date + une heure pleine
 * entre 9h et 21h (heure de Paris), SAUF les heures où Alice est occupée
 * (calculées côté serveur via freebusy → /api/creneaux/particulier).
 *
 * Flux :
 *   1. Charge `GET /api/creneaux/particulier` (slots libres calculés).
 *   2. Sélecteur de DATE (jours qui ont au moins un slot libre) puis d'HEURE
 *      (boutons ; les heures occupées n'apparaissent simplement pas — calculé
 *      serveur). On affiche la plage 9h-21h en GRISANT les heures indisponibles
 *      pour que le client comprenne qu'elles existent mais sont prises.
 *   3. « Réserver » → POST `/api/reserver` { type:"particulier", startsAt }.
 *
 * Charte NOIR & OR de l'app. Mobile-first.
 */

/** Toutes les heures de début possibles de la plage (9h → 20h inclus). */
const HEURES_PLAGE = Array.from({ length: 12 }, (_, i) => 9 + i); // 9..20

interface ReserverParticulierLibreProps {
  /** Nombre de tickets particulier disponibles (informatif + garde UI). */
  soldeParticulier: number;
  /** Callback après une réservation réussie (décrément solde + toast). */
  onReserved: (booking: Booking) => void;
  /** Callback quand il manque un ticket (ouvre le bloc d'achat ciblé). */
  onNeedsPurchase: (type: TicketType) => void;
  /** Callback de message d'erreur (toast). */
  onError: (message: string) => void;
}

export function ReserverParticulierLibre({
  soldeParticulier,
  onReserved,
  onNeedsPurchase,
  onError,
}: ReserverParticulierLibreProps) {
  const [slots, setSlots] = useState<SlotLibre[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [jourSelectionne, setJourSelectionne] = useState<string | null>(null);
  const [enCours, setEnCours] = useState<string | null>(null);
  // Slots réservés dans cette session (starts_at) → masqués / désactivés.
  const [reserves, setReserves] = useState<Set<string>>(new Set());

  // ── Chargement des slots libres. ────────────────────────────────────────────
  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const res = await fetch("/api/creneaux/particulier", {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { slots: SlotLibre[] };
        if (!annule) setSlots(data.slots ?? []);
      } catch {
        if (!annule) {
          setErreur("Impossible de charger les disponibilités pour le moment.");
          setSlots([]);
        }
      }
    })();
    return () => {
      annule = true;
    };
  }, []);

  // ── Regroupement par jour. ──────────────────────────────────────────────────
  const groupes = useMemo(() => grouperParJour(slots ?? []), [slots]);

  // Jour effectif : la sélection explicite si valide, sinon le 1er jour dispo.
  // On DÉRIVE plutôt que de setState dans un effect (évite les cascading renders).
  const jourActif =
    (jourSelectionne &&
      groupes.some((g) => g.cle === jourSelectionne) &&
      jourSelectionne) ||
    groupes[0]?.cle ||
    null;

  const groupeActif = groupes.find((g) => g.cle === jourActif) ?? null;

  // ── Réservation d'un slot. ──────────────────────────────────────────────────
  async function reserver(startsAt: string) {
    setEnCours(startsAt);
    try {
      const res = await fetch("/api/reserver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "particulier", startsAt }),
      });

      if (res.ok) {
        const data = (await res.json()) as { ok: boolean; booking: Booking };
        setReserves((r) => new Set(r).add(startsAt));
        onReserved(data.booking);
        return;
      }
      if (res.status === 402) {
        onNeedsPurchase("particulier");
        return;
      }
      if (res.status === 409) {
        onError("Ce créneau vient d'être pris. Choisissez-en un autre.");
        // Recharge pour retirer le créneau devenu indisponible.
        void recharger();
        return;
      }
      if (res.status === 400) {
        onError("Ce créneau n'est pas valide. Choisissez-en un autre.");
        return;
      }
      onError("La réservation a échoué. Réessayez dans un instant.");
    } catch {
      onError("Problème de connexion. Réessayez.");
    } finally {
      setEnCours(null);
    }
  }

  async function recharger() {
    setErreur(null);
    try {
      const res = await fetch("/api/creneaux/particulier", {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { slots: SlotLibre[] };
      setSlots(data.slots ?? []);
    } catch {
      setErreur("Impossible de charger les disponibilités pour le moment.");
      setSlots([]);
    }
  }

  // ── Rendu. ──────────────────────────────────────────────────────────────────
  return (
    <section
      aria-label="Réserver un cours particulier"
      className="rounded-[4px] border border-accent/30 bg-surface/40 p-4 sm:p-5"
    >
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-full border border-accent/60 bg-accent/10 px-2.5 py-0.5 text-xs uppercase tracking-wider text-accent">
          Cours particulier
        </span>
        <span className="text-xs text-text-secondary">
          {soldeParticulier} ticket{soldeParticulier > 1 ? "s" : ""} dispo
        </span>
      </div>
      <p className="mb-4 text-sm leading-relaxed text-text-secondary">
        Choisissez librement votre créneau (9h–21h). Les heures déjà prises sont
        grisées.
      </p>

      {slots === null && <SlotsSkeleton />}

      {slots !== null && erreur && (
        <div className="rounded-[4px] border border-border bg-surface/60 p-6 text-center">
          <p className="text-sm text-text-secondary">{erreur}</p>
          <button
            type="button"
            onClick={() => void recharger()}
            className="mt-3 text-sm text-accent transition-colors hover:text-accent-dark"
          >
            Réessayer
          </button>
        </div>
      )}

      {slots !== null && !erreur && groupes.length === 0 && (
        <div className="rounded-[4px] border border-border bg-surface/60 p-6 text-center">
          <p className="text-sm leading-relaxed text-text-secondary">
            Aucune disponibilité dans les prochaines semaines. Revenez bientôt.
          </p>
        </div>
      )}

      {slots !== null && !erreur && groupes.length > 0 && (
        <div className="flex flex-col gap-4">
          {/* Sélecteur de jour (puces horizontales scrollables). */}
          <div
            className="flex gap-2 overflow-x-auto pb-1"
            role="tablist"
            aria-label="Choisir un jour"
          >
            {groupes.map((g) => {
              const actif = g.cle === jourActif;
              return (
                <button
                  key={g.cle}
                  type="button"
                  role="tab"
                  aria-selected={actif}
                  onClick={() => setJourSelectionne(g.cle)}
                  className={`shrink-0 rounded-[4px] border px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                    actif
                      ? "border-accent/60 bg-accent/10 text-accent"
                      : "border-border bg-surface/60 text-text-secondary hover:text-text"
                  }`}
                >
                  {g.libelleCourt}
                </button>
              );
            })}
          </div>

          {/* Grille des heures du jour sélectionné (9h-21h, occupées grisées). */}
          {groupeActif && (
            <div>
              <h4 className="mb-3 text-sm font-medium text-text">
                {formaterDateLongueFr(groupeActif.premierSlot)}
              </h4>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {HEURES_PLAGE.map((heure) => {
                  const slot = groupeActif.slotsParHeure.get(heure);
                  const startsAt = slot?.starts_at ?? null;
                  const dejaReserve = startsAt
                    ? reserves.has(startsAt)
                    : false;
                  const libre = Boolean(slot) && !dejaReserve;
                  const enChargement = startsAt
                    ? enCours === startsAt
                    : false;
                  const noTicket = soldeParticulier <= 0;

                  return (
                    <button
                      key={heure}
                      type="button"
                      disabled={!libre || enChargement}
                      aria-disabled={!libre}
                      onClick={() =>
                        startsAt && libre && void reserver(startsAt)
                      }
                      title={
                        dejaReserve
                          ? "Vous venez de réserver ce créneau"
                          : !slot
                            ? "Indisponible"
                            : noTicket
                              ? "Réserver (achat de ticket requis)"
                              : "Réserver ce créneau"
                      }
                      className={`inline-flex min-h-[44px] items-center justify-center rounded-[4px] border px-2 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                        libre
                          ? "border-accent/40 bg-accent/5 text-text hover:border-accent hover:bg-accent/15"
                          : "cursor-not-allowed border-border bg-surface/40 text-text-secondary/50 line-through"
                      } disabled:cursor-not-allowed`}
                    >
                      {enChargement ? (
                        <Spinner className="size-4" />
                      ) : dejaReserve ? (
                        "✓"
                      ) : (
                        `${heure}h`
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-xs text-text-secondary">
                Cours de 60 min. Réservation possible jusqu&apos;à 24h à
                l&apos;avance.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ============================================================================
// Sous-composants & helpers
// ============================================================================

function SlotsSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      <div className="flex gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-10 w-20 shrink-0 animate-pulse rounded-[4px] border border-border bg-surface/40"
          />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="h-11 animate-pulse rounded-[4px] border border-border bg-surface/40"
          />
        ))}
      </div>
    </div>
  );
}

interface GroupeJourLibre {
  cle: string;
  libelleCourt: string;
  /** Un slot représentatif du jour (pour le libellé long). */
  premierSlot: string;
  /** Heure de début (9..20) → slot libre correspondant. */
  slotsParHeure: Map<number, SlotLibre>;
}

/** Heure de début (0-23) d'un slot, en heure de Paris. */
function heureDebutParis(iso: string): number {
  const txt = formaterHeureFr(iso); // ex. "09h00"
  return Number(txt.slice(0, 2));
}

/** Regroupe les slots libres par jour (ordre chronologique préservé). */
function grouperParJour(slots: SlotLibre[]): GroupeJourLibre[] {
  const map = new Map<string, GroupeJourLibre>();
  for (const s of slots) {
    const cle = cleJour(s.starts_at);
    let groupe = map.get(cle);
    if (!groupe) {
      groupe = {
        cle,
        libelleCourt: libelleCourtJour(s.starts_at),
        premierSlot: s.starts_at,
        slotsParHeure: new Map(),
      };
      map.set(cle, groupe);
    }
    groupe.slotsParHeure.set(heureDebutParis(s.starts_at), s);
  }
  return Array.from(map.values());
}

/** Libellé court d'un jour pour les puces, ex. "Mar. 23/06". */
function libelleCourtJour(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const brut = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  }).format(d);
  return brut.charAt(0).toUpperCase() + brut.slice(1);
}
