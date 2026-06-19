"use client";

import { useEffect } from "react";
import { createLogger, serializeError } from "@/lib/log";

const log = createLogger("admin/reservations:error");

/**
 * Error boundary de la page `/admin/reservations`.
 *
 * POURQUOI : la page est `force-dynamic` et charge, côté serveur, les
 * réservations (Supabase) + les créneaux Google Calendar. À la 1re navigation
 * client-side, le fetch du payload RSC peut échouer de façon INTERMITTENTE
 * (timeout réseau / Google lent) → Next affiche son écran générique « This page
 * couldn't load » (et un simple reload repassait). On intercepte cette erreur
 * avec une frontière dédiée qui propose un RETRY immédiat (`reset()`), sans
 * recharger toute l'app ni perdre le shell admin.
 *
 * C'est une frontière TECHNIQUE (récupération d'erreur + retry), pas une refonte
 * visuelle de la page : rendu minimal aligné sur la palette existante.
 *
 * Doc Next 16 : un fichier `error.tsx` DOIT être un Client Component et reçoit
 * `{ error, reset }`. `reset()` re-render le segment en retentant son rendu
 * serveur (donc re-déclenche le data fetch).
 */
export default function ReservationsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Observabilité : on logge l'échec (sans PII) pour diagnostiquer la fréquence
    // réelle des timeouts. `digest` est l'id d'erreur côté serveur (corrélation).
    log.error("Échec de chargement de /admin/reservations", {
      digest: error.digest ?? null,
      err: serializeError(error),
    });
  }, [error]);

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:py-10">
      <div className="mx-auto max-w-md rounded-[4px] border border-border bg-surface/60 p-8 text-center">
        <h1 className="font-display text-2xl text-text">
          Chargement interrompu
        </h1>
        <p className="mt-3 text-sm text-text-secondary">
          La liste des réservations n&apos;a pas pu se charger (connexion lente à
          l&apos;agenda). Réessayez — c&apos;est souvent temporaire.
        </p>
        <button
          type="button"
          onClick={() => reset()}
          className="mt-6 inline-flex items-center justify-center rounded-[4px] border border-[var(--accent)] px-5 py-2.5 text-sm font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--bg)]"
        >
          Réessayer
        </button>
      </div>
    </div>
  );
}
