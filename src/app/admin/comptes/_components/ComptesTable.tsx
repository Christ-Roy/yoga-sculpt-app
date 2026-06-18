"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/admin-format";
import type { CompteRow } from "../_lib/data";
import { ProviderBadge, StatutBadge, SoldeInline } from "./CompteBadges";

/**
 * Tableau de la liste des comptes avec recherche client (nom / e-mail / tél).
 *
 * La pagination est SERVEUR (query `?page=`) : on filtre ici uniquement la page
 * courante reçue en props (recherche « locale » instantanée). Pour une recherche
 * globale sur tous les comptes, l'admin pagine — V1 suffisante pour le volume
 * attendu (quelques dizaines de comptes).
 *
 * Responsive : tableau ≥ md, cartes empilées en mobile (même donnée).
 */
export function ComptesTable({ comptes }: { comptes: CompteRow[] }) {
  const [q, setQ] = useState("");

  const filtres = useMemo(() => {
    const terme = q.trim().toLowerCase();
    if (!terme) return comptes;
    return comptes.filter((c) => {
      const hay = `${c.nom} ${c.email} ${c.telephone ?? ""}`.toLowerCase();
      return hay.includes(terme);
    });
  }, [q, comptes]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:max-w-sm">
        <label htmlFor="recherche-compte" className="sr-only">
          Rechercher un compte
        </label>
        <Input
          id="recherche-compte"
          type="search"
          placeholder="Rechercher (nom, e-mail, téléphone)…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
        />
        <p className="text-xs text-text-secondary">
          {filtres.length} compte{filtres.length > 1 ? "s" : ""} affiché
          {filtres.length > 1 ? "s" : ""} sur cette page.
        </p>
      </div>

      {filtres.length === 0 ? (
        <div className="rounded-[4px] border border-dashed border-border bg-surface/30 p-6 text-sm text-text-secondary">
          Aucun compte ne correspond à votre recherche.
        </div>
      ) : (
        <>
          {/* Mobile : cartes */}
          <ul className="flex flex-col gap-3 md:hidden">
            {filtres.map((c) => (
              <li
                key={c.id}
                className="rounded-[4px] border border-border bg-surface/60 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/admin/comptes/${c.id}`}
                      className="truncate text-sm text-text underline-offset-4 hover:text-accent hover:underline"
                    >
                      {c.nom !== "—" ? c.nom : c.email}
                    </Link>
                    <p className="truncate text-xs text-text-secondary">
                      {c.email}
                    </p>
                  </div>
                  <StatutBadge suspendu={c.suspendu} />
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <dt className="text-text-secondary">Inscrit le</dt>
                    <dd className="mt-0.5 text-text">{formatDate(c.createdAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-text-secondary">Auth</dt>
                    <dd className="mt-0.5">
                      <ProviderBadge provider={c.provider} />
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-text-secondary">Solde</dt>
                    <dd className="mt-0.5">
                      <SoldeInline
                        collectif={c.solde.collectif}
                        particulier={c.solde.particulier}
                      />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-text-secondary">Séances</dt>
                    <dd className="mt-0.5 text-text">
                      {c.seancesPassees} passées · {c.seancesAVenir} à venir
                    </dd>
                  </div>
                  <div>
                    <dt className="text-text-secondary">Tél.</dt>
                    <dd className="mt-0.5 text-text">{c.telephone ?? "—"}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>

          {/* Desktop : tableau */}
          <div className="hidden overflow-x-auto rounded-[4px] border border-border md:block">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">Liste des comptes</caption>
              <thead>
                <tr className="bg-surface-2 text-left text-xs uppercase tracking-widest text-text-secondary">
                  <th scope="col" className="px-4 py-3 font-medium">Membre</th>
                  <th scope="col" className="px-4 py-3 font-medium">Auth</th>
                  <th scope="col" className="px-4 py-3 font-medium">Solde</th>
                  <th scope="col" className="px-4 py-3 font-medium">Séances</th>
                  <th scope="col" className="px-4 py-3 font-medium">Inscrit le</th>
                  <th scope="col" className="px-4 py-3 font-medium">Statut</th>
                </tr>
              </thead>
              <tbody>
                {filtres.map((c) => (
                  <tr
                    key={c.id}
                    className="border-t border-border bg-surface/40 align-top"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/comptes/${c.id}`}
                        className="text-text underline-offset-4 hover:text-accent hover:underline"
                      >
                        {c.nom !== "—" ? c.nom : c.email}
                      </Link>
                      <p className="text-xs text-text-secondary">{c.email}</p>
                      {c.telephone ? (
                        <p className="text-xs text-text-secondary">{c.telephone}</p>
                      ) : null}
                      {c.parrainEmail ? (
                        <p className="mt-0.5 text-[11px] text-text-secondary">
                          Parrainé par {c.parrainEmail}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <ProviderBadge provider={c.provider} />
                    </td>
                    <td className="px-4 py-3">
                      <SoldeInline
                        collectif={c.solde.collectif}
                        particulier={c.solde.particulier}
                      />
                    </td>
                    <td className="px-4 py-3 text-text">
                      {c.seancesPassees} passées
                      <span className="text-text-secondary"> · </span>
                      {c.seancesAVenir} à venir
                    </td>
                    <td className="px-4 py-3 text-text-secondary">
                      {formatDate(c.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <StatutBadge suspendu={c.suspendu} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
