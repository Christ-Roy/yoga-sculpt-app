/**
 * Layout email factorisé — DA NOIR & OR premium éditorial (Yoga Sculpt).
 *
 * Point unique de rendu HTML/texte pour TOUS les emails transactionnels de
 * l'app (rappels de cours, invitation parrainage, …). Centraliser ici garantit
 * une charte cohérente : changer une couleur, le footer ou le wordmark se fait
 * à un seul endroit.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ RÈGLES EMAIL HTML — non négociables :                                     │
 * │   • Tables + styles INLINE uniquement (pas de flexbox/grid, pas de        │
 * │     classes externes : Outlook/Gmail ne les supportent pas de manière     │
 * │     fiable).                                                               │
 * │   • Largeur max 600px, table fluide (responsive sans media query).        │
 * │   • Preheader caché (texte d'aperçu dans la liste des mails).             │
 * │   • Le contenu dynamique injecté doit être échappé (cf. escapeHtml).      │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ RUNTIME — Cloudflare Workers (edge). Pur (aucun I/O), Web standard only.  │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

// ============================================================================
// Charte graphique (source de vérité unique des couleurs email)
// ============================================================================

/** Palette NOIR & OR. Exportée pour les blocs custom (ex. carte cours). */
export const COULEURS = {
  /** Fond global (ink). */
  ink: "#0E0E0E",
  /** Surface des blocs de contenu (légèrement plus clair que l'ink). */
  surface: "#141414",
  /** Accent principal — or. */
  gold: "#D4AD6A",
  /** Or foncé (hover/variantes, dégradés). */
  goldDark: "#B08F54",
  /** Texte principal clair (paper). */
  paper: "#F2F0EC",
  /** Texte secondaire / atténué. */
  muted: "#8A8A8A",
  /** Bordures discrètes. */
  border: "#2A2A2A",
} as const;

/** Stacks de polices avec fallbacks sûrs (les webfonts ne chargent pas partout). */
const FONT_TITRE = "'Anton','Arial Narrow',Helvetica,Arial,sans-serif";
const FONT_CORPS = "'Inter',Helvetica,Arial,sans-serif";

/** URL du site vitrine (public) — utilisée par défaut dans le footer. */
const SITE_URL = "https://yoga-sculpt.fr";

// ============================================================================
// Échappement HTML
// ============================================================================

/**
 * Échappe les caractères HTML sensibles d'une valeur dynamique (titre, prénom,
 * nom du parrain…) avant injection dans le squelette. À utiliser sur TOUT
 * contenu provenant de l'utilisateur ou de la base. Ne PAS appliquer sur le
 * `corpsHtml` (qui est du HTML déjà construit et maîtrisé par l'appelant).
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ============================================================================
// API publique
// ============================================================================

/** Bouton d'appel à l'action (optionnel) en pied de contenu. */
export interface EmailCta {
  /** Libellé du bouton (échappé au rendu). */
  label: string;
  /** URL cible (doit déjà être une URL absolue valide et encodée par l'appelant). */
  url: string;
}

/** Paramètres de rendu d'un email. */
export interface RenderEmailParams {
  /**
   * Texte d'aperçu (preheader) affiché dans la liste des mails, juste après
   * l'objet. Caché dans le corps. Garder court (~90 caractères).
   */
  preheader: string;
  /**
   * Titre principal (H1), affiché en capitales condensées (Anton). Échappé.
   */
  titre: string;
  /**
   * Corps de l'email : fragment HTML DÉJÀ construit par l'appelant (paragraphes,
   * cartes, etc.), avec styles inline. N'est PAS ré-échappé — l'appelant est
   * responsable d'échapper les valeurs dynamiques qu'il y injecte.
   */
  corpsHtml: string;
  /** Bouton d'action optionnel, rendu en or sous le corps. */
  cta?: EmailCta;
  /**
   * Note additionnelle optionnelle, affichée en petit dans le footer au-dessus
   * de la mention légale (ex. « Vous recevez cet email car… »). Échappée.
   */
  footerNote?: string;
  /**
   * Lien de désinscription. Par défaut le placeholder Brevo `{{unsubscribe}}`.
   * Passer une URL absolue pour un lien réel, ou `null` pour masquer la ligne.
   */
  unsubscribeUrl?: string | null;
}

/**
 * Rend le squelette HTML commun à tous les emails Yoga Sculpt (DA noir & or).
 *
 * Structure : preheader caché → conteneur 600px centré sur fond ink → header
 * wordmark or → bloc surface (titre H1 + corps + CTA optionnel) → footer
 * (note + mention Yoga Sculpt/Lyon + désinscription).
 *
 * @returns `{ html }` prêt à passer à `sendTransactionalEmail` / Brevo.
 */
export function renderEmail(params: RenderEmailParams): { html: string } {
  const {
    preheader,
    titre,
    corpsHtml,
    cta,
    footerNote,
    unsubscribeUrl = "{{unsubscribe}}",
  } = params;

  const c = COULEURS;

  // Bouton CTA (or, libellé en Anton). Optionnel.
  const ctaHtml = cta
    ? `
        <tr><td style="padding:8px 32px 4px;">
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 0;">
            <tr><td style="border-radius:3px;background:${c.gold};">
              <a href="${cta.url}" style="display:inline-block;padding:13px 26px;font-family:${FONT_TITRE};font-size:14px;letter-spacing:1px;text-transform:uppercase;color:${c.ink};text-decoration:none;border-radius:3px;">${escapeHtml(
                cta.label,
              )}</a>
            </td></tr>
          </table>
        </td></tr>`
    : "";

  // Note de footer (raison de l'envoi, etc.). Optionnelle.
  const footerNoteHtml = footerNote
    ? `${escapeHtml(footerNote)}<br>`
    : "";

  // Ligne de désinscription. Masquée si unsubscribeUrl === null.
  const unsubHtml =
    unsubscribeUrl === null
      ? ""
      : `<br><a href="${unsubscribeUrl}" style="color:${c.muted};text-decoration:underline;">Se désinscrire</a>`;

  return {
    html: `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${escapeHtml(titre)}</title>
</head>
<body style="margin:0;padding:0;background:${c.ink};color:${c.paper};font-family:${FONT_CORPS};-webkit-font-smoothing:antialiased;">
  <!-- Preheader (aperçu boîte mail), masqué visuellement -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${c.ink};">${escapeHtml(
    preheader,
  )}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${c.ink};">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <!-- Header : wordmark -->
        <tr><td align="center" style="padding:8px 0 24px;">
          <span style="font-family:${FONT_TITRE};font-size:26px;letter-spacing:3px;text-transform:uppercase;color:${c.paper};">YOGA&nbsp;<span style="color:${c.gold};">SCULPT</span></span>
        </td></tr>
        <!-- Bloc contenu (surface) -->
        <tr><td style="background:${c.surface};border:1px solid ${c.border};border-radius:4px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <!-- Filet or supérieur -->
            <tr><td style="height:3px;background:${c.gold};line-height:3px;font-size:3px;border-radius:4px 4px 0 0;">&nbsp;</td></tr>
            <!-- Titre -->
            <tr><td style="padding:28px 32px 0;">
              <h1 style="margin:0;font-family:${FONT_TITRE};font-weight:400;font-size:24px;line-height:1.25;letter-spacing:1px;text-transform:uppercase;color:${c.paper};">${escapeHtml(
                titre,
              )}</h1>
            </td></tr>
            <!-- Corps -->
            <tr><td style="padding:16px 32px ${cta ? "8px" : "28px"};font-size:15px;line-height:1.65;color:${c.paper};">
              ${corpsHtml}
            </td></tr>
            ${ctaHtml}
            ${cta ? `<tr><td style="height:20px;line-height:20px;font-size:20px;">&nbsp;</td></tr>` : ""}
          </table>
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:24px 32px 8px;font-size:12px;line-height:1.7;color:${c.muted};">
          ${footerNoteHtml}<strong style="color:${c.paper};font-weight:600;">Yoga Sculpt</strong> — Lyon · <a href="${SITE_URL}" style="color:${c.gold};text-decoration:none;">yoga-sculpt.fr</a>${unsubHtml}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  };
}

/**
 * Assemble une version texte brute à partir de lignes. Pratique pour produire
 * le `textContent` (fallback accessibilité / clients sans HTML) à côté du HTML.
 * Joint avec des sauts de ligne ; les chaînes vides produisent une ligne vide.
 */
export function textFromBlocks(lignes: string[]): string {
  return lignes.join("\n");
}
