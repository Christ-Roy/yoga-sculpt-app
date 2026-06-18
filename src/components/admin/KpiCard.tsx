/**
 * Carte KPI du dashboard (charte or). Affiche une valeur saillante + un libellé
 * et un sous-texte optionnel (contexte / hypothèse). Pur composant de présentation.
 */
export function KpiCard({
  label,
  value,
  hint,
  accent = false,
}: {
  /** Intitulé du KPI (ex. « Réservations à venir »). */
  label: string;
  /** Valeur principale, déjà formatée (nombre ou « 1 200 € »). */
  value: string | number;
  /** Sous-texte facultatif (ex. « indicatif », « ce mois »). */
  hint?: string;
  /** Met la valeur en or (réservé au KPI phare, ex. le CA). */
  accent?: boolean;
}) {
  return (
    <div className="rounded-[4px] border border-border bg-surface/60 p-5">
      <p className="text-xs uppercase tracking-widest text-text-secondary">
        {label}
      </p>
      <p
        className={`mt-2 font-display text-3xl leading-none ${
          accent ? "text-accent" : "text-text"
        }`}
      >
        {value}
      </p>
      {hint ? (
        <p className="mt-1.5 text-xs text-text-secondary">{hint}</p>
      ) : null}
    </div>
  );
}
