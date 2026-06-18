/**
 * Sanitisation d'un code de parrainage reçu d'une source non fiable (param
 * d'URL `?ref=`, cookie, body). Partagé par le front (login/page.tsx pose le
 * cookie) et tout consommateur côté client.
 *
 * Le code canonique est généré par `genererCode()` (src/lib/referral.ts) :
 * 8 caractères de l'alphabet NON ambigu `ABCDEFGHJKMNPQRSTUVWXYZ23456789`
 * (ni 0/O, ni 1/I/L). On valide donc strictement contre cet alphabet, en
 * MAJUSCULES, longueur exacte 8 — toute autre forme est rejetée (`null`).
 *
 * On reste néanmoins tolérant à l'enveloppe (espaces, casse) : un code recopié
 * « abcd2345 » ou « ABCD2345 » avec un espace de trop est accepté après
 * normalisation, mais un code de longueur/alphabet invalide est REJETÉ —
 * jamais déposé en cookie tel quel (défense contre l'injection de valeur).
 */

/** Alphabet exact des codes valides (cf. genererCode dans referral.ts). */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
/** Garde-fou de longueur AVANT validation stricte (rejet précoce des abus). */
const MAX_INPUT_LENGTH = 32;

const CODE_REGEX = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

/**
 * Renvoie le code normalisé (MAJUSCULES) s'il est valide, sinon `null`.
 *
 * @param raw valeur brute (param d'URL, cookie…). `undefined`/`null` → `null`.
 */
export function sanitizeRefCode(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  // Rejet précoce des entrées anormalement longues (avant tout traitement).
  if (raw.length > MAX_INPUT_LENGTH) return null;
  const normalized = raw.trim().toUpperCase();
  if (!CODE_REGEX.test(normalized)) return null;
  return normalized;
}
