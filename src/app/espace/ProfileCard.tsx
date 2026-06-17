"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/Button";
import { updateProfile, type ProfileState } from "./actions";

const initial: ProfileState = {};

export function ProfileCard({
  email,
  fullName,
  phone,
  goal,
  level,
}: {
  email: string;
  fullName: string | null;
  phone: string | null;
  goal: string | null;
  level: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState(updateProfile, initial);

  // Referme le formulaire après une sauvegarde réussie, sans useEffect :
  // pattern React officiel "adjust state during render" — on compare le
  // résultat précédent au courant et on ajuste l'état pendant le rendu.
  // (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes)
  const [prevOk, setPrevOk] = useState<boolean | undefined>(undefined);
  if (state.ok !== prevOk) {
    setPrevOk(state.ok);
    if (state.ok && editing) {
      setEditing(false);
    }
  }

  return (
    <section className="rounded-[4px] border border-border bg-surface/60 p-6">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="font-display text-xl text-text">Mon profil</h2>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-sm text-accent transition-colors hover:text-accent-dark"
          >
            Modifier
          </button>
        )}
      </div>

      {editing ? (
        <form action={formAction} className="flex flex-col gap-4">
          <Field label="Nom complet">
            <input
              name="full_name"
              defaultValue={fullName ?? ""}
              placeholder="Votre nom"
              maxLength={120}
              className="w-full rounded-[4px] border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-secondary/60 focus:border-accent focus:outline-none"
            />
          </Field>
          <Field label="Téléphone">
            <input
              name="phone"
              type="tel"
              defaultValue={phone ?? ""}
              placeholder="06 12 34 56 78"
              maxLength={30}
              className="w-full rounded-[4px] border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-secondary/60 focus:border-accent focus:outline-none"
            />
          </Field>

          {state.error && (
            <p className="text-sm text-red-400" role="alert">
              {state.error}
            </p>
          )}

          <div className="flex gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? "Enregistrement…" : "Enregistrer"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setEditing(false)}
              disabled={pending}
            >
              Annuler
            </Button>
          </div>
        </form>
      ) : (
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Row label="Nom" value={fullName || "—"} />
          <Row label="E-mail" value={email} />
          <Row label="Téléphone" value={phone || "—"} />
          <Row label="Objectif" value={goal || "—"} />
          <Row label="Niveau" value={level || "—"} />
        </dl>
      )}

      {state.ok && !editing && (
        <p className="mt-4 text-sm text-accent">Profil mis à jour.</p>
      )}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs uppercase tracking-widest text-text-secondary">
        {label}
      </span>
      {children}
    </label>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-widest text-text-secondary">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-text">{value}</dd>
    </div>
  );
}
