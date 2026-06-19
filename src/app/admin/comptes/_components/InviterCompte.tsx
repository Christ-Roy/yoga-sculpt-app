"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Bloc « Inviter un membre » (client) en tête de la liste des comptes.
 * Pré-crée un compte côté GoTrue et déclenche l'e-mail d'invitation Supabase
 * (route serveur `/api/admin/users/inviter`, gardée `requireAdmin`).
 */
export function InviterCompte() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [enCours, setEnCours] = useState(false);
  const [email, setEmail] = useState("");
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(
    null,
  );

  async function inviter() {
    const valeur = email.trim();
    if (!valeur) return;
    setFeedback(null);
    setEnCours(true);
    try {
      const res = await fetch("/api/admin/users/inviter", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: valeur }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      if (!res.ok) {
        setFeedback({ ok: false, message: data.error ?? "Invitation échouée." });
        return;
      }
      setFeedback({ ok: true, message: data.message ?? "Invitation envoyée." });
      setEmail("");
      startTransition(() => router.refresh());
    } catch {
      setFeedback({ ok: false, message: "Erreur réseau. Réessayez." });
    } finally {
      setEnCours(false);
    }
  }

  return (
    <section
      aria-label="Inviter un membre"
      className="flex flex-col gap-3 rounded-[4px] border border-border bg-surface/60 p-4"
    >
      <h2 className="text-sm font-medium text-text">Inviter un membre</h2>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex w-full flex-col gap-1 text-xs text-text-secondary sm:w-auto sm:flex-1">
          E-mail
          <Input
            type="email"
            placeholder="prenom@exemple.fr"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="off"
          />
        </label>
        <Button
          type="button"
          disabled={pending || enCours || !email.trim()}
          loading={enCours}
          onClick={inviter}
        >
          Inviter
        </Button>
      </div>
      {feedback ? (
        <p
          role="status"
          className={`text-xs ${feedback.ok ? "text-accent" : "text-red-400"}`}
        >
          {feedback.message}
        </p>
      ) : null}
    </section>
  );
}
