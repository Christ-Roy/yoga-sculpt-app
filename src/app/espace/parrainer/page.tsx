import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ParrainerClient, type Filleul } from "./ParrainerClient";

export const metadata: Metadata = {
  title: "Parrainer un ami — Yoga Sculpt",
};

/** Réponse attendue de `GET /api/parrainage` (contrat agent parrainage). */
interface ParrainageData {
  code: string;
  lienParrainage: string;
  filleuls: Filleul[];
}

/**
 * Récupère les données de parrainage de l'utilisateur courant via l'API interne
 * `GET /api/parrainage`.
 *
 * Sur l'edge (OpenNext), un Server Component qui fetche sa propre route doit :
 *   1. construire une URL ABSOLUE (origin déduit des headers de la requête) ;
 *   2. propager le cookie de session (sinon l'API ne reconnaît pas le user).
 *
 * Dégradation : si l'endpoint n'est pas encore déployé / renvoie une erreur, on
 * retourne `null` et la page affiche un état vide propre (pas de crash).
 */
async function chargerParrainage(): Promise<ParrainageData | null> {
  try {
    const h = await headers();
    const host = h.get("host");
    if (!host) return null;
    const protocol =
      h.get("x-forwarded-proto") ??
      (host.startsWith("localhost") || host.startsWith("127.0.0.1")
        ? "http"
        : "https");

    const res = await fetch(`${protocol}://${host}/api/parrainage`, {
      headers: { cookie: h.get("cookie") ?? "" },
      cache: "no-store",
    });
    if (!res.ok) return null;

    const data = (await res.json()) as Partial<ParrainageData>;
    if (typeof data.code !== "string" || typeof data.lienParrainage !== "string") {
      return null;
    }
    return {
      code: data.code,
      lienParrainage: data.lienParrainage,
      filleuls: Array.isArray(data.filleuls) ? data.filleuls : [],
    };
  } catch {
    return null;
  }
}

export default async function ParrainerPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const parrainage = await chargerParrainage();

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:py-10">
      <div className="mb-6 animate-fade-in-up">
        <Link
          href="/espace"
          className="text-sm text-text-secondary transition-colors hover:text-text"
        >
          ← Mon espace
        </Link>
        <h1 className="mt-2 font-display text-3xl text-text">Parrainer un ami</h1>
        <p className="mt-2 text-sm leading-relaxed text-text-secondary">
          Faites découvrir Yoga Sculpt autour de vous et gagnez des séances.
        </p>
      </div>

      {parrainage ? (
        <ParrainerClient
          code={parrainage.code}
          lienParrainage={parrainage.lienParrainage}
          filleulsInitiaux={parrainage.filleuls}
        />
      ) : (
        // L'API de parrainage n'a pas répondu (endpoint pas encore déployé,
        // erreur réseau…). On reste rassurant plutôt que d'afficher une erreur.
        <div className="rounded-[4px] border border-border bg-surface/60 p-8 text-center">
          <p className="text-sm leading-relaxed text-text-secondary">
            Votre lien de parrainage se prépare. Revenez dans un instant pour
            inviter vos amis et gagner des séances.
          </p>
          <Link
            href="/espace/parrainer"
            className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-[4px] border border-border bg-surface px-5 py-2.5 text-sm font-medium text-text transition-colors hover:border-accent/60 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Réessayer
          </Link>
        </div>
      )}
    </div>
  );
}
