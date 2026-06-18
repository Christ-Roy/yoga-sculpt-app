"use client";

import { useMemo, useState } from "react";
import { formatDateHeure, formatDate, formatPlage } from "@/lib/admin-format";
import { TypeBadge } from "@/components/admin/TypeBadge";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { Toast, type ToastVariant } from "@/components/Toast";
import { ConfirmDialog } from "./ConfirmDialog";
import type { CreneauCible, ReservationAdmin } from "./_data";
import type { TicketType, BookingStatus } from "@/lib/db-types";

/**
 * Back-office « Gestion des réservations » — UI client (filtres + vues + actions).
 *
 * Deux vues :
 *   - LISTE  : toutes les réservations filtrables (période, statut, type, créneau,
 *              recherche client) avec actions par ligne.
 *   - CRÉNEAU: regroupement par créneau (à venir) → Alice voit la liste nominative
 *              des inscrits (nom / email / tél) pour préparer son cours.
 *
 * Actions (toutes confirmées via modale, gate requireAdmin re-checké serveur) :
 *   - Annuler au nom de la cliente (option « forcer < 24h », recrédit par défaut).
 *   - Déplacer vers un autre créneau (sélecteur, anti-double-booking serveur).
 *   - Pointer présent / absent (no-show) sur une séance.
 */

type StatutFiltre = "all" | BookingStatus;
type TypeFiltre = "all" | TicketType;
type PeriodeFiltre = "all" | "upcoming" | "past";
type Vue = "liste" | "creneau";

const ATTENDANCE_LABEL: Record<ReservationAdmin["attendance"], string> = {
  attended: "Présent",
  no_show: "Absent",
  pending: "—",
};

/** ISO « maintenant » figé au montage (cohérent pour le filtre passé/à venir). */
function maintenantIso(): string {
  return new Date().toISOString();
}

export function ReservationsManager({
  reservations: reservationsInitiales,
  creneauxCibles,
}: {
  reservations: ReservationAdmin[];
  creneauxCibles: CreneauCible[];
}) {
  const [reservations, setReservations] = useState(reservationsInitiales);
  const [vue, setVue] = useState<Vue>("liste");
  const [statut, setStatut] = useState<StatutFiltre>("all");
  const [type, setType] = useState<TypeFiltre>("all");
  const [periode, setPeriode] = useState<PeriodeFiltre>("all");
  const [creneauFiltre, setCreneauFiltre] = useState<string>("all");
  const [recherche, setRecherche] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; variant: ToastVariant } | null>(
    null,
  );

  // Dialog d'annulation : on capture la résa ciblée + les options.
  const [cancelCible, setCancelCible] = useState<ReservationAdmin | null>(null);
  const [forceCancel, setForceCancel] = useState(false);
  const [recreditCancel, setRecreditCancel] = useState(true);

  // Dialog de déplacement : la résa ciblée + le créneau choisi.
  const [moveCible, setMoveCible] = useState<ReservationAdmin | null>(null);
  const [moveTarget, setMoveTarget] = useState<string>("");

  const now = useMemo(() => maintenantIso(), []);

  // ── Filtrage (mémoïsé). ────────────────────────────────────────────────────
  const filtrees = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return reservations.filter((r) => {
      if (statut !== "all" && r.status !== statut) return false;
      if (type !== "all" && r.type !== type) return false;
      if (periode === "upcoming" && r.startsAt < now) return false;
      if (periode === "past" && r.startsAt >= now) return false;
      if (creneauFiltre !== "all" && r.creneauId !== creneauFiltre) return false;
      if (q) {
        const hay = `${r.nom} ${r.email} ${r.telephone ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [reservations, statut, type, periode, creneauFiltre, recherche, now]);

  // ── Regroupement par créneau (vue créneau), à venir uniquement. ────────────
  const parCreneau = useMemo(() => {
    const map = new Map<
      string,
      { titre: string; lieu: string | null; type: TicketType; startsAt: string; endsAt: string; inscrits: ReservationAdmin[] }
    >();
    for (const r of filtrees) {
      if (!r.creneauId) continue; // particuliers non rattachés à un créneau collectif.
      if (r.status !== "confirmed") continue; // inscrits = confirmés seulement.
      const grp = map.get(r.creneauId) ?? {
        titre: r.creneauTitre ?? "Cours",
        lieu: r.creneauLieu,
        type: r.type,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        inscrits: [],
      };
      grp.inscrits.push(r);
      map.set(r.creneauId, grp);
    }
    return [...map.entries()]
      .map(([id, grp]) => ({ id, ...grp }))
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }, [filtrees]);

  // Liste des créneaux distincts présents dans les données (pour le filtre).
  const creneauxConnus = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of reservations) {
      if (!r.creneauId) continue;
      const label = `${formatDateHeure(r.startsAt)}${r.creneauTitre ? ` — ${r.creneauTitre}` : ""}`;
      if (!map.has(r.creneauId)) map.set(r.creneauId, label);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [reservations]);

  // ── Appels API. ────────────────────────────────────────────────────────────
  async function postJson(url: string, body: unknown) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function confirmerAnnulation() {
    if (!cancelCible) return;
    const cible = cancelCible;
    setBusyId(cible.id);
    try {
      const res = await postJson("/api/admin/bookings/cancel", {
        bookingId: cible.id,
        overrideGuard: forceCancel,
        recredit: recreditCancel,
      });
      if (res.ok) {
        setReservations((list) =>
          list.map((r) =>
            r.id === cible.id
              ? { ...r, status: "cancelled", cancelledAt: now }
              : r,
          ),
        );
        setToast({ message: "Réservation annulée.", variant: "success" });
        setCancelCible(null);
        return;
      }
      if (res.status === 409) {
        setToast({
          message:
            "Séance à moins de 24h. Cochez « Forcer l'annulation » pour outrepasser.",
          variant: "error",
        });
        return;
      }
      if (res.status === 404) {
        setToast({ message: "Réservation introuvable.", variant: "error" });
        return;
      }
      setToast({ message: "L'annulation a échoué. Réessayez.", variant: "error" });
    } catch {
      setToast({ message: "Problème de connexion. Réessayez.", variant: "error" });
    } finally {
      setBusyId(null);
    }
  }

  async function confirmerDeplacement() {
    if (!moveCible || !moveTarget) return;
    const cible = moveCible;
    setBusyId(cible.id);
    try {
      const res = await postJson("/api/admin/bookings/move", {
        bookingId: cible.id,
        targetCreneauId: moveTarget,
      });
      const data = (await res.json().catch(() => null)) as
        | { booking?: { starts_at: string; ends_at: string } }
        | null;
      if (res.ok && data?.booking) {
        const b = data.booking;
        setReservations((list) =>
          list.map((r) =>
            r.id === cible.id
              ? {
                  ...r,
                  creneauId: moveTarget,
                  startsAt: b.starts_at,
                  endsAt: b.ends_at,
                  creneauTitre:
                    creneauxCibles.find((c) => c.id === moveTarget)?.summary ??
                    r.creneauTitre,
                  creneauLieu:
                    creneauxCibles.find((c) => c.id === moveTarget)?.lieu ??
                    r.creneauLieu,
                }
              : r,
          ),
        );
        setToast({ message: "Réservation déplacée.", variant: "success" });
        setMoveCible(null);
        setMoveTarget("");
        return;
      }
      if (res.status === 409) {
        setToast({
          message: "Cette cliente est déjà inscrite sur ce créneau.",
          variant: "error",
        });
        return;
      }
      if (res.status === 422) {
        setToast({
          message: "Créneau cible incompatible (type différent).",
          variant: "error",
        });
        return;
      }
      setToast({ message: "Le déplacement a échoué. Réessayez.", variant: "error" });
    } catch {
      setToast({ message: "Problème de connexion. Réessayez.", variant: "error" });
    } finally {
      setBusyId(null);
    }
  }

  async function pointerPresence(
    r: ReservationAdmin,
    attendance: ReservationAdmin["attendance"],
  ) {
    setBusyId(r.id);
    // Optimiste : on applique localement, on rollback si échec.
    const precedent = r.attendance;
    setReservations((list) =>
      list.map((x) => (x.id === r.id ? { ...x, attendance } : x)),
    );
    try {
      const res = await postJson("/api/admin/bookings/attendance", {
        bookingId: r.id,
        attendance,
      });
      if (!res.ok) {
        setReservations((list) =>
          list.map((x) => (x.id === r.id ? { ...x, attendance: precedent } : x)),
        );
        setToast({ message: "Pointage impossible. Réessayez.", variant: "error" });
      }
    } catch {
      setReservations((list) =>
        list.map((x) => (x.id === r.id ? { ...x, attendance: precedent } : x)),
      );
      setToast({ message: "Problème de connexion. Réessayez.", variant: "error" });
    } finally {
      setBusyId(null);
    }
  }

  const moveTargetCreneau = creneauxCibles.find((c) => c.id === moveTarget);

  return (
    <div className="flex flex-col gap-6">
      {/* Bascule de vue */}
      <div className="flex flex-wrap items-center gap-2">
        <VueButton active={vue === "liste"} onClick={() => setVue("liste")}>
          Liste
        </VueButton>
        <VueButton active={vue === "creneau"} onClick={() => setVue("creneau")}>
          Par créneau
        </VueButton>
      </div>

      {/* Filtres */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Champ label="Recherche client">
          <input
            type="search"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Nom, email ou téléphone"
            className="w-full rounded-[4px] border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-secondary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
          />
        </Champ>
        <Champ label="Période">
          <Select value={periode} onChange={(v) => setPeriode(v as PeriodeFiltre)}>
            <option value="all">Toutes</option>
            <option value="upcoming">À venir</option>
            <option value="past">Passées</option>
          </Select>
        </Champ>
        <Champ label="Statut">
          <Select value={statut} onChange={(v) => setStatut(v as StatutFiltre)}>
            <option value="all">Tous</option>
            <option value="confirmed">Confirmé</option>
            <option value="cancelled">Annulé</option>
          </Select>
        </Champ>
        <Champ label="Type de cours">
          <Select value={type} onChange={(v) => setType(v as TypeFiltre)}>
            <option value="all">Tous</option>
            <option value="collectif">Collectif</option>
            <option value="particulier">Particulier</option>
          </Select>
        </Champ>
        <Champ label="Créneau">
          <Select value={creneauFiltre} onChange={(v) => setCreneauFiltre(v)}>
            <option value="all">Tous</option>
            {creneauxConnus.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </Select>
        </Champ>
      </div>

      <p className="text-xs text-text-secondary">
        {filtrees.length} réservation{filtrees.length > 1 ? "s" : ""} affichée
        {filtrees.length > 1 ? "s" : ""}.
      </p>

      {vue === "liste" ? (
        <VueListe
          reservations={filtrees}
          now={now}
          busyId={busyId}
          onAnnuler={(r) => {
            setForceCancel(false);
            setRecreditCancel(true);
            setCancelCible(r);
          }}
          onDeplacer={(r) => {
            setMoveTarget("");
            setMoveCible(r);
          }}
          onPresence={pointerPresence}
        />
      ) : (
        <VueParCreneau groupes={parCreneau} />
      )}

      {/* Dialog d'annulation */}
      <ConfirmDialog
        open={cancelCible !== null}
        titre="Annuler la réservation"
        destructive
        confirmLabel="Annuler la résa"
        cancelLabel="Retour"
        pending={busyId === cancelCible?.id}
        onConfirm={confirmerAnnulation}
        onClose={() => setCancelCible(null)}
      >
        {cancelCible && (
          <div className="flex flex-col gap-3">
            <p>
              Annuler la réservation de{" "}
              <span className="text-text">{cancelCible.nom}</span> du{" "}
              <span className="text-text">{formatDateHeure(cancelCible.startsAt)}</span>{" "}
              ?
            </p>
            <label className="flex items-start gap-2 text-sm text-text">
              <input
                type="checkbox"
                checked={recreditCancel}
                onChange={(e) => setRecreditCancel(e.target.checked)}
                className="mt-0.5 accent-[var(--gold)]"
              />
              <span>
                Recréditer le ticket de la cliente (recommandé).
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-text">
              <input
                type="checkbox"
                checked={forceCancel}
                onChange={(e) => setForceCancel(e.target.checked)}
                className="mt-0.5 accent-[var(--gold)]"
              />
              <span>
                Forcer l&apos;annulation même à moins de 24h du cours.
              </span>
            </label>
          </div>
        )}
      </ConfirmDialog>

      {/* Dialog de déplacement */}
      <ConfirmDialog
        open={moveCible !== null}
        titre="Déplacer la réservation"
        confirmLabel="Déplacer"
        cancelLabel="Retour"
        pending={busyId === moveCible?.id}
        onConfirm={confirmerDeplacement}
        onClose={() => {
          setMoveCible(null);
          setMoveTarget("");
        }}
      >
        {moveCible && (
          <div className="flex flex-col gap-3">
            <p>
              Déplacer la réservation de{" "}
              <span className="text-text">{moveCible.nom}</span> (actuellement le{" "}
              <span className="text-text">{formatDateHeure(moveCible.startsAt)}</span>)
              vers :
            </p>
            <Select value={moveTarget} onChange={(v) => setMoveTarget(v)}>
              <option value="">— Choisir un créneau —</option>
              {creneauxCibles
                .filter((c) => c.type === moveCible.type && c.id !== moveCible.creneauId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {formatDateHeure(c.startsAt)}
                    {c.summary ? ` — ${c.summary}` : ""}
                  </option>
                ))}
            </Select>
            {moveTargetCreneau && (
              <p className="text-xs text-text-secondary">
                Cible : {formatDate(moveTargetCreneau.startsAt)},{" "}
                {formatPlage(moveTargetCreneau.startsAt, moveTargetCreneau.endsAt)}
                {moveTargetCreneau.lieu ? ` · ${moveTargetCreneau.lieu}` : ""}
              </p>
            )}
            {creneauxCibles.filter(
              (c) => c.type === moveCible.type && c.id !== moveCible.creneauId,
            ).length === 0 && (
              <p className="text-xs text-text-secondary">
                Aucun autre créneau {moveCible.type} à venir dans votre agenda.
              </p>
            )}
          </div>
        )}
      </ConfirmDialog>

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
// Sous-composants présentation
// ============================================================================

function VueButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-[4px] border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
        active
          ? "border-accent/60 bg-accent/10 text-accent"
          : "border-border bg-surface text-text-secondary hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}

function Champ({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-widest text-text-secondary">
        {label}
      </span>
      {children}
    </label>
  );
}

function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-[4px] border border-border bg-surface px-3 py-2 text-sm text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
    >
      {children}
    </select>
  );
}

function VueListe({
  reservations,
  now,
  busyId,
  onAnnuler,
  onDeplacer,
  onPresence,
}: {
  reservations: ReservationAdmin[];
  now: string;
  busyId: string | null;
  onAnnuler: (r: ReservationAdmin) => void;
  onDeplacer: (r: ReservationAdmin) => void;
  onPresence: (r: ReservationAdmin, a: ReservationAdmin["attendance"]) => void;
}) {
  if (reservations.length === 0) {
    return (
      <div className="rounded-[4px] border border-dashed border-border bg-surface/30 p-6 text-sm text-text-secondary">
        Aucune réservation ne correspond à ces filtres.
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {reservations.map((r) => {
        const passe = r.startsAt < now;
        const busy = busyId === r.id;
        return (
          <li
            key={r.id}
            className="rounded-[4px] border border-border bg-surface/60 p-4"
          >
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              {/* Identité + séance */}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-text">{r.nom}</span>
                  <TypeBadge type={r.type} />
                  <StatusBadge status={r.status} />
                  {r.attendance !== "pending" && (
                    <AttendanceBadge attendance={r.attendance} />
                  )}
                </div>
                <div className="mt-1 flex flex-col gap-0.5 text-xs text-text-secondary">
                  {r.email && (
                    <a
                      href={`mailto:${r.email}`}
                      className="transition-colors hover:text-accent"
                    >
                      {r.email}
                    </a>
                  )}
                  {r.telephone && (
                    <a
                      href={`tel:${r.telephone}`}
                      className="transition-colors hover:text-accent"
                    >
                      {r.telephone}
                    </a>
                  )}
                </div>
                <p className="mt-2 text-sm text-text">
                  {formatDateHeure(r.startsAt)}
                  {r.creneauLieu ? (
                    <span className="text-text-secondary"> · {r.creneauLieu}</span>
                  ) : null}
                </p>
                {r.creneauTitre && (
                  <p className="text-xs text-text-secondary">{r.creneauTitre}</p>
                )}
              </div>

              {/* Actions */}
              <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:flex-wrap lg:flex-col lg:items-end">
                {r.status === "confirmed" && (
                  <>
                    <button
                      type="button"
                      onClick={() => onAnnuler(r)}
                      disabled={busy}
                      className="inline-flex min-h-[36px] items-center justify-center rounded-[4px] border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text transition-colors hover:border-red-500/50 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    >
                      Annuler
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeplacer(r)}
                      disabled={busy || !r.creneauId}
                      title={
                        r.creneauId
                          ? undefined
                          : "Déplacement réservé aux créneaux collectifs"
                      }
                      className="inline-flex min-h-[36px] items-center justify-center rounded-[4px] border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text transition-colors hover:border-accent/60 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    >
                      Déplacer
                    </button>
                  </>
                )}
                {/* Pointage présence : pertinent sur une séance passée confirmée. */}
                {r.status === "confirmed" && passe && (
                  <div className="flex items-center gap-1.5" role="group" aria-label="Présence">
                    <PresenceBtn
                      active={r.attendance === "attended"}
                      onClick={() =>
                        onPresence(r, r.attendance === "attended" ? "pending" : "attended")
                      }
                      disabled={busy}
                      tone="ok"
                    >
                      Présent
                    </PresenceBtn>
                    <PresenceBtn
                      active={r.attendance === "no_show"}
                      onClick={() =>
                        onPresence(r, r.attendance === "no_show" ? "pending" : "no_show")
                      }
                      disabled={busy}
                      tone="ko"
                    >
                      Absent
                    </PresenceBtn>
                  </div>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function VueParCreneau({
  groupes,
}: {
  groupes: Array<{
    id: string;
    titre: string;
    lieu: string | null;
    type: TicketType;
    startsAt: string;
    endsAt: string;
    inscrits: ReservationAdmin[];
  }>;
}) {
  if (groupes.length === 0) {
    return (
      <div className="rounded-[4px] border border-dashed border-border bg-surface/30 p-6 text-sm text-text-secondary">
        Aucun créneau collectif avec des inscrits confirmés pour ces filtres.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {groupes.map((g) => (
        <article
          key={g.id}
          className="flex flex-col rounded-[4px] border border-border bg-surface/60 p-5"
        >
          <header className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-text">{formatDate(g.startsAt)}</p>
              <p className="text-sm text-text-secondary">
                {formatPlage(g.startsAt, g.endsAt)}
              </p>
              {g.lieu && <p className="text-xs text-text-secondary">{g.lieu}</p>}
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <TypeBadge type={g.type} />
              <span className="text-xs text-text-secondary">
                {g.inscrits.length} inscrit{g.inscrits.length > 1 ? "s" : ""}
              </span>
            </div>
          </header>
          {g.titre && <p className="mt-2 text-sm text-text-secondary">{g.titre}</p>}
          <ul className="mt-4 flex flex-col gap-2 border-t border-border pt-3">
            {g.inscrits.map((i) => (
              <li
                key={i.id}
                className="flex flex-col gap-0.5 text-sm sm:flex-row sm:items-baseline sm:justify-between sm:gap-3"
              >
                <span className="text-text">{i.nom}</span>
                <span className="flex flex-col gap-0.5 text-xs text-text-secondary sm:flex-row sm:items-baseline sm:gap-3">
                  {i.email && (
                    <a href={`mailto:${i.email}`} className="hover:text-accent">
                      {i.email}
                    </a>
                  )}
                  {i.telephone && (
                    <a href={`tel:${i.telephone}`} className="hover:text-accent">
                      {i.telephone}
                    </a>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  );
}

function AttendanceBadge({
  attendance,
}: {
  attendance: ReservationAdmin["attendance"];
}) {
  const ok = attendance === "attended";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[4px] border px-2 py-0.5 text-[11px] uppercase tracking-wide ${
        ok ? "border-accent/40 text-accent" : "border-border text-text-secondary"
      }`}
    >
      {ATTENDANCE_LABEL[attendance]}
    </span>
  );
}

function PresenceBtn({
  active,
  onClick,
  disabled,
  tone,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled: boolean;
  tone: "ok" | "ko";
  children: React.ReactNode;
}) {
  const toneActive =
    tone === "ok"
      ? "border-accent/60 bg-accent/10 text-accent"
      : "border-red-500/50 bg-red-500/10 text-red-300";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`inline-flex min-h-[36px] items-center justify-center rounded-[4px] border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
        active ? toneActive : "border-border bg-surface text-text-secondary hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}
