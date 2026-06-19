"use client";

import { useEffect, useState } from "react";
import { ParrainageCard } from "@/components/ParrainageCard";
import { ShareInvitation } from "@/components/ShareInvitation";
import { Toast, type ToastVariant } from "@/components/Toast";

/**
 * Orchestrateur client de la page parrainage.
 *
 * Charge LUI-MÊME les données via `GET /api/parrainage` au montage (fetch
 * navigateur → cookie de session porté nativement, contrairement au fetch SSR
 * worker→worker qui était peu fiable sur l'edge). Gère :
 *   - l'état loading / erreur du chargement initial ;
 *   - l'ajout optimiste d'un filleul « en attente » après une invitation 200 ;
 *   - le toast de confirmation ;
 *   - le rafraîchissement de la liste (passage « inscrit ✓ » côté serveur).
 *
 * Mobile-first : cartes empilées, pleine largeur. La liste est triée
 * « en attente » d'abord puis par date décroissante.
 */

export interface Filleul {
  email: string;
  status: "pending" | "completed";
  created_at: string;
}

interface ParrainageData {
  code: string;
  lienParrainage: string;
  filleuls: Filleul[];
}

export function ParrainerClient() {
  const [data, setData] = useState<ParrainageData | null>(null);
  const [erreur, setErreur] = useState(false);
  const [filleuls, setFilleuls] = useState<Filleul[]>([]);
  const [toast, setToast] = useState<{
    message: string;
    variant: ToastVariant;
  } | null>(null);

  // Chargement initial (fetch inline avec garde d'annulation : aucun setState
  // synchrone dans l'effect).
  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const res = await fetch("/api/parrainage", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = (await res.json()) as Partial<ParrainageData>;
        if (typeof d.code !== "string" || typeof d.lienParrainage !== "string") {
          throw new Error("réponse invalide");
        }
        if (!annule) {
          setData({
            code: d.code,
            lienParrainage: d.lienParrainage,
            filleuls: Array.isArray(d.filleuls) ? d.filleuls : [],
          });
          setFilleuls(Array.isArray(d.filleuls) ? d.filleuls : []);
        }
      } catch {
        if (!annule) setErreur(true);
      }
    })();
    return () => {
      annule = true;
    };
  }, []);

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
      const refresh = (await res.json()) as { filleuls?: Filleul[] };
      if (Array.isArray(refresh.filleuls)) {
        setFilleuls(refresh.filleuls);
      }
    } catch {
      /* on garde l'état optimiste */
    }
  }

  // État de chargement / erreur du chargement initial.
  if (!data) {
    return (
      <div className="rounded-[4px] border border-border bg-surface/60 p-8 text-center">
        <p className="text-sm leading-relaxed text-text-secondary">
          {erreur
            ? "Impossible de charger votre lien de parrainage pour le moment."
            : "Chargement de votre lien de parrainage…"}
        </p>
        {erreur && (
          <button
            type="button"
            onClick={() => {
              setErreur(false);
              window.location.reload();
            }}
            className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-[4px] border border-border bg-surface px-5 py-2.5 text-sm font-medium text-text transition-colors hover:border-accent/60 hover:bg-surface-2"
          >
            Réessayer
          </button>
        )}
      </div>
    );
  }

  const tries = [...filleuls].sort((a, b) => {
    // « en attente » avant « inscrit », puis plus récent d'abord.
    if (a.status !== b.status) return a.status === "pending" ? -1 : 1;
    return b.created_at.localeCompare(a.created_at);
  });

  const nbInscrits = filleuls.filter((f) => f.status === "completed").length;

  return (
    <div className="flex flex-col gap-6">
      <ParrainageCard lienParrainage={data.lienParrainage} code={data.code} />

      {/* Partager l'invitation — partage natif (mobile) ou e-mail (desktop). */}
      <section
        className="rounded-[4px] border border-border bg-surface/60 p-6"
        aria-labelledby="partager-title"
      >
        <h2 id="partager-title" className="font-display text-xl text-text">
          Inviter un ami
        </h2>
        <p className="mt-2 mb-4 text-sm leading-relaxed text-text-secondary">
          Sur mobile, partagez directement via WhatsApp, SMS ou Instagram. Sur
          ordinateur, envoyez l&apos;invitation par e-mail.
        </p>
        <ShareInvitation
          lienParrainage={data.lienParrainage}
          onInvite={onInvite}
        />
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
