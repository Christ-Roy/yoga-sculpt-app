"use client";

import { googleCalendarUrl, type SeanceAgenda } from "@/lib/calendar-export";

/**
 * Bloc « Ajouter à mon agenda » (DEMANDE EXPLICITE Robert) — affiché après une
 * réservation confirmée ET dans « Mes réservations », pour CHAQUE séance.
 *
 * Deux boutons :
 *   - « Google Agenda » → ouvre l'UI Google pré-remplie (nouvel onglet).
 *     ⚠️ Limite : un lien Google NE PEUT PAS imposer de rappels (Google
 *     applique les rappels par défaut du compte) — d'où le second bouton.
 *   - « Télécharger .ics » → fichier .ics avec DEUX rappels (J-1 + H-2),
 *     servi par `GET /api/ics/[bookingId]` (route serveur, RLS-vérifiée).
 *     Marche à l'import sur Google / Apple / Outlook.
 *
 * RESPONSIVE : colonne sur mobile (boutons pleine largeur, ≥44px au pouce),
 * ligne sur ≥sm.
 */
export function AddToCalendar({
  bookingId,
  seance,
  compact = false,
}: {
  /** Id du booking → URL de la route .ics. */
  bookingId: string;
  /** Données de la séance pour le lien Google (titre, dates, lieu). */
  seance: SeanceAgenda;
  /** Variante resserrée (utilisée dans la confirmation inline). */
  compact?: boolean;
}) {
  const gcalUrl = googleCalendarUrl(seance);
  const icsUrl = `/api/ics/${encodeURIComponent(bookingId)}`;

  return (
    <div className={compact ? "" : "mt-4"}>
      {!compact && (
        <p className="mb-2 text-xs uppercase tracking-widest text-text-secondary">
          Ajouter à mon agenda
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <a
          href={gcalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-[4px] border border-border bg-surface px-4 py-2.5 text-sm font-medium text-text transition-colors hover:border-accent/60 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          aria-label={`Ajouter « ${seance.titre} » à Google Agenda (nouvel onglet)`}
        >
          <CalendarIcon />
          Google Agenda
        </a>
        <a
          href={icsUrl}
          download
          className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-[4px] border border-border bg-surface px-4 py-2.5 text-sm font-medium text-text transition-colors hover:border-accent/60 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          aria-label={`Télécharger le fichier .ics de « ${seance.titre} » (rappels J-1 et H-2)`}
        >
          <DownloadIcon />
          Télécharger .ics
        </a>
      </div>
      {!compact && (
        <p className="mt-2 text-xs text-text-secondary">
          Le fichier .ics ajoute des rappels la veille et 2 h avant.
        </p>
      )}
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="text-accent"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="text-accent"
    >
      <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
    </svg>
  );
}
