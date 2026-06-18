"use client";

import { useState } from "react";
import { ParrainageCard } from "@/components/ParrainageCard";
import { InviteAmiForm } from "@/components/InviteAmiForm";
import { Toast, type ToastVariant } from "@/components/Toast";

/**
 * Orchestrateur client de la page parrainage.
 *
 * Reçoit du Server Component le lien/code de parrainage et la liste initiale
 * des filleuls. Gère localement :
 *   - l'ajout optimiste d'un filleul « en attente » après une invitation 200 ;
 *   - le toast de confirmation ;
 *   - le rafraîchissement de la liste depuis `GET /api/parrainage` (pour
 *     refléter un éventuel passage « inscrit ✓ » côté serveur).
 *
 * Mobile-first : cartes empilées, pleine largeur. La liste est triée
 * « en attente » d'abord puis par date décroissante.
 */

export interface Filleul {
  email: string;
  status: "pending" | "completed";
  created_at: string;
}

export function ParrainerClient({
  code,
  lienParrainage,
  filleulsInitiaux,
}: {
  code: string;
  lienParrainage: string;
  filleulsInitiaux: Filleul[];
}) {
  const [filleuls, setFilleuls] = useState<Filleul[]>(filleulsInitiaux);
  const [toast, setToast] = useState<{
    message: string;
    variant: ToastVariant;
  } | null>(null);

  /** Après une invitation acceptée : ajout optimiste + resync serveur. */
  function onInvite(email: string) {
    setToast({
      message: `Invitation envoyée à ${email}.`,
      variant: "success",
    });

    // Ajout optimiste (sans doublon) en tête de liste, statut « en attente ».
    setFilleuls((liste) => {
      if (liste.some((f) => f.email.toLowerCase() === email.toLowerCase())) {
        return liste;
      }
      return [
        { email, status: "pending", created_at: new Date().toISOString() },
        ...liste,
      ];
    });

    // Resync best-effort : remplace par l'état serveur si disponible.
    void rafraichir();
  }

  /** Recharge la liste des filleuls depuis l'API (échec silencieux). */
  async function rafraichir() {
    try {
      const res = await fetch("/api/parrainage", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { filleuls?: Filleul[] };
      if (Array.isArray(data.filleuls)) {
        setFilleuls(data.filleuls);
      }
    } catch {
      /* on garde l'état optimiste */
    }
  }

  const tries = [...filleuls].sort((a, b) => {
    // « en attente » avant « inscrit », puis plus récent d'abord.
    if (a.status !== b.status) return a.status === "pending" ? -1 : 1;
    return b.created_at.localeCompare(a.created_at);
  });

  const nbInscrits = filleuls.filter((f) => f.status === "completed").length;

  return (
    <div className="flex flex-col gap-6">
      <ParrainageCard lienParrainage={lienParrainage} code={code} />

      {/* Inviter par e-mail */}
      <section
        className="rounded-[4px] border border-border bg-surface/60 p-6"
        aria-labelledby="inviter-title"
      >
        <h2 id="inviter-title" className="font-display text-xl text-text">
          Inviter par e-mail
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-text-secondary">
          Nous enverrons à votre ami une invitation avec votre lien.
        </p>
        <div className="mt-4">
          <InviteAmiForm onInvite={onInvite} />
        </div>
      </section>

      {/* Liste des filleuls */}
      <section aria-labelledby="filleuls-title">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="filleuls-title" className="font-display text-xl text-text">
            Vos invitations
          </h2>
          {nbInscrits > 0 && (
            <span className="text-sm text-text-secondary">
              <span className="font-semibold text-accent">{nbInscrits}</span>{" "}
              ami{nbInscrits > 1 ? "s" : ""} inscrit
              {nbInscrits > 1 ? "s" : ""}
            </span>
          )}
        </div>

        {tries.length === 0 ? (
          <div className="rounded-[4px] border border-border bg-surface/60 p-8 text-center">
            <p className="text-sm leading-relaxed text-text-secondary">
              Vous n&apos;avez encore invité personne. Partagez votre lien
              ci-dessus pour offrir une première séance.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {tries.map((f) => (
              <li key={`${f.email}-${f.created_at}`}>
                <FilleulRow filleul={f} />
              </li>
            ))}
          </ul>
        )}
      </section>

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

function FilleulRow({ filleul }: { filleul: Filleul }) {
  const inscrit = filleul.status === "completed";
  return (
    <div className="flex items-center justify-between gap-3 rounded-[4px] border border-border bg-surface/60 px-4 py-3">
      <span className="min-w-0 truncate text-sm text-text">{filleul.email}</span>
      {inscrit ? (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-accent/60 bg-accent/10 px-2.5 py-0.5 text-xs uppercase tracking-wider text-accent">
          ✓ Inscrit
        </span>
      ) : (
        <span className="inline-flex shrink-0 items-center rounded-full border border-border bg-surface-2 px-2.5 py-0.5 text-xs uppercase tracking-wider text-text-secondary">
          En attente
        </span>
      )}
    </div>
  );
}
