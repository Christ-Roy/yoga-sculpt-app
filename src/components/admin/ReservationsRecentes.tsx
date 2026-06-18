import { formatDateHeure } from "@/lib/admin-format";
import { TypeBadge } from "@/components/admin/TypeBadge";
import { StatusBadge } from "@/components/admin/StatusBadge";
import type { ReservationRecente } from "@/lib/admin-data";

/**
 * Historique des réservations récentes (30 dernières, confirmées + annulées).
 *
 * Responsive : tableau sémantique sur desktop (≥ md), cartes empilées sur
 * mobile (le même contenu, sans débordement horizontal). On ne duplique pas la
 * donnée logique — juste deux présentations du même tableau de lignes.
 */
export function ReservationsRecentes({
  reservations,
}: {
  reservations: ReservationRecente[];
}) {
  return (
    <section aria-label="Réservations récentes">
      <h2 className="mb-4 font-display text-xl text-text">
        Réservations récentes
      </h2>

      {reservations.length === 0 ? (
        <div className="rounded-[4px] border border-dashed border-border bg-surface/30 p-6 text-sm text-text-secondary">
          Aucune réservation pour l&apos;instant.
        </div>
      ) : (
        <>
          {/* Mobile : cartes empilées */}
          <ul className="flex flex-col gap-3 md:hidden">
            {reservations.map((r) => (
              <li
                key={r.id}
                className="rounded-[4px] border border-border bg-surface/60 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-text">{r.nom}</p>
                    {r.email ? (
                      <p className="truncate text-xs text-text-secondary">
                        {r.email}
                      </p>
                    ) : null}
                  </div>
                  <StatusBadge status={r.status} />
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <dt className="text-text-secondary">Séance</dt>
                    <dd className="mt-0.5 text-text">
                      {formatDateHeure(r.startsAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-text-secondary">Type</dt>
                    <dd className="mt-0.5">
                      <TypeBadge type={r.type} />
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-text-secondary">Réservé le</dt>
                    <dd className="mt-0.5 text-text">
                      {formatDateHeure(r.createdAt)}
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>

          {/* Desktop : tableau */}
          <div className="hidden overflow-hidden rounded-[4px] border border-border md:block">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">
                Liste des réservations récentes
              </caption>
              <thead>
                <tr className="bg-surface-2 text-left text-xs uppercase tracking-widest text-text-secondary">
                  <th scope="col" className="px-4 py-3 font-medium">
                    Client
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Type
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Séance
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Réservé le
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Statut
                  </th>
                </tr>
              </thead>
              <tbody>
                {reservations.map((r) => (
                  <tr
                    key={r.id}
                    className="border-t border-border bg-surface/40 align-top"
                  >
                    <td className="px-4 py-3">
                      <p className="text-text">{r.nom}</p>
                      {r.email ? (
                        <p className="text-xs text-text-secondary">{r.email}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <TypeBadge type={r.type} />
                    </td>
                    <td className="px-4 py-3 text-text">
                      {formatDateHeure(r.startsAt)}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">
                      {formatDateHeure(r.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
