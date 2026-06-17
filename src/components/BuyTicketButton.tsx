"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { TICKET_LABEL } from "@/lib/booking";

/**
 * Bouton "Réserver une séance (ticket)".
 *
 * PHASE 1 : appelle /api/checkout qui renvoie `{ ready: false }` →
 *           on redirige vers /espace/reserver ("Paiement bientôt disponible").
 *
 * PHASE 2 (Stripe) : /api/checkout renverra `{ url }` (Stripe Checkout Session)
 *           et on fera `window.location.href = url`. Le composant est déjà
 *           câblé pour ça — aucune modif d'UI nécessaire.
 */
export function BuyTicketButton({
  className = "",
}: {
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ item: "seance" }),
        });
        const data = (await res.json()) as {
          ready?: boolean;
          url?: string;
        };

        // PHASE 2: si Stripe est branché, on a une URL de Checkout Session.
        if (data.url) {
          window.location.href = data.url;
          return;
        }

        // PHASE 1: paiement pas encore dispo → page d'explication.
        router.push("/espace/reserver");
      } catch {
        setError("Une erreur est survenue. Réessayez.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className={className}
      >
        {pending ? "Un instant…" : TICKET_LABEL}
      </Button>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
