"use client";

import { useState } from "react";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { Spinner } from "@/components/ui/spinner";

/**
 * Confirmation client d'un lien e-mail. Le `verifyOtp` n'est lancé qu'au CLIC
 * (pas au chargement) → le prefetch/tracking ne consomme pas le token.
 * Après succès, la session est établie côté client (cookie SSR via @supabase/ssr)
 * puis on redirige en dur vers la destination.
 */
export function ConfirmClient({
  tokenHash,
  type,
  redirectTo,
}: {
  tokenHash: string;
  type: string;
  redirectTo: string;
}) {
  const [etat, setEtat] = useState<"idle" | "loading" | "error">("idle");

  async function confirmer() {
    if (!tokenHash) {
      setEtat("error");
      return;
    }
    setEtat("loading");
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as EmailOtpType,
    });
    if (error) {
      setEtat("error");
      return;
    }
    // Session établie (cookies posés par le client SSR) → redirection en dur.
    window.location.assign(redirectTo);
  }

  if (etat === "error") {
    return (
      <>
        <h1 className="font-display text-2xl text-text">Lien expiré</h1>
        <p className="mt-3 text-sm leading-relaxed text-text-secondary">
          Ce lien n&apos;est plus valide. Demandez-en un nouveau depuis la page
          de connexion.
        </p>
        <a
          href="/login"
          className="mt-6 inline-flex min-h-[44px] items-center justify-center rounded-[4px] border border-border bg-surface px-5 py-2.5 text-sm font-medium text-text transition-colors hover:border-accent/60 hover:bg-surface-2"
        >
          Retour à la connexion
        </a>
      </>
    );
  }

  return (
    <>
      <h1 className="font-display text-2xl text-text">Connexion à votre espace</h1>
      <p className="mt-3 text-sm leading-relaxed text-text-secondary">
        Cliquez ci-dessous pour finaliser votre connexion en toute sécurité.
      </p>
      <button
        type="button"
        onClick={confirmer}
        disabled={etat === "loading"}
        className="mt-6 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[4px] bg-accent px-5 py-3 text-sm font-semibold tracking-wide text-[#0e0e0e] transition-colors hover:bg-accent-dark disabled:opacity-60"
      >
        {etat === "loading" ? (
          <>
            <Spinner />
            Connexion…
          </>
        ) : (
          "Me connecter"
        )}
      </button>
    </>
  );
}
