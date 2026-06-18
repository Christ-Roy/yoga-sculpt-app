"use client";

import { useState, useTransition } from "react";

/**
 * Formulaire d'invitation d'un ami au parrainage.
 *
 * Valide l'email côté client (format + longueur), POST
 * `POST /api/parrainage/inviter` body `{ email }` → 200 `{ ok:true }`.
 * Gère les états loading / succès / erreur ; remonte le succès au parent
 * (`onInvite`) pour qu'il rafraîchisse la liste des filleuls + affiche un toast.
 *
 * Charte NOIR & OR, bouton ≥44px, mobile-first (champ + bouton empilés sur
 * mobile, en ligne dès `sm`).
 */

/** Regex email pragmatique (RFC simplifiée, suffisante côté client). */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function InviteAmiForm({
  onInvite,
}: {
  /** Appelé après une invitation acceptée (200), avec l'email invité. */
  onInvite?: (email: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function soumettre(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);
    setSucces(null);

    const valeur = email.trim().toLowerCase();
    if (!valeur) {
      setErreur("Indiquez l'adresse e-mail de votre ami.");
      return;
    }
    if (valeur.length > 254 || !EMAIL_RE.test(valeur)) {
      setErreur("Cette adresse e-mail ne semble pas valide.");
      return;
    }

    startTransition(async () => {
      try {
        const res = await fetch("/api/parrainage/inviter", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: valeur }),
        });

        if (res.ok) {
          setSucces(`Invitation envoyée à ${valeur}.`);
          setEmail("");
          onInvite?.(valeur);
          return;
        }

        // Tente de lire un message d'erreur serveur ; fallback générique.
        let message = "L'invitation n'a pas pu être envoyée. Réessayez.";
        try {
          const data = (await res.json()) as { error?: string };
          if (res.status === 409) {
            message = "Cet ami a déjà été invité.";
          } else if (res.status === 400 && data.error) {
            message = data.error;
          }
        } catch {
          /* corps non-JSON → message générique */
        }
        setErreur(message);
      } catch {
        setErreur("Problème de connexion. Réessayez.");
      }
    });
  }

  return (
    <form onSubmit={soumettre} className="flex flex-col gap-3" noValidate>
      <label htmlFor="invite-email" className="sr-only">
        E-mail de votre ami
      </label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          id="invite-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (erreur) setErreur(null);
          }}
          placeholder="ami@exemple.com"
          maxLength={254}
          disabled={pending}
          aria-invalid={erreur ? true : undefined}
          aria-describedby={erreur ? "invite-email-error" : undefined}
          className="min-h-[44px] flex-1 rounded-[4px] border border-border bg-surface px-3 py-2.5 text-sm text-text placeholder:text-text-secondary/60 transition-colors focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-red-500"
        />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-[44px] items-center justify-center rounded-[4px] bg-accent px-5 py-2.5 text-sm font-medium text-[#0e0e0e] transition-colors hover:bg-accent-dark disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {pending ? "Envoi…" : "Inviter"}
        </button>
      </div>

      {erreur && (
        <p id="invite-email-error" className="text-sm text-red-400" role="alert">
          {erreur}
        </p>
      )}
      {succes && (
        <p className="text-sm text-accent" role="status">
          {succes}
        </p>
      )}
    </form>
  );
}
