/**
 * Helpers de formatage (dates, montants) pour l'affichage du dashboard admin.
 * Purs, sans I/O — utilisables côté serveur comme client.
 *
 * Fuseau forcé sur `Europe/Paris` : Alice et ses clients sont à Lyon. On ne
 * laisse pas le fuseau dépendre de l'environnement d'exécution (le Worker tourne
 * en UTC) sinon les heures de cours seraient décalées.
 */

const TZ = "Europe/Paris";

const fmtDateHeure = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TZ,
});

const fmtDate = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: TZ,
});

const fmtHeure = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TZ,
});

const fmtEuro = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

/** "lun. 23 juin, 10:00" — date + heure d'une séance. */
export function formatDateHeure(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : fmtDateHeure.format(d);
}

/** "23 juin 2026" — date seule. */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : fmtDate.format(d);
}

/** "10:00" — heure seule. */
export function formatHeure(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : fmtHeure.format(d);
}

/** "1 200 €" — montant en euros, sans décimales (CA indicatif). */
export function formatEuro(montant: number): string {
  return fmtEuro.format(montant);
}

/** Plage horaire d'un créneau : "10:00 – 11:00". */
export function formatPlage(startIso: string, endIso: string): string {
  return `${formatHeure(startIso)} – ${formatHeure(endIso)}`;
}
