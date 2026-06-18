import type { AuthProvider } from "../_lib/data";

/**
 * Badges de présentation pour la liste/fiche des comptes (charte NOIR & OR).
 * Purs composants : le texte porte l'information (pas seulement la couleur) → AA.
 */

/** Libellé lisible d'un provider d'auth. */
const PROVIDER_LABEL: Record<AuthProvider, string> = {
  google: "Google",
  azure: "Microsoft",
  email: "E-mail",
  autre: "Autre",
};

/** Badge du provider d'authentification. */
export function ProviderBadge({ provider }: { provider: AuthProvider }) {
  return (
    <span className="inline-flex items-center rounded-[4px] border border-border bg-surface-2 px-2 py-0.5 text-[11px] uppercase tracking-wide text-text-secondary">
      {PROVIDER_LABEL[provider]}
    </span>
  );
}

/** Badge de statut du compte : actif (or) / suspendu (rouge atténué). */
export function StatutBadge({ suspendu }: { suspendu: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[4px] border px-2 py-0.5 text-[11px] uppercase tracking-wide ${
        suspendu
          ? "border-red-500/40 text-red-400"
          : "border-accent/40 text-accent"
      }`}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${
          suspendu ? "bg-red-400" : "bg-accent"
        }`}
      />
      {suspendu ? "Suspendu" : "Actif"}
    </span>
  );
}

/** Affiche le solde de séances par type, sobrement. */
export function SoldeInline({
  collectif,
  particulier,
}: {
  collectif: number;
  particulier: number;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-xs">
      <span className="rounded-[4px] border border-border bg-surface/60 px-1.5 py-0.5 text-text">
        {collectif} collectif
      </span>
      <span className="rounded-[4px] border border-border bg-surface/60 px-1.5 py-0.5 text-text">
        {particulier} particulier
      </span>
    </span>
  );
}
