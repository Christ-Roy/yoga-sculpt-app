import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin";
import { chargerInsights, libelleUser } from "@/lib/insights-data";
import { formatDate, formatDateHeure, formatEuro } from "@/lib/admin-format";
import { KpiCard } from "@/components/admin/KpiCard";

export const metadata: Metadata = {
  title: "Insights — Yoga Sculpt",
};

// Données live (tracking), jamais mises en cache statiquement.
export const dynamic = "force-dynamic";

/**
 * Page Insights (`/admin/insights`) — pilotage data de l'activité d'Alice.
 *
 * Server Component. `requireAdmin()` EN TÊTE (défense en profondeur) → aucune
 * donnée chargée sans accès admin confirmé. Lecture via les vues d'agrégation
 * (service_role) du tracking V1 (migration 0006).
 *
 * Affiche : le funnel global (KPIs), l'efficacité du parrainage, les checkouts
 * abandonnés, le volume d'events 30j, et une table par user (séances, tickets,
 * acquisition, parrain, abandons, LTV, dernière activité).
 */
export default async function AdminInsightsPage() {
  await requireAdmin();

  const { funnel, users, abandons, events30j } = await chargerInsights();

  // Taux de conversion étape→étape du funnel (en %, arrondi).
  const tx = (num: number, den: number) =>
    den > 0 ? Math.round((num / den) * 100) : 0;

  const labelParId = new Map(users.map((u) => [u.userId, u]));

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:py-10">
      <div className="mb-8 animate-fade-in-up">
        <p className="text-sm text-text-secondary">Pilotage</p>
        <h1 className="font-display text-3xl text-text">Insights</h1>
        <p className="mt-2 max-w-2xl text-sm text-text-secondary">
          Acquisition, rétention, abandons de paiement et parrainage. Données
          issues du journal d&apos;événements (temps réel).
        </p>
      </div>

      <div className="flex flex-col gap-12">
        {/* ─── Funnel global ───────────────────────────────────────────── */}
        <section aria-label="Funnel global">
          <h2 className="mb-4 font-display text-xl text-text">Vue d&apos;ensemble</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Inscrits" value={funnel.nbInscrits} hint="comptes créés" />
            <KpiCard
              label="Onboardés"
              value={funnel.nbOnboardes}
              hint={`${tx(funnel.nbOnboardes, funnel.nbInscrits)}% des inscrits`}
            />
            <KpiCard
              label="Acheteurs"
              value={funnel.nbAcheteurs}
              hint={`${tx(funnel.nbAcheteurs, funnel.nbInscrits)}% des inscrits`}
            />
            <KpiCard
              label="CA réel tracé"
              value={formatEuro(funnel.caReelEur)}
              hint="Σ paiements Stripe confirmés"
              accent
            />
            <KpiCard
              label="Avec réservation"
              value={funnel.nbAvecResa}
              hint={`${tx(funnel.nbAvecResa, funnel.nbInscrits)}% des inscrits`}
            />
            <KpiCard
              label="Séance honorée"
              value={funnel.nbAvecSeancePassee}
              hint="au moins 1 séance passée"
            />
            <KpiCard
              label="Paiements OK"
              value={funnel.nbCheckoutsCompletes}
              hint="sessions Stripe complétées"
            />
            <KpiCard
              label="Checkouts abandonnés"
              value={funnel.nbCheckoutsAbandonnes}
              hint="sessions démarrées sans payer"
            />
          </div>
        </section>

        {/* ─── Parrainage ──────────────────────────────────────────────── */}
        <section aria-label="Parrainage">
          <h2 className="mb-4 font-display text-xl text-text">Parrainage</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <KpiCard
              label="Filleuls crédités"
              value={funnel.nbParraines}
              hint="acquis via parrainage"
            />
            <KpiCard
              label="Tickets offerts"
              value={funnel.nbTicketsParrainage}
              hint="crédités aux parrains"
            />
            <KpiCard
              label="Part parrainage"
              value={`${tx(funnel.nbParraines, funnel.nbInscrits)}%`}
              hint="des inscrits sont parrainés"
            />
          </div>
        </section>

        {/* ─── Checkouts abandonnés ────────────────────────────────────── */}
        <section aria-label="Checkouts abandonnés">
          <h2 className="mb-4 font-display text-xl text-text">
            Checkouts abandonnés
          </h2>
          {abandons.length === 0 ? (
            <EmptyState>
              Aucun abandon de paiement à signaler.
            </EmptyState>
          ) : (
            <div className="hidden overflow-hidden rounded-[4px] border border-border md:block">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">Sessions de paiement abandonnées</caption>
                <thead>
                  <tr className="bg-surface-2 text-left text-xs uppercase tracking-widest text-text-secondary">
                    <th scope="col" className="px-4 py-3 font-medium">Client</th>
                    <th scope="col" className="px-4 py-3 font-medium">Formule</th>
                    <th scope="col" className="px-4 py-3 font-medium">Montant</th>
                    <th scope="col" className="px-4 py-3 font-medium">Démarré le</th>
                  </tr>
                </thead>
                <tbody>
                  {abandons.map((a) => (
                    <tr
                      key={a.stripeSessionId ?? `${a.userId}-${a.startedAt}`}
                      className="border-t border-border bg-surface/40 align-top"
                    >
                      <td className="px-4 py-3">
                        <p className="text-text">
                          {libelleUser({
                            fullName: a.fullName,
                            email: a.email,
                            userId: a.userId ?? "anonyme",
                          })}
                        </p>
                        {a.email ? (
                          <p className="text-xs text-text-secondary">{a.email}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-text-secondary">
                        {a.formule ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-text">
                        {a.montant != null ? formatEuro(a.montant) : "—"}
                      </td>
                      <td className="px-4 py-3 text-text-secondary">
                        {formatDateHeure(a.startedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {/* Mobile : cartes */}
          {abandons.length > 0 ? (
            <ul className="flex flex-col gap-3 md:hidden">
              {abandons.map((a) => (
                <li
                  key={`m-${a.stripeSessionId ?? `${a.userId}-${a.startedAt}`}`}
                  className="rounded-[4px] border border-border bg-surface/60 p-4 text-sm"
                >
                  <p className="text-text">
                    {libelleUser({
                      fullName: a.fullName,
                      email: a.email,
                      userId: a.userId ?? "anonyme",
                    })}
                  </p>
                  <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <dt className="text-text-secondary">Formule</dt>
                      <dd className="mt-0.5 text-text">{a.formule ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-text-secondary">Montant</dt>
                      <dd className="mt-0.5 text-text">
                        {a.montant != null ? formatEuro(a.montant) : "—"}
                      </dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-text-secondary">Démarré le</dt>
                      <dd className="mt-0.5 text-text">
                        {formatDateHeure(a.startedAt)}
                      </dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        {/* ─── Table par utilisateur ───────────────────────────────────── */}
        <section aria-label="Signaux par utilisateur">
          <h2 className="mb-4 font-display text-xl text-text">Par utilisateur</h2>
          {users.length === 0 ? (
            <EmptyState>Aucun utilisateur pour l&apos;instant.</EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-[4px] border border-border">
              <table className="w-full min-w-[860px] border-collapse text-sm">
                <caption className="sr-only">
                  Signaux agrégés par utilisateur
                </caption>
                <thead>
                  <tr className="bg-surface-2 text-left text-xs uppercase tracking-widest text-text-secondary">
                    <th scope="col" className="px-3 py-3 font-medium">Client</th>
                    <th scope="col" className="px-3 py-3 font-medium">Acquisition</th>
                    <th scope="col" className="px-3 py-3 font-medium">Séances</th>
                    <th scope="col" className="px-3 py-3 font-medium">Tickets</th>
                    <th scope="col" className="px-3 py-3 font-medium">Filleuls</th>
                    <th scope="col" className="px-3 py-3 font-medium">Abandons</th>
                    <th scope="col" className="px-3 py-3 font-medium">LTV</th>
                    <th scope="col" className="px-3 py-3 font-medium">Dernière activité</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const parrain = u.parrainUserId
                      ? labelParId.get(u.parrainUserId)
                      : undefined;
                    return (
                      <tr
                        key={u.userId}
                        className="border-t border-border bg-surface/40 align-top"
                      >
                        <td className="px-3 py-3">
                          <p className="text-text">{libelleUser(u)}</p>
                          {u.email ? (
                            <p className="text-xs text-text-secondary">{u.email}</p>
                          ) : null}
                          {!u.onboardingCompleted ? (
                            <p className="mt-0.5 text-[11px] text-text-secondary">
                              onboarding non terminé
                            </p>
                          ) : null}
                        </td>
                        <td className="px-3 py-3">
                          {u.acquisitionSource === "referral" ? (
                            <span className="inline-flex items-center rounded-[4px] border border-accent/40 px-2 py-0.5 text-[11px] uppercase tracking-wide text-accent">
                              Parrainé
                            </span>
                          ) : (
                            <span className="text-text-secondary">Direct</span>
                          )}
                          {parrain ? (
                            <p className="mt-1 text-[11px] text-text-secondary">
                              par {libelleUser(parrain)}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-3 py-3 text-text">
                          {u.nbSeancesPassees}
                          <span className="text-text-secondary"> passées</span>
                          <br />
                          {u.nbSeancesAVenir}
                          <span className="text-text-secondary"> à venir</span>
                        </td>
                        <td className="px-3 py-3 text-text">
                          {u.nbTicketsPayes}
                          <span className="text-text-secondary"> payés</span>
                          <br />
                          {u.nbTicketsTotal}
                          <span className="text-text-secondary"> au total</span>
                        </td>
                        <td className="px-3 py-3 text-text">
                          {u.nbFilleulsCredites}
                        </td>
                        <td
                          className={`px-3 py-3 ${
                            u.checkoutAbandonnes > 0
                              ? "text-accent"
                              : "text-text-secondary"
                          }`}
                        >
                          {u.checkoutAbandonnes}
                        </td>
                        <td className="px-3 py-3 text-text">
                          {formatEuro(u.ltvEur)}
                        </td>
                        <td className="px-3 py-3 text-text-secondary">
                          {formatDate(u.derniereActivite)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ─── Activité 30 jours ───────────────────────────────────────── */}
        <section aria-label="Activité 30 jours">
          <h2 className="mb-4 font-display text-xl text-text">
            Activité (30 derniers jours)
          </h2>
          {events30j.length === 0 ? (
            <EmptyState>Aucune activité sur les 30 derniers jours.</EmptyState>
          ) : (
            <div className="overflow-hidden rounded-[4px] border border-border">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">
                  Volume d&apos;événements par type sur 30 jours
                </caption>
                <thead>
                  <tr className="bg-surface-2 text-left text-xs uppercase tracking-widest text-text-secondary">
                    <th scope="col" className="px-4 py-3 font-medium">Événement</th>
                    <th scope="col" className="px-4 py-3 font-medium">Total</th>
                    <th scope="col" className="px-4 py-3 font-medium">Utilisateurs</th>
                    <th scope="col" className="px-4 py-3 font-medium">Dernier</th>
                  </tr>
                </thead>
                <tbody>
                  {events30j.map((e) => (
                    <tr
                      key={e.eventType}
                      className="border-t border-border bg-surface/40"
                    >
                      <td className="px-4 py-3 font-mono text-xs text-text">
                        {e.eventType}
                      </td>
                      <td className="px-4 py-3 text-text">{e.nbTotal}</td>
                      <td className="px-4 py-3 text-text-secondary">{e.nbUsers}</td>
                      <td className="px-4 py-3 text-text-secondary">
                        {e.dernier ? formatDateHeure(e.dernier) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[4px] border border-dashed border-border bg-surface/30 p-6 text-sm text-text-secondary">
      {children}
    </div>
  );
}
