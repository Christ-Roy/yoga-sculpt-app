"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { isValidPhone } from "@/lib/phone";
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
import { LieuMaps } from "@/components/LieuMaps";
import { ReserverParticulierLibre } from "@/components/ReserverParticulierLibre";
import { useToast } from "@/components/ui/toast";
import { Spinner } from "@/components/ui/spinner";
import { trackFunnel, FUNNEL } from "@/lib/veridian-analytics";

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
    // Vrai lieu de l'event Google (champ « Lieu »). Si Alice ne l'a pas
    // renseigné, on n'invente rien : `lieu` reste absent et n'apparaît ni dans
    // le lien Google Agenda ni dans le .ics.
    lieu: c.lieu,
    description: "Séance Yoga Sculpt avec Alice Gaudry.",
  };
}

export function ReserverClient({
  soldeInitial,
  statusParam,
  hasPhone,
}: {
  soldeInitial: SoldeTickets;
  /** `?status=success|cancel` au retour de Stripe. */
  statusParam: "success" | "cancel" | null;
  /**
   * Le profil a-t-il déjà un téléphone ? Si NON, on réclame le numéro AVANT de
   * confirmer une réservation (Alice en a besoin pour rappeler la cliente). Si
   * OUI, on ne demande rien : le tél est déjà en base.
   */
  hasPhone: boolean;
}) {
  const [creneaux, setCreneaux] = useState<Creneau[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [solde, setSolde] = useState<SoldeTickets>(soldeInitial);

  // ── Garde TÉLÉPHONE ─────────────────────────────────────────────────────────
  // Tél fourni pendant cette session (validé) : une fois donné, on ne redemande
  // plus et on l'envoie avec chaque réservation pour le ranger côté serveur.
  const [phone, setPhone] = useState<string | null>(null);
  // Modal de saisie ouvert ? + résolveur de la promesse en attente (le flux de
  // réservation s'interrompt tant que la cliente n'a pas validé / annulé).
  const [askPhone, setAskPhone] = useState(false);
  const phoneResolver = useRef<((value: string | null) => void) | null>(null);

  // Le profil n'a pas de tél ET on n'en a pas encore saisi → il faut le demander.
  const needsPhone = !hasPhone && phone === null;

  /**
   * Garantit qu'on a un téléphone avant de réserver.
   *   - profil déjà pourvu (ou tél déjà saisi cette session) → résout direct ;
   *   - sinon → ouvre la modal et résout quand la cliente valide (numéro) ou
   *     annule (`null` → on AVORTE la réservation).
   */
  const ensurePhone = useCallback((): Promise<string | null> => {
    if (!needsPhone) return Promise.resolve(phone);
    return new Promise<string | null>((resolve) => {
      phoneResolver.current = resolve;
      setAskPhone(true);
    });
  }, [needsPhone, phone]);

  // Validation + enregistrement du tél saisi dans la modal.
  function soumettrePhone(raw: string) {
    const ok = isValidPhone(raw);
    if (!ok) return false;
    setPhone(raw);
    setAskPhone(false);
    phoneResolver.current?.(raw);
    phoneResolver.current = null;
    return true;
  }

  // Annulation de la modal → on AVORTE la réservation en cours.
  function annulerPhone() {
    setAskPhone(false);
    phoneResolver.current?.(null);
    phoneResolver.current = null;
  }

  // Réservations effectuées dans cette session : creneauId → bookingId.
  // Permet de basculer la carte en « réservé » et d'alimenter le .ics.
  const [reserves, setReserves] = useState<Record<string, string>>({});
  // Créneau dont la réservation est en cours (spinner ciblé).
  const [enCours, setEnCours] = useState<string | null>(null);

  const { toast } = useToast();

  // Toast de retour Stripe (?status=success|cancel). Émis une fois au montage
  // (le statut est connu dès le 1er render via searchParams). Effect plutôt que
  // l'ancien init paresseux car le toast est désormais géré par le provider.
  useEffect(() => {
    if (statusParam === "success") {
      toast(
        "Paiement reçu, merci ! Vos tickets sont crédités sous quelques secondes.",
        "success",
      );
      // Tunnel : achat confirmé (retour Stripe). La valeur € fiable est calculée
      // côté serveur (webhook Stripe) ; ici on marque la conversion côté visiteur.
      void trackFunnel(FUNNEL.PURCHASE);
    } else if (statusParam === "cancel") {
      toast("Paiement annulé.", "error");
    }
    // Volontairement au montage uniquement (statusParam est figé pour la page).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Type à mettre en avant dans le bloc d'achat (après un 402).
  const [achatType, setAchatType] = useState<TicketType | null>(null);
  const achatRef = useRef<HTMLDivElement>(null);

  // ── Chargement des créneaux. ───────────────────────────────────────────────
  // `reset` n'efface l'erreur que lors d'un rechargement manuel (bouton
  // « réessayer » / après réservation). Les setState ne se produisent qu'après
  // l'await (jamais synchrones), donc pas de cascading render.
  const charger = useCallback(async (reset = true) => {
    if (reset) setErreur(null);
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

  // Chargement initial au montage. Fetch inline (avec garde d'annulation) plutôt
  // qu'un appel direct à charger() : aucun setState n'est appelé de façon
  // synchrone dans l'effect, ils sont tous derrière l'await ou la garde.
  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const res = await fetch("/api/creneaux", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { creneaux: Creneau[] };
        if (!annule) setCreneaux(data.creneaux ?? []);
      } catch {
        if (!annule) {
          setErreur("Impossible de charger les créneaux pour le moment.");
          setCreneaux([]);
        }
      }
    })();
    return () => {
      annule = true;
    };
  }, []);

  // ── Réservation d'un créneau. ───────────────────────────────────────────────
  async function reserver(c: Creneau) {
    // Garde tél : si le profil n'en a pas, on réclame le numéro AVANT d'appeler
    // l'API. Annulation (null) → on n'engage pas la réservation.
    const tel = await ensurePhone();
    if (needsPhone && tel === null) return;

    setEnCours(c.id);
    try {
      const res = await fetch("/api/reserver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tel ? { creneauId: c.id, phone: tel } : { creneauId: c.id }),
      });

      if (res.ok) {
        const data = (await res.json()) as { ok: boolean; booking: Booking };
        setReserves((r) => ({ ...r, [c.id]: data.booking.id }));
        setSolde((s) => ({
          ...s,
          [c.type]: Math.max(0, s[c.type] - 1),
        }));
        toast("Séance réservée !", "success");
        void trackFunnel(FUNNEL.RESERVATION_CONFIRMED, {
          properties: { type: c.type },
        });
        return;
      }

      if (res.status === 402) {
        // Pas de ticket du bon type → ouvre le bloc d'achat ciblé.
        const data = (await res.json()) as { type?: TicketType };
        setAchatType(data.type ?? c.type);
        toast(
          "Vous n'avez pas de ticket pour ce cours. Choisissez une formule ci-dessous.",
          "error",
        );
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
        toast("Vous avez déjà réservé ce créneau.", "error");
        return;
      }

      if (res.status === 404) {
        toast("Ce créneau n'est plus disponible.", "error");
        // Recharge pour retirer le créneau disparu.
        void charger();
        return;
      }

      toast("La réservation a échoué. Réessayez dans un instant.", "error");
    } catch {
      toast("Problème de connexion. Réessayez.", "error");
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

      {/* Cours particulier — créneau LIBRE (le client choisit son horaire). */}
      <section aria-label="Cours particulier">
        <h2 className="mb-4 font-display text-xl text-text">
          Cours particulier
        </h2>
        <ReserverParticulierLibre
          soldeParticulier={solde.particulier}
          ensurePhone={ensurePhone}
          needsPhone={needsPhone}
          onReserved={(booking) => {
            setSolde((s) => ({
              ...s,
              particulier: Math.max(0, s.particulier - 1),
            }));
            setReserves((r) => ({ ...r, [booking.google_event_id]: booking.id }));
            toast("Séance réservée !", "success");
            void trackFunnel(FUNNEL.RESERVATION_CONFIRMED, {
              properties: { type: "particulier" },
            });
          }}
          onNeedsPurchase={(type) => {
            setAchatType(type);
            toast(
              "Vous n'avez pas de ticket pour ce cours. Choisissez une formule ci-dessous.",
              "error",
            );
            requestAnimationFrame(() => {
              achatRef.current?.scrollIntoView({
                behavior: "smooth",
                block: "center",
              });
            });
          }}
          onError={(message) => toast(message, "error")}
        />
      </section>

      {/* Cours collectif — liste des créneaux figés posés par Alice. */}
      <section aria-label="Créneaux collectifs disponibles">
        <h2 className="mb-4 font-display text-xl text-text">
          Cours collectifs à venir
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

      {/* Modal TÉLÉPHONE — réclamée à la 1ère réservation si le profil n'a pas
          de numéro. Une fois validé, on ne la rouvre plus de la session. */}
      {askPhone && (
        <PhoneGateDialog onSubmit={soumettrePhone} onCancel={annulerPhone} />
      )}
    </div>
  );
}

/**
 * Boîte de dialogue de saisie du téléphone (gate avant réservation).
 * Validée via `isValidPhone` ; le numéro est requis pour confirmer (Alice doit
 * pouvoir rappeler la cliente). Accessible : role=dialog, focus auto, fermeture
 * à Échap.
 */
function PhoneGateDialog({
  onSubmit,
  onCancel,
}: {
  /** Renvoie `true` si le numéro est valide (la modal se ferme), `false` sinon. */
  onSubmit: (raw: string) => boolean;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const ok = onSubmit(value);
    if (!ok) {
      setErreur(
        "Numéro invalide. Saisissez un numéro français valide (ex. 06 12 34 56 78).",
      );
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="phone-gate-title"
      onClick={(e) => {
        // Clic sur l'overlay (hors carte) = annulation.
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-sm rounded-[4px] border border-border bg-surface p-6 shadow-xl animate-fade-in-up">
        <h3
          id="phone-gate-title"
          className="font-display text-xl text-text"
        >
          Votre téléphone
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-text-secondary">
          Pour finaliser votre réservation, laissez votre numéro : Alice pourra
          vous joindre si besoin (changement d&apos;horaire, info pratique).
        </p>

        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
          <label htmlFor="phone-gate-input" className="sr-only">
            Numéro de téléphone
          </label>
          <input
            id="phone-gate-input"
            ref={inputRef}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            required
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (erreur) setErreur(null);
            }}
            placeholder="06 12 34 56 78"
            aria-invalid={erreur ? true : undefined}
            aria-describedby={erreur ? "phone-gate-error" : undefined}
            className="w-full rounded-[4px] border border-border bg-surface-2 px-4 py-3 text-sm text-text placeholder:text-text-secondary/70 focus:border-accent focus:outline-none"
          />
          {erreur && (
            <p
              id="phone-gate-error"
              className="text-sm text-red-400"
              role="alert"
            >
              {erreur}
            </p>
          )}
          <div className="mt-1 flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-[4px] border border-border bg-surface px-4 py-2.5 text-sm font-medium text-text-secondary transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Annuler
            </button>
            <button
              type="submit"
              className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-[4px] bg-accent px-4 py-2.5 text-sm font-medium text-[#0e0e0e] transition-colors hover:bg-accent-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Continuer
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================================================
// Sous-composants
// ============================================================================

function SoldeBadge({ solde }: { solde: SoldeTickets }) {
  const total = solde.collectif + solde.particulier;
  return (
    <div className="flex items-center justify-between gap-3 rounded-[4px] border border-border bg-surface/60 p-4">
      <div className="min-w-0">
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
      {/* Total agrégé bien visible (pastille OR). */}
      <span
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-accent/50 bg-accent/10 px-3 py-1 text-sm font-semibold text-accent"
        aria-label={`${total} ticket${total > 1 ? "s" : ""} au total`}
      >
        {total} ticket{total > 1 ? "s" : ""}
      </span>
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
          {/* Lieu cliquable (Google Maps) — ou « Lieu à confirmer » si absent. */}
          <div className="mt-1.5">
            <LieuMaps lieu={creneau.lieu} />
          </div>
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
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[4px] bg-accent px-5 py-2.5 text-sm font-medium text-[#0e0e0e] transition-colors hover:bg-accent-dark disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:w-auto"
              aria-label={`Réserver le ${formaterDateLongueFr(creneau.starts_at)} à ${formaterPlageFr(creneau.starts_at, creneau.ends_at)}`}
            >
              {enCours ? (
                <>
                  <Spinner />
                  Réservation…
                </>
              ) : (
                "Réserver"
              )}
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
