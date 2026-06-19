"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { CalendarPlus, Pencil, Trash2, Repeat, Ban, X } from "lucide-react";
import { useToast, type ToastVariant } from "@/components/ui/toast";
import { TypeBadge } from "@/components/admin/TypeBadge";
import { formatDate, formatPlage } from "@/lib/admin-format";
import type { TicketType } from "@/lib/db-types";
import type { SlotPreset } from "@/app/api/admin/creneaux/data";
import type { CreneauAdmin } from "./page";

/**
 * UI cliente de la page « Calendrier » admin.
 *
 * Pilote les routes `/api/admin/creneaux` (CRUD créneaux), `.../presets`
 * (CRUD modèles), `.../apply` (appliquer un modèle, avec récurrence hebdo) et
 * `.../block` (bloquer une journée). Charte NOIR & OR, responsive, A11y de base
 * (labels, aria, focus-visible). Optimiste léger : on recharge l'état depuis les
 * routes après chaque écriture (source de vérité = Google Agenda + DB).
 */

const baseInput =
  "w-full rounded-[4px] border border-border bg-surface px-3 py-2 text-sm text-text outline-none transition-colors focus:border-accent/70 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";
const baseLabel = "mb-1 block text-xs font-medium uppercase tracking-wide text-text-secondary";
const btnPrimary =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-[4px] bg-accent px-4 py-2.5 text-sm font-medium text-[#0e0e0e] transition-colors hover:bg-accent-dark disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const btnGhost =
  "inline-flex min-h-[40px] items-center justify-center gap-2 rounded-[4px] border border-border bg-surface px-3 py-2 text-sm text-text transition-colors hover:border-accent/50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const btnDanger =
  "inline-flex min-h-[40px] items-center justify-center gap-2 rounded-[4px] border border-red-500/40 bg-surface px-3 py-2 text-sm text-red-300 transition-colors hover:border-red-500/70 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500";

/** Lit `{ error }` d'une réponse non-ok, avec fallback. */
async function lireErreur(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    return data.error ?? fallback;
  } catch {
    return fallback;
  }
}

export function CalendrierClient({
  creneauxInitiaux,
  presetsInitiaux,
}: {
  creneauxInitiaux: CreneauAdmin[];
  presetsInitiaux: SlotPreset[];
}) {
  const [creneaux, setCreneaux] = useState<CreneauAdmin[]>(creneauxInitiaux);
  const [presets, setPresets] = useState<SlotPreset[]>(presetsInitiaux);
  const [pending, startTransition] = useTransition();
  const { toast: notify } = useToast();

  // ── Rechargements depuis les routes (source de vérité) ─────────────────────
  const rechargerCreneaux = useCallback(async () => {
    const res = await fetch("/api/admin/creneaux", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { creneaux: CreneauAdmin[] };
    // La route GET renvoie `inscrits` sur chaque créneau (cf route.ts).
    setCreneaux(
      (data.creneaux ?? []).map((c) => ({ ...c, inscrits: c.inscrits ?? 0 })),
    );
  }, []);

  const rechargerPresets = useCallback(async () => {
    const res = await fetch("/api/admin/creneaux/presets", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { presets: SlotPreset[] };
    setPresets(data.presets ?? []);
  }, []);

  return (
    <div className="flex flex-col gap-12">
      <CreerCreneau notify={notify} onCreated={rechargerCreneaux} pending={pending} startTransition={startTransition} />

      <PresetsSection
        presets={presets}
        notify={notify}
        onPresetsChanged={rechargerPresets}
        onCreneauxChanged={rechargerCreneaux}
        pending={pending}
        startTransition={startTransition}
      />

      <CreneauxSection
        creneaux={creneaux}
        notify={notify}
        onChanged={rechargerCreneaux}
        pending={pending}
        startTransition={startTransition}
      />

      <BloquerJour notify={notify} pending={pending} startTransition={startTransition} />
    </div>
  );
}

// ============================================================================
// Section : créer un créneau ponctuel
// ============================================================================
type Notify = (m: string, v?: ToastVariant) => void;
type Start = (cb: () => void) => void;

function CreerCreneau({
  notify,
  onCreated,
  pending,
  startTransition,
}: {
  notify: Notify;
  onCreated: () => Promise<void>;
  pending: boolean;
  startTransition: Start;
}) {
  const [type, setType] = useState<TicketType>("collectif");
  const [date, setDate] = useState("");
  const [heureDebut, setHeureDebut] = useState("18:00");
  const [heureFin, setHeureFin] = useState("19:00");
  const [lieu, setLieu] = useState("Parc de la Tête d'Or");
  const [capacite, setCapacite] = useState("8");

  function soumettre(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const body: Record<string, unknown> = { type, date, heureDebut, heureFin, lieu };
      if (type === "collectif" && capacite) body.capacite = Number(capacite);
      const res = await fetch("/api/admin/creneaux", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        notify(await lireErreur(res, "Création impossible."), "error");
        return;
      }
      notify("Créneau créé dans votre agenda.");
      setDate("");
      await onCreated();
    });
  }

  return (
    <section aria-labelledby="creer-titre" className="rounded-[4px] border border-border bg-surface/60 p-6">
      <h2 id="creer-titre" className="flex items-center gap-2 font-display text-xl text-text">
        <CalendarPlus className="h-5 w-5 text-accent" aria-hidden /> Nouveau créneau
      </h2>
      <form onSubmit={soumettre} className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label htmlFor="cc-type" className={baseLabel}>Type</label>
          <select id="cc-type" className={baseInput} value={type} onChange={(e) => setType(e.target.value as TicketType)}>
            <option value="collectif">Cours collectif</option>
            <option value="particulier">Cours particulier</option>
          </select>
        </div>
        <div>
          <label htmlFor="cc-date" className={baseLabel}>Date</label>
          <input id="cc-date" type="date" required className={baseInput} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="cc-debut" className={baseLabel}>Début</label>
            <input id="cc-debut" type="time" required className={baseInput} value={heureDebut} onChange={(e) => setHeureDebut(e.target.value)} />
          </div>
          <div>
            <label htmlFor="cc-fin" className={baseLabel}>Fin</label>
            <input id="cc-fin" type="time" required className={baseInput} value={heureFin} onChange={(e) => setHeureFin(e.target.value)} />
          </div>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="cc-lieu" className={baseLabel}>Lieu</label>
          <input id="cc-lieu" type="text" required className={baseInput} value={lieu} onChange={(e) => setLieu(e.target.value)} placeholder="Parc de la Tête d'Or" />
        </div>
        {type === "collectif" && (
          <div>
            <label htmlFor="cc-cap" className={baseLabel}>Capacité (places)</label>
            <input id="cc-cap" type="number" min={1} max={100} className={baseInput} value={capacite} onChange={(e) => setCapacite(e.target.value)} />
          </div>
        )}
        <div className="flex items-end sm:col-span-2 lg:col-span-3">
          <button type="submit" className={btnPrimary} disabled={pending}>
            {pending ? "Un instant…" : "Créer le créneau"}
          </button>
        </div>
      </form>
    </section>
  );
}

// ============================================================================
// Section : presets (modèles)
// ============================================================================
function PresetsSection({
  presets,
  notify,
  onPresetsChanged,
  onCreneauxChanged,
  pending,
  startTransition,
}: {
  presets: SlotPreset[];
  notify: Notify;
  onPresetsChanged: () => Promise<void>;
  onCreneauxChanged: () => Promise<void>;
  pending: boolean;
  startTransition: Start;
}) {
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const editing = useMemo(
    () => presets.find((p) => p.id === editId) ?? null,
    [presets, editId],
  );

  return (
    <section aria-labelledby="presets-titre" className="rounded-[4px] border border-border bg-surface/60 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="presets-titre" className="flex items-center gap-2 font-display text-xl text-text">
            <Repeat className="h-5 w-5 text-accent" aria-hidden /> Modèles de créneaux
          </h2>
          <p className="mt-1 text-xs text-text-secondary">
            Créez un modèle réutilisable puis appliquez-le à une date en un clic
            (avec récurrence hebdomadaire optionnelle).
          </p>
        </div>
        <button
          type="button"
          className={btnGhost}
          onClick={() => { setEditId(null); setShowForm((v) => !v); }}
        >
          {showForm ? "Fermer" : "Nouveau modèle"}
        </button>
      </div>

      {(showForm || editing) && (
        <PresetForm
          key={editing?.id ?? "new"}
          preset={editing}
          notify={notify}
          pending={pending}
          startTransition={startTransition}
          onDone={async () => { setShowForm(false); setEditId(null); await onPresetsChanged(); }}
          onCancel={() => { setShowForm(false); setEditId(null); }}
        />
      )}

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {presets.length === 0 ? (
          <p className="rounded-[4px] border border-dashed border-border bg-surface/30 p-5 text-sm text-text-secondary lg:col-span-2">
            Aucun modèle pour l&apos;instant. Créez-en un pour gagner du temps.
          </p>
        ) : (
          presets.map((p) => (
            <PresetCard
              key={p.id}
              preset={p}
              notify={notify}
              pending={pending}
              startTransition={startTransition}
              onEdit={() => { setShowForm(false); setEditId(p.id); }}
              onDeleted={onPresetsChanged}
              onApplied={onCreneauxChanged}
            />
          ))
        )}
      </div>
    </section>
  );
}

function PresetForm({
  preset,
  notify,
  pending,
  startTransition,
  onDone,
  onCancel,
}: {
  preset: SlotPreset | null;
  notify: Notify;
  pending: boolean;
  startTransition: Start;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(preset?.label ?? "");
  const [type, setType] = useState<TicketType>(preset?.type ?? "collectif");
  const [dureeMin, setDureeMin] = useState(String(preset?.dureeMin ?? 60));
  const [heureDebut, setHeureDebut] = useState(preset?.heureDebut ?? "18:00");
  const [lieu, setLieu] = useState(preset?.lieu ?? "Parc de la Tête d'Or");
  const [capacite, setCapacite] = useState(
    preset?.capacite != null ? String(preset.capacite) : "8",
  );

  function soumettre(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const payload: Record<string, unknown> = {
        label,
        type,
        dureeMin: Number(dureeMin),
        heureDebut,
        lieu,
        capacite: type === "collectif" && capacite ? Number(capacite) : null,
      };
      const isEdit = Boolean(preset);
      const res = await fetch("/api/admin/creneaux/presets", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isEdit ? { id: preset!.id, ...payload } : payload),
      });
      if (!res.ok) {
        notify(await lireErreur(res, "Enregistrement impossible."), "error");
        return;
      }
      notify(isEdit ? "Modèle mis à jour." : "Modèle créé.");
      await onDone();
    });
  }

  return (
    <form onSubmit={soumettre} className="mt-5 grid grid-cols-1 gap-4 rounded-[4px] border border-accent/30 bg-accent/5 p-5 sm:grid-cols-2 lg:grid-cols-3">
      <div className="sm:col-span-2 lg:col-span-3">
        <label htmlFor="pf-label" className={baseLabel}>Libellé</label>
        <input id="pf-label" type="text" required maxLength={120} className={baseInput} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Collectif vendredi 18h · Tête d'Or" />
      </div>
      <div>
        <label htmlFor="pf-type" className={baseLabel}>Type</label>
        <select id="pf-type" className={baseInput} value={type} onChange={(e) => setType(e.target.value as TicketType)}>
          <option value="collectif">Cours collectif</option>
          <option value="particulier">Cours particulier</option>
        </select>
      </div>
      <div>
        <label htmlFor="pf-debut" className={baseLabel}>Heure de début</label>
        <input id="pf-debut" type="time" required className={baseInput} value={heureDebut} onChange={(e) => setHeureDebut(e.target.value)} />
      </div>
      <div>
        <label htmlFor="pf-duree" className={baseLabel}>Durée (min)</label>
        <input id="pf-duree" type="number" min={1} max={600} required className={baseInput} value={dureeMin} onChange={(e) => setDureeMin(e.target.value)} />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="pf-lieu" className={baseLabel}>Lieu</label>
        <input id="pf-lieu" type="text" required className={baseInput} value={lieu} onChange={(e) => setLieu(e.target.value)} />
      </div>
      {type === "collectif" && (
        <div>
          <label htmlFor="pf-cap" className={baseLabel}>Capacité</label>
          <input id="pf-cap" type="number" min={1} max={100} className={baseInput} value={capacite} onChange={(e) => setCapacite(e.target.value)} />
        </div>
      )}
      <div className="flex items-end gap-3 sm:col-span-2 lg:col-span-3">
        <button type="submit" className={btnPrimary} disabled={pending}>
          {pending ? "Un instant…" : preset ? "Enregistrer" : "Créer le modèle"}
        </button>
        <button type="button" className={btnGhost} onClick={onCancel} disabled={pending}>
          Annuler
        </button>
      </div>
    </form>
  );
}

function PresetCard({
  preset,
  notify,
  pending,
  startTransition,
  onEdit,
  onDeleted,
  onApplied,
}: {
  preset: SlotPreset;
  notify: Notify;
  pending: boolean;
  startTransition: Start;
  onEdit: () => void;
  onDeleted: () => Promise<void>;
  onApplied: () => Promise<void>;
}) {
  const [showApply, setShowApply] = useState(false);
  const [date, setDate] = useState("");
  const [recurrent, setRecurrent] = useState(false);
  const [occurrences, setOccurrences] = useState("8");

  function appliquer(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const body: Record<string, unknown> = { presetId: preset.id, date };
      if (recurrent) {
        body.recurrence = { frequence: "hebdomadaire", occurrences: Number(occurrences) };
      }
      const res = await fetch("/api/admin/creneaux/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        notify(await lireErreur(res, "Application impossible."), "error");
        return;
      }
      const data = (await res.json()) as { crees: number; echecs: number };
      notify(
        data.echecs > 0
          ? `${data.crees} créneau(x) créé(s), ${data.echecs} échec(s).`
          : `${data.crees} créneau(x) ajouté(s) à l'agenda.`,
        data.echecs > 0 ? "error" : "success",
      );
      setShowApply(false);
      setDate("");
      await onApplied();
    });
  }

  function supprimer() {
    if (!confirm(`Supprimer le modèle « ${preset.label} » ?`)) return;
    startTransition(async () => {
      const res = await fetch(`/api/admin/creneaux/presets?id=${encodeURIComponent(preset.id)}`, { method: "DELETE" });
      if (!res.ok) {
        notify(await lireErreur(res, "Suppression impossible."), "error");
        return;
      }
      notify("Modèle supprimé.");
      await onDeleted();
    });
  }

  return (
    <article className="flex flex-col rounded-[4px] border border-border bg-surface/60 p-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-text">{preset.label}</p>
          <p className="mt-0.5 text-xs text-text-secondary">
            {preset.heureDebut} · {preset.dureeMin} min · {preset.lieu}
            {preset.type === "collectif" && preset.capacite ? ` · ${preset.capacite} places` : ""}
          </p>
        </div>
        <TypeBadge type={preset.type} />
      </header>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className={btnPrimary} onClick={() => setShowApply((v) => !v)} disabled={pending}>
          <CalendarPlus className="h-4 w-4" aria-hidden /> Appliquer
        </button>
        <button type="button" className={btnGhost} onClick={onEdit} disabled={pending} aria-label={`Éditer ${preset.label}`}>
          <Pencil className="h-4 w-4" aria-hidden /> Éditer
        </button>
        <button type="button" className={btnDanger} onClick={supprimer} disabled={pending} aria-label={`Supprimer ${preset.label}`}>
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {showApply && (
        <form onSubmit={appliquer} className="mt-4 flex flex-col gap-3 border-t border-border pt-4">
          <div>
            <label htmlFor={`ap-date-${preset.id}`} className={baseLabel}>Date (1re occurrence)</label>
            <input id={`ap-date-${preset.id}`} type="date" required className={baseInput} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm text-text">
            <input type="checkbox" checked={recurrent} onChange={(e) => setRecurrent(e.target.checked)} className="accent-accent" />
            Répéter chaque semaine
          </label>
          {recurrent && (
            <div>
              <label htmlFor={`ap-occ-${preset.id}`} className={baseLabel}>Nombre de semaines</label>
              <input id={`ap-occ-${preset.id}`} type="number" min={1} max={52} className={baseInput} value={occurrences} onChange={(e) => setOccurrences(e.target.value)} />
            </div>
          )}
          <button type="submit" className={btnPrimary} disabled={pending}>
            {pending ? "Un instant…" : "Confirmer"}
          </button>
        </form>
      )}
    </article>
  );
}

// ============================================================================
// Section : créneaux à venir (édition / suppression)
// ============================================================================
function CreneauxSection({
  creneaux,
  notify,
  onChanged,
  pending,
  startTransition,
}: {
  creneaux: CreneauAdmin[];
  notify: Notify;
  onChanged: () => Promise<void>;
  pending: boolean;
  startTransition: Start;
}) {
  const [editId, setEditId] = useState<string | null>(null);

  function supprimer(c: CreneauAdmin) {
    const msg =
      c.inscrits > 0
        ? `Ce créneau a ${c.inscrits} réservation(s). Le supprimer quand même ?`
        : "Supprimer ce créneau ?";
    if (!confirm(msg)) return;
    startTransition(async () => {
      const force = c.inscrits > 0 ? "&force=1" : "";
      const res = await fetch(`/api/admin/creneaux?eventId=${encodeURIComponent(c.id)}${force}`, { method: "DELETE" });
      if (!res.ok) {
        notify(await lireErreur(res, "Suppression impossible."), "error");
        return;
      }
      notify("Créneau supprimé.");
      await onChanged();
    });
  }

  return (
    <section id="creneaux" aria-labelledby="liste-titre" className="scroll-mt-20">
      <h2 id="liste-titre" className="font-display text-xl text-text">Créneaux à venir</h2>
      <p className="mt-1 text-xs text-text-secondary">
        Tirés de votre Google Agenda. Modifiez ou supprimez un créneau ci-dessous.
      </p>

      {creneaux.length === 0 ? (
        <p className="mt-4 rounded-[4px] border border-dashed border-border bg-surface/30 p-5 text-sm text-text-secondary">
          Aucun créneau à venir (ou agenda indisponible pour le moment).
        </p>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {creneaux.map((c) => (
            <article key={c.id} className="flex flex-col rounded-[4px] border border-border bg-surface/60 p-5">
              <header className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-text">{formatDate(c.starts_at)}</p>
                  <p className="text-sm text-text-secondary">{formatPlage(c.starts_at, c.ends_at)}</p>
                  <p className="mt-1 text-xs text-text-secondary">
                    {c.lieu ?? "Lieu à confirmer"}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <TypeBadge type={c.type} />
                  <span className="text-xs text-text-secondary">
                    {c.inscrits} inscrit{c.inscrits > 1 ? "s" : ""}
                  </span>
                </div>
              </header>

              <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3">
                <button type="button" className={btnGhost} onClick={() => setEditId(editId === c.id ? null : c.id)} disabled={pending}>
                  <Pencil className="h-4 w-4" aria-hidden /> {editId === c.id ? "Fermer" : "Éditer"}
                </button>
                <button type="button" className={btnDanger} onClick={() => supprimer(c)} disabled={pending}>
                  <Trash2 className="h-4 w-4" aria-hidden /> Supprimer
                </button>
              </div>

              {editId === c.id && (
                <EditCreneauForm
                  creneau={c}
                  notify={notify}
                  pending={pending}
                  startTransition={startTransition}
                  onDone={async () => { setEditId(null); await onChanged(); }}
                />
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

/** Extrait « YYYY-MM-DD » et « HH:MM » (heure de Paris) d'un ISO pour pré-remplir. */
function decomposerParis(iso: string): { date: string; heure: string } {
  const d = new Date(iso);
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  const hm = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return { date: ymd, heure: hm };
}

function EditCreneauForm({
  creneau,
  notify,
  pending,
  startTransition,
  onDone,
}: {
  creneau: CreneauAdmin;
  notify: Notify;
  pending: boolean;
  startTransition: Start;
  onDone: () => Promise<void>;
}) {
  const debut = decomposerParis(creneau.starts_at);
  const fin = decomposerParis(creneau.ends_at);
  const [type, setType] = useState<TicketType>(creneau.type);
  const [date, setDate] = useState(debut.date);
  const [heureDebut, setHeureDebut] = useState(debut.heure);
  const [heureFin, setHeureFin] = useState(fin.heure);
  const [lieu, setLieu] = useState(creneau.lieu ?? "");

  function soumettre(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const body: Record<string, unknown> = {
        eventId: creneau.id,
        type,
        date,
        heureDebut,
        heureFin,
        lieu,
      };
      const res = await fetch("/api/admin/creneaux", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        notify(await lireErreur(res, "Édition impossible."), "error");
        return;
      }
      notify("Créneau mis à jour.");
      await onDone();
    });
  }

  return (
    <form onSubmit={soumettre} className="mt-4 grid grid-cols-1 gap-3 border-t border-border pt-4 sm:grid-cols-2">
      <div>
        <label htmlFor={`ec-type-${creneau.id}`} className={baseLabel}>Type</label>
        <select id={`ec-type-${creneau.id}`} className={baseInput} value={type} onChange={(e) => setType(e.target.value as TicketType)}>
          <option value="collectif">Collectif</option>
          <option value="particulier">Particulier</option>
        </select>
      </div>
      <div>
        <label htmlFor={`ec-date-${creneau.id}`} className={baseLabel}>Date</label>
        <input id={`ec-date-${creneau.id}`} type="date" required className={baseInput} value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div>
        <label htmlFor={`ec-debut-${creneau.id}`} className={baseLabel}>Début</label>
        <input id={`ec-debut-${creneau.id}`} type="time" required className={baseInput} value={heureDebut} onChange={(e) => setHeureDebut(e.target.value)} />
      </div>
      <div>
        <label htmlFor={`ec-fin-${creneau.id}`} className={baseLabel}>Fin</label>
        <input id={`ec-fin-${creneau.id}`} type="time" required className={baseInput} value={heureFin} onChange={(e) => setHeureFin(e.target.value)} />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor={`ec-lieu-${creneau.id}`} className={baseLabel}>Lieu</label>
        <input id={`ec-lieu-${creneau.id}`} type="text" required className={baseInput} value={lieu} onChange={(e) => setLieu(e.target.value)} />
      </div>
      <div className="sm:col-span-2">
        <button type="submit" className={btnPrimary} disabled={pending}>
          {pending ? "Un instant…" : "Enregistrer"}
        </button>
      </div>
    </form>
  );
}

// ============================================================================
// Section : bloquer une journée
// ============================================================================
function BloquerJour({
  notify,
  pending,
  startTransition,
}: {
  notify: Notify;
  pending: boolean;
  startTransition: Start;
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [motif, setMotif] = useState("");

  function soumettre(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const body: Record<string, unknown> = { date };
      if (motif) body.motif = motif;
      const res = await fetch("/api/admin/creneaux/block", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        notify(await lireErreur(res, "Blocage impossible."), "error");
        return;
      }
      notify("Journée bloquée dans votre agenda.");
      setDate("");
      setMotif("");
      setOpen(false);
    });
  }

  return (
    <section aria-labelledby="block-titre" className="rounded-[4px] border border-border bg-surface/60 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="block-titre" className="flex items-center gap-2 font-display text-xl text-text">
          <Ban className="h-5 w-5 text-accent" aria-hidden /> Bloquer une journée
        </h2>
        <button type="button" className={btnGhost} onClick={() => setOpen((v) => !v)}>
          {open ? <><X className="h-4 w-4" aria-hidden /> Fermer</> : "Ajouter un jour off"}
        </button>
      </div>
      {open && (
        <form onSubmit={soumettre} className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="bj-date" className={baseLabel}>Date</label>
            <input id="bj-date" type="date" required className={baseInput} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="bj-motif" className={baseLabel}>Motif (optionnel)</label>
            <input id="bj-motif" type="text" maxLength={200} className={baseInput} value={motif} onChange={(e) => setMotif(e.target.value)} placeholder="Congés, formation…" />
          </div>
          <div className="sm:col-span-3">
            <button type="submit" className={btnPrimary} disabled={pending}>
              {pending ? "Un instant…" : "Bloquer cette journée"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
