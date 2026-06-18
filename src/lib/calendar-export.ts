/**
 * Export agenda — « Ajouter à mon agenda » côté CLIENT (DEMANDE EXPLICITE Robert).
 *
 * Deux formats, deux niveaux de service :
 *
 *   1) Lien Google Agenda (`googleCalendarUrl`) — ouvre l'UI Google pré-remplie
 *      dans un nouvel onglet. Pratique (1 clic, pas de fichier), MAIS un lien
 *      Google Agenda NE PEUT PAS imposer de rappels : Google applique les
 *      rappels PAR DÉFAUT du compte de l'utilisateur. On ne peut donc PAS
 *      garantir un rappel J-1 / H-2 par ce biais.
 *
 *   2) Fichier .ics (`buildIcs`) — un VEVENT standard avec DEUX VALARM
 *      (`-P1D` = J-1, `-PT2H` = H-2, `ACTION:DISPLAY`). LÀ, les rappels SONT
 *      programmés et respectés à l'import sur Google / Apple / Outlook. C'est
 *      le seul moyen fiable d'imposer les rappels demandés.
 *
 * Module 100 % PUR (aucun I/O, aucune dépendance) → testable et réutilisable
 * côté client (Blob/download) comme côté serveur (route `GET /api/ics/...`).
 */

/** Données minimales d'une séance pour l'export agenda. */
export interface SeanceAgenda {
  /** Identifiant stable de l'événement (sert à fabriquer l'UID .ics). */
  id: string;
  /** Titre, ex. "Cours collectif — Yoga Sculpt". */
  titre: string;
  /** Début (ISO 8601). */
  starts_at: string;
  /** Fin (ISO 8601). */
  ends_at: string;
  /**
   * Lieu. Placeholder "Lyon" tant qu'Alice n'a pas confirmé l'adresse exacte
   * (NE PAS inventer d'adresse précise — cf. CLAUDE.md du projet).
   */
  lieu?: string;
  /** Description courte (optionnelle). */
  description?: string;
}

/**
 * Convertit un ISO 8601 en estampille UTC « basique » `YYYYMMDDTHHMMSSZ`,
 * format exigé aussi bien par l'URL Google Agenda (paramètre `dates`) que par
 * un VEVENT en UTC. On ancre tout en UTC (suffixe `Z`) : sans ambiguïté de
 * fuseau, l'événement tombe au bon instant quel que soit le calendrier cible.
 *
 * @returns la chaîne `YYYYMMDDTHHMMSSZ`, ou `""` si la date est invalide.
 */
export function toIcsUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * Construit l'URL « Ajouter à Google Agenda » (action=TEMPLATE), pré-remplie.
 *
 * ⚠️ Limite (documentée) : ce lien NE PEUT PAS imposer de rappels — Google
 * applique les notifications par défaut du compte de l'utilisateur. Pour des
 * rappels garantis (J-1 / H-2), utiliser le .ics (`buildIcs`).
 */
export function googleCalendarUrl(seance: SeanceAgenda): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: seance.titre,
    dates: `${toIcsUtc(seance.starts_at)}/${toIcsUtc(seance.ends_at)}`,
  });
  if (seance.description) params.set("details", seance.description);
  if (seance.lieu) params.set("location", seance.lieu);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Échappe un texte pour une valeur de propriété iCalendar (RFC 5545 §3.3.11) :
 * antislash, virgule, point-virgule et sauts de ligne doivent être protégés,
 * sinon le fichier .ics est mal parsé (texte tronqué, propriétés cassées).
 */
function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * Replie une ligne iCalendar à 75 octets (RFC 5545 §3.1 — « content line
 * folding »). Une ligne trop longue est coupée et continuée par un CRLF suivi
 * d'une espace. On raisonne en octets (UTF-8) pour rester correct sur les
 * accents. Sans ça, certains clients (Outlook) rejettent les longues lignes.
 */
function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const out: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const char of line) {
    const charBytes = encoder.encode(char).length;
    // 74 (et non 75) sur les lignes de continuation : l'espace de tête compte.
    const limite = out.length === 0 ? 75 : 74;
    if (currentBytes + charBytes > limite) {
      out.push(current);
      current = char;
      currentBytes = charBytes;
    } else {
      current += char;
      currentBytes += charBytes;
    }
  }
  if (current) out.push(current);
  return out.join("\r\n ");
}

/**
 * Génère un fichier .ics (VCALENDAR + un VEVENT) avec DEUX rappels :
 *   - VALARM `-P1D`  → la veille (J-1) ;
 *   - VALARM `-PT2H` → 2 heures avant (H-2) ;
 * tous deux `ACTION:DISPLAY` (notification visuelle, supportée partout).
 *
 * Les lignes sont jointes en CRLF (`\r\n`), comme l'exige la RFC 5545.
 *
 * @param dtstamp estampille de génération (UTC). Injectable pour des tests
 *                déterministes ; par défaut « maintenant ».
 */
export function buildIcs(
  seance: SeanceAgenda,
  dtstamp: Date = new Date(),
): string {
  const dtStart = toIcsUtc(seance.starts_at);
  const dtEnd = toIcsUtc(seance.ends_at);
  const stamp = toIcsUtc(dtstamp.toISOString());
  // UID stable + domaine de l'app → pas de doublon à la ré-import.
  const uid = `${seance.id}@yoga-sculpt.fr`;

  const lignes: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Yoga Sculpt//Espace client//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escapeIcsText(seance.titre)}`,
  ];

  if (seance.description) {
    lignes.push(`DESCRIPTION:${escapeIcsText(seance.description)}`);
  }
  if (seance.lieu) {
    lignes.push(`LOCATION:${escapeIcsText(seance.lieu)}`);
  }

  lignes.push("STATUS:CONFIRMED");

  // Rappel J-1.
  lignes.push(
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeIcsText(`Rappel : ${seance.titre} demain`)}`,
    "TRIGGER:-P1D",
    "END:VALARM",
  );
  // Rappel H-2.
  lignes.push(
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeIcsText(`Rappel : ${seance.titre} dans 2 heures`)}`,
    "TRIGGER:-PT2H",
    "END:VALARM",
  );

  lignes.push("END:VEVENT", "END:VCALENDAR");

  return lignes.map(foldIcsLine).join("\r\n");
}

/** Nom de fichier .ics propre (slug du titre + id court). */
export function icsFileName(seance: SeanceAgenda): string {
  const slug = seance.titre
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // supprime les diacritiques
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
  return `${slug || "seance"}-yoga-sculpt.ics`;
}
