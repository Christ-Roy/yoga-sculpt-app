import { formatDate, formatPlage } from "@/lib/admin-format";
import { TypeBadge } from "@/components/admin/TypeBadge";
import type { CreneauAvecInscrits } from "@/lib/admin-data";

/**
 * Liste des créneaux à venir (events Google Calendar posés par Alice), chacun
 * avec sa liste NOMINATIVE d'inscrits (nom + email, issus de `profiles` croisés
 * aux `bookings` confirmés).
 *
 * Format CARTES (pas tableau) : un créneau contient une sous-liste d'inscrits,
 * ce qui s'imbrique mal dans un `<table>`. Les cartes restent lisibles mobile
 * comme desktop (grille 1 col mobile → 2 col desktop).
 *
 * Aide contextuelle : on rappelle à Alice que, faute de capacité automatique en
 * V1, elle « ferme » un créneau plein en le retirant de son Google Agenda.
 */
export function CreneauxList({
  creneaux,
}: {
  creneaux: CreneauAvecInscrits[];
}) {
  return (
    <section aria-label="Créneaux à venir">
      <div className="mb-4 flex flex-col gap-1">
        <h2 className="font-display text-xl text-text">Créneaux à venir</h2>
        <p className="text-xs text-text-secondary">
          Astuce : pour fermer un créneau complet, retirez-le de votre Google
          Agenda — il disparaîtra automatiquement des réservations possibles.
        </p>
      </div>

      {creneaux.length === 0 ? (
        <EmptyState>
          Aucun créneau à venir n&apos;est posé dans votre Google Agenda (ou
          l&apos;agenda n&apos;est pas accessible pour le moment).
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {creneaux.map((c) => (
            <article
              key={c.id}
              className="flex flex-col rounded-[4px] border border-border bg-surface/60 p-5"
            >
              <header className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-text">
                    {formatDate(c.starts_at)}
                  </p>
                  <p className="text-sm text-text-secondary">
                    {formatPlage(c.starts_at, c.ends_at)}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <TypeBadge type={c.type} />
                  <span className="text-xs text-text-secondary">
                    {c.inscrits} inscrit{c.inscrits > 1 ? "s" : ""}
                  </span>
                </div>
              </header>

              {c.summary ? (
                <p className="mt-2 text-sm text-text-secondary">{c.summary}</p>
              ) : null}

              <div className="mt-4 border-t border-border pt-3">
                {c.inscritsListe.length === 0 ? (
                  <p className="text-xs text-text-secondary">
                    Aucun inscrit pour l&apos;instant.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {c.inscritsListe.map((i) => (
                      <li
                        key={i.bookingId}
                        className="flex flex-col gap-0.5 text-sm sm:flex-row sm:items-baseline sm:justify-between sm:gap-3"
                      >
                        <span className="text-text">{i.nom}</span>
                        {i.email ? (
                          <a
                            href={`mailto:${i.email}`}
                            className="truncate text-xs text-text-secondary transition-colors hover:text-accent"
                          >
                            {i.email}
                          </a>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[4px] border border-dashed border-border bg-surface/30 p-6 text-sm text-text-secondary">
      {children}
    </div>
  );
}
