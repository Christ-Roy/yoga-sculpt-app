/**
 * Validation + normalisation d'un numéro de téléphone (orienté FR).
 *
 * Contexte : on récupère un numéro depuis une source NON fiable (champ téléphone
 * de la page de paiement Stripe via `customer_details.phone`, formulaire profil…)
 * et on veut le RANGER en base (`profiles.phone`) pour qu'Alice puisse rappeler
 * sa cliente. On refuse donc tout ce qui n'est pas un vrai numéro joignable
 * (« garbage in → rien en base ») et on normalise vers un format canonique
 * unique, peu importe la façon dont l'utilisateur l'a tapé.
 *
 * Format canonique retenu : **E.164** (`+33XXXXXXXXX`) — c'est ce que pose un
 * lien `tel:` propre dans les notifs Alice, et ce que renvoie Stripe par défaut.
 *
 * Cas acceptés (après nettoyage des séparateurs espaces/points/tirets/parenthèses) :
 *   - FR local           : `0X XX XX XX XX`        → `+33XXXXXXXXX`
 *   - FR international    : `+33 X XX XX XX XX`     → `+33XXXXXXXXX`
 *   - FR indicatif 0033  : `0033 X XX XX XX XX`    → `+33XXXXXXXXX`
 *   - autre pays E.164    : `+CC…` (8 à 15 chiffres)→ inchangé (`+…`)
 *
 * Refusés (→ `null`) : numéros FR ne commençant pas par 01-09, longueurs
 * incohérentes, présence de lettres, chaîne vide/espaces.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ RUNTIME — pur JS (Cloudflare Workers + Node), aucune dépendance.          │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

/** Caractères de séparation tolérés dans une saisie (retirés avant analyse). */
const SEPARATORS_RE = /[\s.\-()]/g;

/**
 * Valide + normalise un numéro de téléphone.
 *
 * @param raw saisie brute (peut être `null`/`undefined`/vide).
 * @returns le numéro au format E.164 (`+33…` pour la France) si valide, sinon
 *          `null` (on ne range JAMAIS de valeur douteuse en base).
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;

  // 1) Nettoyage des séparateurs usuels (espaces, points, tirets, parenthèses).
  let s = raw.replace(SEPARATORS_RE, "");
  if (s === "") return null;

  // 2) Préfixe international : `00CC…` → `+CC…` (forme posée par certains pavés).
  if (s.startsWith("00")) s = `+${s.slice(2)}`;

  // ── Cas A : format international explicite `+…`. ───────────────────────────
  if (s.startsWith("+")) {
    const digits = s.slice(1);
    // Que des chiffres après le `+`, longueur E.164 plausible (8–15) et un
    // indicatif pays valide (jamais commencé par 0 — n'existe pas en E.164,
    // ça trahit un `00…` mal formé plutôt qu'un vrai international).
    if (!/^[1-9]\d{7,14}$/.test(digits)) return null;

    // France (`+33`) : on impose la forme canonique (33 + 9 chiffres, le 1er
    // chiffre national ∈ 1–9 — pas de `+330…`).
    if (digits.startsWith("33")) {
      const national = digits.slice(2);
      if (!/^[1-9]\d{8}$/.test(national)) return null;
      return `+33${national}`;
    }
    // Autre pays : on garde tel quel (E.164 déjà valide).
    return `+${digits}`;
  }

  // ── Cas B : numéro national FR `0XXXXXXXXX` (10 chiffres, démarre par 0). ──
  if (/^0[1-9]\d{8}$/.test(s)) {
    return `+33${s.slice(1)}`;
  }

  // Tout le reste est rejeté (pas de garbage en base).
  return null;
}

/** Indique si une saisie correspond à un numéro de téléphone valide. */
export function isValidPhone(raw: string | null | undefined): boolean {
  return normalizePhone(raw) !== null;
}
