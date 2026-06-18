"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Gift } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { WidgetCard, WidgetEmpty } from "@/components/espace/WidgetCard";

/**
 * Widget « Parrainer un ami » — lecture SEULE de l'état du parrainage.
 *
 * ⚠️ Le parrainage est géré ailleurs (page `/espace/parrainer` + routes
 * `/api/parrainage*`). Ce widget ne fait QUE LIRE : il appelle `GET /api/parrainage`
 * côté navigateur (le fetch SSR worker→worker est peu fiable sur l'edge — cf. note
 * de `ParrainerPage`) et affiche le lien + le nombre de filleuls inscrits.
 *
 * Dégradation propre exigée (la donnée parrainage vient d'être réparée par un
 * autre agent, on ne veut pas casser le dashboard si elle n'est pas dispo) :
 *   - chargement → skeleton ;
 *   - réponse incomplète / erreur réseau → état vide invitant à ouvrir la page ;
 *   - succès → lien copiable compact + compteur de filleuls.
 *
 * Contrat lu (réponse 200 de `/api/parrainage`) :
 *   { code, lienParrainage, filleuls: [{ email, status, ... }], ticketsGagnes }
 */

interface Filleul {
  email: string;
  status: "pending" | "completed";
}

interface ParrainageData {
  lienParrainage: string;
  nbInscrits: number;
}

export function ParrainageWidget() {
  const [data, setData] = useState<ParrainageData | null>(null);
  const [etat, setEtat] = useState<"loading" | "ok" | "error">("loading");
  const [copie, setCopie] = useState(false);

  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const res = await fetch("/api/parrainage", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = (await res.json()) as {
          lienParrainage?: string;
          filleuls?: Filleul[];
        };
        if (typeof d.lienParrainage !== "string") {
          throw new Error("réponse invalide");
        }
        const filleuls = Array.isArray(d.filleuls) ? d.filleuls : [];
        const nbInscrits = filleuls.filter((f) => f.status === "completed").length;
        if (!annule) {
          setData({ lienParrainage: d.lienParrainage, nbInscrits });
          setEtat("ok");
        }
      } catch {
        if (!annule) setEtat("error");
      }
    })();
    return () => {
      annule = true;
    };
  }, []);

  async function copier(lien: string) {
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(lien);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) {
      try {
        const ta = document.createElement("textarea");
        ta.value = lien;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    if (ok) {
      setCopie(true);
      window.setTimeout(() => setCopie(false), 2500);
    }
  }

  return (
    <WidgetCard
      title="Parrainer un ami"
      titleId="widget-parrainage-title"
      icon={Gift}
      action={
        <Link
          href="/espace/parrainer"
          className="text-sm text-accent transition-colors hover:text-accent-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Gérer
        </Link>
      }
    >
      {etat === "loading" && (
        <div className="space-y-3" aria-hidden="true">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-11 w-full" />
        </div>
      )}

      {etat === "error" && (
        <WidgetEmpty message="Votre lien de parrainage n'a pas pu être chargé.">
          <Link
            href="/espace/parrainer"
            className="inline-flex min-h-[44px] items-center justify-center rounded-[4px] border border-border bg-surface px-5 py-2.5 text-sm font-medium text-text transition-colors hover:border-accent/60 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Ouvrir le parrainage
          </Link>
        </WidgetEmpty>
      )}

      {etat === "ok" && data && (
        <>
          <p className="text-sm leading-relaxed text-text-secondary">
            Partagez votre lien : dès qu&apos;un ami crée son compte grâce à vous,{" "}
            <span className="text-text">un ticket vous est offert</span>.
          </p>

          <div className="mt-3">
            <label
              htmlFor="widget-ref-link"
              className="text-xs uppercase tracking-widest text-text-secondary"
            >
              Votre lien
            </label>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input
                id="widget-ref-link"
                type="text"
                readOnly
                value={data.lienParrainage}
                onFocus={(e) => e.currentTarget.select()}
                className="min-h-[44px] flex-1 select-all rounded-[4px] border border-border bg-surface px-3 py-2.5 text-sm text-text focus:border-accent focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void copier(data.lienParrainage)}
                aria-label="Copier le lien de parrainage"
                className="inline-flex min-h-[44px] items-center justify-center rounded-[4px] border border-border bg-surface px-5 py-2.5 text-sm font-medium text-text transition-colors hover:border-accent/60 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {copie ? "Copié ✓" : "Copier"}
              </button>
            </div>
            <span className="sr-only" role="status" aria-live="polite">
              {copie ? "Lien copié dans le presse-papiers." : ""}
            </span>
          </div>

          <p className="mt-3 text-sm text-text-secondary">
            {data.nbInscrits > 0 ? (
              <>
                <span className="font-semibold text-accent">{data.nbInscrits}</span>{" "}
                ami{data.nbInscrits > 1 ? "s" : ""} inscrit
                {data.nbInscrits > 1 ? "s" : ""} grâce à vous.
              </>
            ) : (
              "Aucun filleul inscrit pour l'instant."
            )}
          </p>
        </>
      )}
    </WidgetCard>
  );
}
