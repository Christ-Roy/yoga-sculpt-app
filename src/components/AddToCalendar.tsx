"use client";

import { googleCalendarUrl, type SeanceAgenda } from "@/lib/calendar-export";

/**
 * Lien d'invitation du groupe WhatsApp de la communauté Yoga Sculpt. Public →
 * `NEXT_PUBLIC_*` (inliné au build). Fail-safe : si la var est absente/vide, le
 * bouton n'est PAS rendu (jamais de lien mort). Le lien peut être réinitialisé
 * par l'admin du groupe (Alice) → il suffit de mettre à jour la var + redéployer,
 * sans toucher au code.
 */
const WHATSAPP_GROUP_URL = process.env.NEXT_PUBLIC_WHATSAPP_GROUP_URL;

/**
 * Bloc « Ajouter à mon agenda » (DEMANDE EXPLICITE Robert) — affiché après une
 * réservation confirmée ET dans « Mes réservations », pour CHAQUE séance.
 *
 * Boutons :
 *   - « Google Agenda » → ouvre l'UI Google pré-remplie (nouvel onglet).
 *     ⚠️ Limite : un lien Google NE PEUT PAS imposer de rappels (Google
 *     applique les rappels par défaut du compte) — d'où le second bouton.
 *   - « Télécharger .ics » → fichier .ics avec DEUX rappels (J-1 + H-2),
 *     servi par `GET /api/ics/[bookingId]` (route serveur, RLS-vérifiée).
 *     Marche à l'import sur Google / Apple / Outlook.
 *   - « Groupe WhatsApp » (si configuré) → rejoindre la communauté Yoga Sculpt.
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
        {WHATSAPP_GROUP_URL && (
          <a
            href={WHATSAPP_GROUP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-[4px] border border-border bg-surface px-4 py-2.5 text-sm font-medium text-text transition-colors hover:border-accent/60 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            aria-label="Rejoindre le groupe WhatsApp de la communauté Yoga Sculpt (nouvel onglet)"
          >
            <WhatsAppIcon />
            Groupe WhatsApp
          </a>
        )}
      </div>
      {!compact && (
        <p className="mt-2 text-xs text-text-secondary">
          Le fichier .ics ajoute des rappels la veille et 2 h avant.
          {WHATSAPP_GROUP_URL ? " Rejoignez le groupe pour rester en lien." : ""}
        </p>
      )}
    </div>
  );
}

function WhatsAppIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className="text-accent"
    >
      <path d="M17.5 14.4c-.3-.2-1.7-.9-2-1-.3-.1-.5-.2-.7.1-.2.3-.7 1-.9 1.2-.2.2-.3.2-.6.1-.3-.2-1.2-.5-2.3-1.4-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6.1-.1.3-.3.4-.5.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5-.1-.2-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.2.2 2.1 3.3 5.2 4.6.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.7-.7 1.9-1.4.2-.7.2-1.2.2-1.4-.1-.1-.3-.2-.6-.3M12 21.5a9.5 9.5 0 0 1-4.8-1.3l-.3-.2-3.6.9.9-3.5-.2-.4A9.5 9.5 0 1 1 12 21.5m0-21A11.5 11.5 0 0 0 2.1 17.8L.5 23.5l5.9-1.5A11.5 11.5 0 1 0 12 .5" />
    </svg>
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
