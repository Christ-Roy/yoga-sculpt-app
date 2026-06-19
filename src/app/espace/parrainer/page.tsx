import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { ParrainerClient } from "./ParrainerClient";

export const metadata: Metadata = {
  title: "Parrainer un ami — Yoga Sculpt",
};

/**
 * Page parrainage. Le Server Component ne fait QUE la garde d'auth ; les données
 * (code, lien, filleuls) sont chargées CÔTÉ CLIENT par ParrainerClient via
 * `GET /api/parrainage`.
 *
 * Pourquoi pas de fetch SSR ici : sur Cloudflare Workers (OpenNext), un Server
 * Component qui fetche sa PROPRE URL publique fait une sous-requête worker→worker
 * peu fiable (et la propagation du cookie de session y est fragile) → la page
 * tombait systématiquement sur l'état "lien se prépare". Le fetch côté navigateur,
 * lui, porte naturellement le cookie de session et fonctionne.
 */
export default async function ParrainerPage() {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);

  if (!user) {
    redirect("/login");
  }

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

      <ParrainerClient />
    </div>
  );
}
