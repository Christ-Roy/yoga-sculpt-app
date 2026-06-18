import { MapPin } from "lucide-react";

/**
 * « Lieu cliquable » — affiche le lieu d'un créneau sous forme d'une pastille
 * discrète qui ouvre Google Maps (recherche sur le texte du lieu) dans un
 * nouvel onglet.
 *
 * Source du lieu : le champ « Lieu » (`location`) de l'event Google Calendar
 * d'Alice, propagé jusqu'ici via `Creneau.lieu` (cf. `src/lib/reservation.ts`).
 *
 * Comportement selon `lieu` :
 *   - chaîne non vide → lien cliquable « 📍 <lieu> » vers Google Maps ;
 *   - vide / absent → mention discrète « Lieu à confirmer » (NON cliquable).
 *     (Demande Robert : le lieu devrait toujours être renseigné, mais on
 *     n'invente RIEN si Alice a oublié de le saisir.)
 *
 * Pas de `"use client"` : composant 100 % statique (un simple `<a>`), donc
 * rendable côté serveur comme client sans coût d'hydratation inutile.
 *
 * Accessibilité : `aria-label` explicite, `target="_blank"` + `rel="noopener
 * noreferrer"` (sécurité tabnabbing). Style charte NOIR & OR (accent or, hover).
 */
export function LieuMaps({
  lieu,
  className = "",
}: {
  /** Lieu libre (ex. « Studio Bellecour, Lyon »). Vide/absent → « à confirmer ». */
  lieu?: string | null;
  /** Classes additionnelles éventuelles. */
  className?: string;
}) {
  const valeur = lieu?.trim();

  // Lieu non renseigné : mention discrète, pas de lien Maps (on n'invente rien).
  if (!valeur) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 text-xs text-text-secondary ${className}`}
      >
        <MapPin size={13} aria-hidden="true" className="opacity-70" />
        Lieu à confirmer
      </span>
    );
  }

  // URL Google Maps « universal cross-platform » (recherche sur le texte libre).
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(valeur)}`;

  return (
    <a
      href={mapsUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Ouvrir « ${valeur} » dans Google Maps (nouvel onglet)`}
      className={`inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-0.5 text-xs text-accent transition-colors hover:border-accent/70 hover:bg-accent/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${className}`}
    >
      <MapPin size={13} aria-hidden="true" />
      <span className="truncate">{valeur}</span>
    </a>
  );
}
