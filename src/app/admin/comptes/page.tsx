import type { Metadata } from "next";
import Link from "next/link";

import { requireAdmin } from "@/lib/admin";
import { chargerComptes, PER_PAGE } from "./_lib/data";
import { ComptesTable } from "./_components/ComptesTable";
import { InviterCompte } from "./_components/InviterCompte";

export const metadata: Metadata = {
  title: "Comptes — Yoga Sculpt",
};

// Données live (comptes / soldes / statuts), jamais mises en cache statiquement.
export const dynamic = "force-dynamic";

/**
 * Back-office GESTION DES COMPTES (`/admin/comptes`) — Server Component.
 *
 * `requireAdmin()` EN TÊTE (défense en profondeur) : aucun compte n'est chargé
 * tant que l'accès admin n'est pas confirmé. La liste est paginée côté serveur
 * (query `?page=`), la recherche est locale (composant client). Charte NOIR & OR.
 */
export default async function ComptesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requireAdmin();

  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const { comptes, total, perPage } = await chargerComptes(page, PER_PAGE);

  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const hasPrev = page > 1;
  const hasNext = page < totalPages && comptes.length === perPage;

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:py-10">
      <div className="mb-8 animate-fade-in-up">
        <p className="text-sm text-text-secondary">Administration</p>
        <h1 className="font-display text-3xl text-text">Comptes</h1>
        <p className="mt-1 text-sm text-text-secondary">
          {total} compte{total > 1 ? "s" : ""} au total.
        </p>
      </div>

      <div className="flex flex-col gap-8">
        <InviterCompte />

        <ComptesTable comptes={comptes} />

        {/* Pagination serveur */}
        {totalPages > 1 ? (
          <nav
            aria-label="Pagination des comptes"
            className="flex items-center justify-between gap-3 text-sm"
          >
            {hasPrev ? (
              <Link
                href={`/admin/comptes?page=${page - 1}`}
                className="rounded-[4px] border border-border bg-surface px-4 py-2 text-text hover:border-accent/60"
              >
                ← Précédent
              </Link>
            ) : (
              <span aria-hidden className="px-4 py-2 text-text-secondary opacity-40">
                ← Précédent
              </span>
            )}
            <span className="text-text-secondary">
              Page {page} / {totalPages}
            </span>
            {hasNext ? (
              <Link
                href={`/admin/comptes?page=${page + 1}`}
                className="rounded-[4px] border border-border bg-surface px-4 py-2 text-text hover:border-accent/60"
              >
                Suivant →
              </Link>
            ) : (
              <span aria-hidden className="px-4 py-2 text-text-secondary opacity-40">
                Suivant →
              </span>
            )}
          </nav>
        ) : null}
      </div>
    </div>
  );
}
