import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAdmin } from "@/lib/admin";
import { formatDate, formatDateHeure } from "@/lib/admin-format";
import { TypeBadge } from "@/components/admin/TypeBadge";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { chargerCompte } from "../_lib/data";
import {
  ProviderBadge,
  StatutBadge,
  SoldeInline,
} from "../_components/CompteBadges";
import { CompteActions } from "../_components/CompteActions";

export const metadata: Metadata = {
  title: "Fiche compte — Yoga Sculpt",
};

export const dynamic = "force-dynamic";

/** Petite ligne « libellé : valeur » pour la fiche. */
function Champ({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-widest text-text-secondary">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-text">{children}</dd>
    </div>
  );
}

/**
 * FICHE d'un compte (`/admin/comptes/[id]`) — Server Component.
 *
 * `requireAdmin()` en tête. Affiche le détail complet du membre (identité,
 * auth, onboarding, tickets, historique de réservations, parrainage) + le
 * panneau d'actions admin (crédit/débit, liens d'auth, suspension). 404 propre
 * si l'id est inconnu.
 */
export default async function CompteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();

  const { id } = await params;
  const compte = await chargerCompte(id);
  if (!compte) notFound();

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:py-10">
      <div className="mb-6 animate-fade-in-up">
        <Link
          href="/admin/comptes"
          className="text-sm text-text-secondary underline-offset-4 hover:text-accent hover:underline"
        >
          ← Tous les comptes
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="font-display text-3xl text-text">
            {compte.nom !== "—" ? compte.nom : compte.email}
          </h1>
          <StatutBadge suspendu={compte.suspendu} />
        </div>
        <p className="mt-1 text-sm text-text-secondary">{compte.email}</p>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_minmax(320px,380px)]">
        {/* Colonne gauche : informations */}
        <div className="flex flex-col gap-8">
          {/* Identité & auth */}
          <section className="rounded-[4px] border border-border bg-surface/60 p-5">
            <h2 className="mb-4 font-display text-lg text-text">Informations</h2>
            <dl className="grid grid-cols-2 gap-4">
              <Champ label="Téléphone">{compte.telephone ?? "—"}</Champ>
              <Champ label="Provider">
                <ProviderBadge provider={compte.provider} />
              </Champ>
              <Champ label="Inscrit le">{formatDate(compte.createdAt)}</Champ>
              <Champ label="Dernière connexion">
                {compte.lastSignInAt ? formatDateHeure(compte.lastSignInAt) : "—"}
              </Champ>
              <Champ label="Onboarding">
                {compte.onboardingComplet ? "Complété" : "Non complété"}
              </Champ>
              <Champ label="Parrain">{compte.parrainEmail ?? "—"}</Champ>
              <Champ label="Solde de séances">
                <SoldeInline
                  collectif={compte.solde.collectif}
                  particulier={compte.solde.particulier}
                />
              </Champ>
              <Champ label="Séances">
                {compte.seancesPassees} passées · {compte.seancesAVenir} à venir
              </Champ>
            </dl>
          </section>

          {/* Onboarding détaillé */}
          {compte.onboarding ? (
            <section className="rounded-[4px] border border-border bg-surface/60 p-5">
              <h2 className="mb-4 font-display text-lg text-text">Onboarding</h2>
              <dl className="grid grid-cols-2 gap-4">
                <Champ label="Objectif">{compte.onboarding.goal ?? "—"}</Champ>
                <Champ label="Niveau">{compte.onboarding.level ?? "—"}</Champ>
                <Champ label="Fréquence">
                  {compte.onboarding.frequency ?? "—"}
                </Champ>
                <Champ label="Disponibilités">
                  {compte.onboarding.availability ?? "—"}
                </Champ>
              </dl>
            </section>
          ) : null}

          {/* Tickets */}
          <section className="rounded-[4px] border border-border bg-surface/60 p-5">
            <h2 className="mb-4 font-display text-lg text-text">
              Carnets de séances
            </h2>
            {compte.tickets.length === 0 ? (
              <p className="text-sm text-text-secondary">Aucun carnet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {compte.tickets.map((t) => (
                  <li
                    key={t.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-border bg-surface/40 px-3 py-2 text-sm"
                  >
                    <span className="flex items-center gap-2">
                      <TypeBadge type={t.type} />
                      <span className="text-text">
                        {t.quantiteRestante} / {t.quantiteInitiale} restantes
                      </span>
                      {t.ajustementAdmin ? (
                        <span className="rounded-[4px] border border-accent/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-accent">
                          Ajustement admin
                        </span>
                      ) : null}
                    </span>
                    <span className="text-xs text-text-secondary">
                      Acheté le {formatDate(t.createdAt)}
                      {t.expiresAt ? ` · expire le ${formatDate(t.expiresAt)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Réservations */}
          <section className="rounded-[4px] border border-border bg-surface/60 p-5">
            <h2 className="mb-4 font-display text-lg text-text">Réservations</h2>
            {compte.bookings.length === 0 ? (
              <p className="text-sm text-text-secondary">Aucune réservation.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {compte.bookings.map((b) => (
                  <li
                    key={b.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-border bg-surface/40 px-3 py-2 text-sm"
                  >
                    <span className="flex items-center gap-2">
                      <TypeBadge type={b.type} />
                      <span className="text-text">{formatDateHeure(b.startsAt)}</span>
                    </span>
                    <StatusBadge status={b.status} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Filleuls (si parrain) */}
          {compte.filleuls.length > 0 ? (
            <section className="rounded-[4px] border border-border bg-surface/60 p-5">
              <h2 className="mb-4 font-display text-lg text-text">
                Filleuls parrainés
              </h2>
              <ul className="flex flex-col gap-2">
                {compte.filleuls.map((f, i) => (
                  <li
                    key={`${f.filleulEmail}-${i}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-border bg-surface/40 px-3 py-2 text-sm"
                  >
                    <span className="text-text">{f.filleulEmail}</span>
                    <span className="text-xs text-text-secondary">
                      {f.status}
                      {f.ticketCredite ? " · ticket crédité" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        {/* Colonne droite : actions */}
        <CompteActions
          userId={compte.id}
          email={compte.email}
          suspendu={compte.suspendu}
        />
      </div>
    </div>
  );
}
