"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Creneau } from "@/lib/reservation";
import {
  cleJour,
  formaterDateLongueFr,
  formaterPlageFr,
  libelleType,
} from "@/lib/reservation";
import type { Booking, TicketType } from "@/lib/db-types";
import type { SeanceAgenda } from "@/lib/calendar-export";
import { AddToCalendar } from "@/components/AddToCalendar";
import { BuyTickets } from "@/components/BuyTickets";
import { Toast, type ToastVariant } from "@/components/Toast";

/**
 * Calendrier de réservation MAISON (remplace l'embed Cal.com).
 *
 * Flux :
 *   1. Charge `GET /api/creneaux` (créneaux futurs du Google Agenda d'Alice).
 *   2. Les regroupe par jour (fuseau Paris) et les affiche en cartes.
 *   3. « Réserver » → POST `/api/reserver`. Gère 200 / 402 / 404 / 409 / autres.
 *      - 200 : toast OK, le créneau passe « réservé », bloc « Ajouter à
 *              mon agenda » proposé inline (avec le bookingId renvoyé), solde
 *              de tickets décrémenté localement.
 *      - 402 : ouvre/scrolle vers le bloc d'achat, mis en avant sur le bon type.
 *      - 409 : « Vous avez déjà réservé ce créneau ».
 *   4. Gère le retour Stripe via `?status=success|cancel`.
 *
 * États : loading (skeleton), vide, erreur. Tout est mobile-first.
 */

interface SoldeTickets {
  collectif: number;
  particulier: number;
}

/** Construit les données d'export agenda d'un créneau. */
function creneauVersSeance(c: Creneau): SeanceAgenda {
  return {
    id: c.id,
    titre: c.summary?.trim() || `${libelleType(c.type)} — Yoga Sculpt`,
    starts_at: c.starts_at,
    ends_at: c.ends_at,
    lieu: "Lyon", // placeholder tant qu'Alice n'a pas confirmé l'adresse
    description: "Séance Yoga Sculpt avec Alice Gaudry.",
  };
}

export function ReserverClient({
  soldeInitial,
  statusParam,
}: {
  soldeInitial: SoldeTickets;
  /** `?status=success|cancel` au retour de Stripe. */
  statusParam: "success" | "cancel" | null;
}) {
  const [creneaux, setCreneaux] = useState<Creneau[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [solde, setSolde] = useState<SoldeTickets>(soldeInitial);

  // Réservations effectuées dans cette session : creneauId → bookingId.
  // Permet de basculer la carte en « réservé » et d'alimenter le .ics.
  const [reserves, setReserves] = useState<Record<string, string>>({});
  // Créneau dont la réservation est en cours (spinner ciblé).
  const [enCours, setEnCours] = useState<string | null>(null);

  const [toast, setToast] = useState<{
    message: string;
    variant: ToastVariant;
  } | null>(null);

  // Type à mettre en avant dans le bloc d'achat (après un 402).
  const [achatType, setAchatType] = useState<TicketType | null>(null);
  const achatRef = useRef<HTMLDivElement>(null);

  // ── Chargement des créneaux. ───────────────────────────────────────────────
  const charger = useCallback(async () => {
    setErreur(null);
    try {
      const res = await fetch("/api/creneaux", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { creneaux: Creneau[] };
      setCreneaux(data.creneaux ?? []);
    } catch {
      setErreur("Impossible de charger les créneaux pour le moment.");
      setCreneaux([]);
    }
  }, []);

  useEffect(() => {
    void charger();
  }, [charger]);

  // ── Retour Stripe : toast informatif une seule fois. ────────────────────────
  useEffect(() => {
    if (statusParam === "success") {
      setToast({
        message:
          "Paiement reçu, merci ! Vos tickets sont crédités sous quelques secondes.",
        variant: "success",
      });
    } else if (statusParam === "cancel") {
      setToast({ message: "Paiement annulé.", variant: "error" });
    }
  }, [statusParam]);

  // ── Réservation d'un créneau. ───────────────────────────────────────────────
  async function reserver(c: Creneau) {
    setEnCours(c.id);
    try {
      const res = await fetch("/api/reserver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creneauId: c.id }),
      });

      if (res.ok) {
        const data = (await res.json()) as { ok: boolean; booking: Booking };
        setReserves((r) => ({ ...r, [c.id]: data.booking.id }));
        setSolde((s) => ({
          ...s,
          [c.type]: Math.max(0, s[c.type] - 1),
        }));
        setToast({ message: "Séance réservée !", variant: "success" });
        return;
      }

      if (res.status === 402) {
        // Pas de ticket du bon type → ouvre le bloc d'achat ciblé.
        const data = (await res.json()) as { type?: TicketType };
        setAchatType(data.type ?? c.type);
        setToast({
          message:
            "Vous n'avez pas de ticket pour ce cours. Choisissez une formule ci-dessous.",
          variant: "error",
        });
        // Laisse le state s'appliquer avant de scroller vers le bloc d'achat.
        requestAnimationFrame(() => {
          achatRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        });
        return;
      }

      if (res.status === 409) {
        setToast({
          message: "Vous avez déjà réservé ce créneau.",
          variant: "error",
        });
        return;
      }

      if (res.status === 404) {
        setToast({
          message: "Ce créneau n'est plus disponible.",
          variant: "error",
        });
        // Recharge pour retirer le créneau disparu.
        void charger();
        return;
      }

      setToast({
        message: "La réservation a échoué. Réessayez dans un instant.",
        variant: "error",
      });
    } catch {
      setToast({
        message: "Problème de connexion. Réessayez.",
        variant: "error",
      });
    } finally {
      setEnCours(null);
    }
  }

  // ── Regroupement par jour (fuseau Paris). ───────────────────────────────────
  const groupes = grouperParJour(creneaux ?? []);

  return (
    <div className="flex flex-col gap-6">
      {/* Solde de tickets */}
      <SoldeBadge solde={solde} />

      {/* Liste des créneaux */}
      <section aria-label="Créneaux disponibles">
        <h2 className="mb-4 font-display text-xl text-text">
          Créneaux à venir
        </h2>

        {creneaux === null && <CreneauxSkeleton />}

        {creneaux !== null && erreur && (
          <div className="rounded-[4px] border border-border bg-surface/60 p-6 text-center">
            <p className="text-sm text-text-secondary">{erreur}</p>
            <button
              type="button"
              onClick={() => void charger()}
              className="mt-3 text-sm text-accent transition-colors hover:text-accent-dark"
            >
              Réessayer
            </button>
          </div>
        )}

        {creneaux !== null && !erreur && creneaux.length === 0 && (
          <div className="rounded-[4px] border border-border bg-surface/60 p-8 text-center">
            <p className="text-sm leading-relaxed text-text-secondary">
              Aucun créneau disponible pour le moment — les prochaines dates
              arrivent bientôt.
            </p>
          </div>
        )}

        {creneaux !== null && !erreur && creneaux.length > 0 && (
          <div className="flex flex-col gap-7">
            {groupes.map((g) => (
              <div key={g.cle}>
                <h3 className="mb-3 text-sm font-medium uppercase tracking-widest text-text-secondary">
                  {g.libelle}
                </h3>
                <ul className="flex flex-col gap-3">
                  {g.creneaux.map((c) => (
                    <li key={c.id}>
                      <CreneauCard
                        creneau={c}
                        bookingId={reserves[c.id] ?? null}
                        enCours={enCours === c.id}
                        onReserver={() => void reserver(c)}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Bloc d'achat de tickets (mis en avant après un 402). */}
      <div ref={achatRef}>
        <BuyTickets highlightType={achatType} />
      </div>

      {toast && (
        <Toast
          message={toast.message}
          variant={toast.variant}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}

// ============================================================================
// Sous-composants
// ============================================================================

function SoldeBadge({ solde }: { solde: SoldeTickets }) {
  return (
    <div className="rounded-[4px] border border-border bg-surface/60 p-4">
      <p className="text-xs uppercase tracking-widest text-text-secondary">
        Mes tickets
      </p>
      <p className="mt-1.5 text-sm text-text">
        <span className="font-semibold text-accent">{solde.collectif}</span>{" "}
        ticket{solde.collectif > 1 ? "s" : ""} collectif
        <span className="mx-2 text-text-secondary">·</span>
        <span className="font-semibold text-accent">
          {solde.particulier}
        </span>{" "}
        particulier
      </p>
    </div>
  );
}

function CreneauCard({
  creneau,
  bookingId,
  enCours,
  onReserver,
}: {
  creneau: Creneau;
  bookingId: string | null;
  enCours: boolean;
  onReserver: () => void;
}) {
  const reserve = bookingId !== null;
  const estParticulier = creneau.type === "particulier";

  return (
    <div
      className={`rounded-[4px] border bg-surface/60 p-4 transition-colors ${
        reserve ? "border-accent/50" : "border-border"
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs uppercase tracking-wider ${
                estParticulier
                  ? "border border-accent/60 bg-accent/10 text-accent"
                  : "border border-border bg-surface-2 text-text-secondary"
              }`}
            >
              {libelleType(creneau.type)}
            </span>
            {creneau.inscrits > 0 && (
              <span className="text-xs text-text-secondary">
                {creneau.inscrits} inscrit{creneau.inscrits > 1 ? "s" : ""}
              </span>
            )}
          </div>
          <p className="mt-2 text-sm text-text">
            {formaterPlageFr(creneau.starts_at, creneau.ends_at)}
          </p>
          {creneau.summary && (
            <p className="mt-0.5 truncate text-xs text-text-secondary">
              {creneau.summary}
            </p>
          )}
        </div>

        <div className="shrink-0">
          {reserve ? (
            <span className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-[4px] border border-accent/50 bg-accent/10 px-4 py-2.5 text-sm font-medium text-accent">
              ✓ Réservé
            </span>
          ) : (
            <button
              type="button"
              onClick={onReserver}
              disabled={enCours}
              className="inline-flex min-h-[44px] w-full items-center justify-center rounded-[4px] bg-accent px-5 py-2.5 text-sm font-medium text-[#0e0e0e] transition-colors hover:bg-accent-dark disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:w-auto"
              aria-label={`Réserver le ${formaterDateLongueFr(creneau.starts_at)} à ${formaterPlageFr(creneau.starts_at, creneau.ends_at)}`}
            >
              {enCours ? "Réservation…" : "Réserver"}
            </button>
          )}
        </div>
      </div>

      {/* Après réservation : proposer l'ajout à l'agenda. */}
      {reserve && bookingId && (
        <div className="mt-4 border-t border-border pt-4">
          <AddToCalendar
            bookingId={bookingId}
            seance={creneauVersSeance(creneau)}
          />
        </div>
      )}
    </div>
  );
}

function CreneauxSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-24 animate-pulse rounded-[4px] border border-border bg-surface/40"
        />
      ))}
    </div>
  );
}

// ============================================================================
// Regroupement
// ============================================================================

interface GroupeJour {
  cle: string;
  libelle: string;
  creneaux: Creneau[];
}

/** Regroupe (en conservant l'ordre chronologique) les créneaux par jour. */
function grouperParJour(creneaux: Creneau[]): GroupeJour[] {
  const map = new Map<string, GroupeJour>();
  for (const c of creneaux) {
    const cle = cleJour(c.starts_at);
    let groupe = map.get(cle);
    if (!groupe) {
      groupe = {
        cle,
        libelle: formaterDateLongueFr(c.starts_at),
        creneaux: [],
      };
      map.set(cle, groupe);
    }
    groupe.creneaux.push(c);
  }
  // Les créneaux arrivent déjà triés par startTime depuis l'API ; l'ordre
  // d'insertion de la Map préserve donc l'ordre chronologique des jours.
  return Array.from(map.values());
}
