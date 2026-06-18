/**
 * Anti-abus du parrainage (V2b) — IP + e-mail + fingerprint, ÉCHEC SILENCIEUX.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ PRINCIPE — DÉCISION ROBERT                                                │
 * │   Le seul levier gratuit étant le parrainage, c'est la cible évidente de  │
 * │   l'auto-parrainage (créer 10 faux comptes pour se créditer 10 tickets).  │
 * │   On bloque avec 3 signaux : même IP, même empreinte d'appareil, e-mail   │
 * │   jetable. On NE bloque PAS via MAC (impossible côté web).                │
 * │                                                                           │
 * │   ⚠️ ÉCHEC SILENCIEUX : si l'abus est détecté, le crédit ne se fait PAS,  │
 * │   mais on ne renvoie JAMAIS « abus détecté / même IP / même appareil ».   │
 * │   L'appelant répond comme si tout allait bien (le referral reste pending).│
 * │   But : ne pas apprendre à l'abuseur quel signal l'a fait tomber, sinon   │
 * │   il itère (VPN, navigateur privé…). Cette fonction renvoie juste un      │
 * │   booléen ; c'est l'appelant qui garantit la réponse neutre.              │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Liste (non exhaustive) de domaines d'e-mails jetables courants. Suffisant
 * pour filtrer le gros des inscriptions opportunistes sans dépendre d'un
 * service externe. Stockée en Set pour un lookup O(1). À enrichir si besoin.
 */
const DISPOSABLE_EMAIL_DOMAINS = new Set<string>([
  "mailinator.com",
  "10minutemail.com",
  "10minutemail.net",
  "guerrillamail.com",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamail.biz",
  "sharklasers.com",
  "grr.la",
  "guerrillamailblock.com",
  "yopmail.com",
  "yopmail.fr",
  "yopmail.net",
  "temp-mail.org",
  "tempmail.com",
  "tempmail.net",
  "tempmailo.com",
  "tmpmail.org",
  "throwawaymail.com",
  "getnada.com",
  "nada.email",
  "trashmail.com",
  "trashmail.de",
  "trash-mail.com",
  "dispostable.com",
  "maildrop.cc",
  "mintemail.com",
  "mohmal.com",
  "fakeinbox.com",
  "spambog.com",
  "spam4.me",
  "mailnesia.com",
  "mailcatch.com",
  "emailondeck.com",
  "moakt.com",
  "tempr.email",
  "discard.email",
  "33mail.com",
  "anonbox.net",
  "burnermail.io",
  "mailsac.com",
  "inboxkitten.com",
  "easytrashmail.com",
  "jetable.org",
  "cool.fr.nf",
  "nospam.ze.tc",
  "wegwerfmail.de",
  "mytemp.email",
  "luxusmail.org",
  "tempmailaddress.com",
  "minuteinbox.com",
  "vmani.com",
]);

/**
 * Extrait l'IP cliente réelle derrière le proxy Cloudflare.
 *   1. `CF-Connecting-IP` : header POSÉ PAR CLOUDFLARE, non spoofable par le
 *      client (Cloudflare l'écrase systématiquement). C'est la source fiable
 *      sur ce runtime (Workers edge).
 *   2. `x-forwarded-for` : fallback (1re IP de la liste) si jamais on tourne
 *      hors Cloudflare (dev local, autre proxy).
 * Renvoie `null` si aucune IP exploitable (on ne bloque pas faute d'IP).
 */
export function getClientIp(request: Request): string | null {
  const cf = request.headers.get("CF-Connecting-IP");
  if (cf && cf.trim().length > 0) return cf.trim();

  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    // x-forwarded-for = "client, proxy1, proxy2" → on prend la 1re (le client).
    const first = xff.split(",")[0]?.trim();
    if (first && first.length > 0) return first;
  }
  return null;
}

/**
 * Vrai si le domaine de l'e-mail est dans la liste des fournisseurs jetables.
 * Robuste aux espaces / casse. Un e-mail malformé est considéré jetable=false
 * (la validation de format est faite en amont par zod) — on ne se prononce que
 * sur le domaine.
 */
export function isDisposableEmail(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email.slice(at + 1).trim().toLowerCase();
  if (!domain) return false;
  return DISPOSABLE_EMAIL_DOMAINS.has(domain);
}

/** Paramètres de la décision de crédit. */
export interface CanCreditParams {
  /** Id du filleul qui vient de s'inscrire (celui qu'on vérifie). */
  filleulUserId: string;
  /** E-mail du filleul (pour le test « jetable »). */
  filleulEmail: string;
  /** IP de création du filleul (peut être null si non captée). */
  ip: string | null;
  /** Empreinte d'appareil hashée du filleul (peut être null). */
  fingerprint: string | null;
}

/**
 * Décide si on PEUT créditer un ticket de parrainage pour ce filleul.
 *
 * Renvoie `false` (→ l'appelant ne crédite pas, SILENCIEUSEMENT) si AU MOINS
 * une des règles suivantes est violée :
 *
 *   (R1) E-mail jetable           — inscription opportuniste, pas un vrai client.
 *   (R2) IP partagée              — un AUTRE compte a été créé depuis la même IP.
 *   (R3) Fingerprint partagé      — un AUTRE compte a la même empreinte d'appareil.
 *   (R4) Filleul déjà « valorisé » — ce filleul a DÉJÀ déclenché un crédit
 *                                    (un seul ticket par filleul, jamais deux).
 *
 * Toutes les lectures passent par la `service_role` (bypass RLS) : on doit
 * pouvoir inspecter les comptes AUTRES que celui du filleul, ce que la RLS
 * interdirait. En cas d'erreur DB inattendue, on choisit le côté SÛR pour le
 * business : on REFUSE le crédit (false) plutôt que de risquer un abus, mais on
 * log pour diagnostic.
 *
 * @param service client Supabase service_role (createServiceClient()).
 */
export async function canCreditReferral(
  service: SupabaseClient,
  { filleulUserId, filleulEmail, ip, fingerprint }: CanCreditParams,
): Promise<boolean> {
  // ── R1 : e-mail jetable ──────────────────────────────────────────────────
  if (isDisposableEmail(filleulEmail)) {
    return false;
  }

  // ── R4 : ce filleul a-t-il déjà déclenché un crédit ? ────────────────────
  // Un filleul ne « rapporte » qu'une seule fois, peu importe le parrain.
  const { data: dejaCredite, error: dejaErr } = await service
    .from("referrals")
    .select("id")
    .eq("filleul_user_id", filleulUserId)
    .eq("ticket_credite", true)
    .limit(1);
  if (dejaErr) {
    console.error("[anti-abuse] Lecture referrals (R4) échouée :", dejaErr.message);
    return false; // côté sûr : on ne crédite pas si on ne peut pas vérifier.
  }
  if (dejaCredite && dejaCredite.length > 0) {
    return false;
  }

  // ── R2 & R3 : IP / fingerprint partagés avec un AUTRE compte ──────────────
  // On cherche dans account_signals une ligne d'un user DIFFÉRENT du filleul
  // ayant la même IP ou le même fingerprint. `.neq('user_id', filleulUserId)`
  // exclut le signal du filleul lui-même.
  //
  // On ne lance la requête IP que si on a une IP (idem fingerprint) : un signal
  // null ne doit jamais matcher (sinon tous les comptes sans signal seraient
  // « doublons » entre eux → faux positifs massifs).
  if (ip) {
    const { data: ipDup, error: ipErr } = await service
      .from("account_signals")
      .select("user_id")
      .eq("ip_creation", ip)
      .neq("user_id", filleulUserId)
      .limit(1);
    if (ipErr) {
      console.error("[anti-abuse] Lecture account_signals IP (R2) échouée :", ipErr.message);
      return false;
    }
    if (ipDup && ipDup.length > 0) {
      return false; // R2 : même IP qu'un autre compte → suspect.
    }
  }

  if (fingerprint) {
    const { data: fpDup, error: fpErr } = await service
      .from("account_signals")
      .select("user_id")
      .eq("device_fingerprint", fingerprint)
      .neq("user_id", filleulUserId)
      .limit(1);
    if (fpErr) {
      console.error(
        "[anti-abuse] Lecture account_signals fingerprint (R3) échouée :",
        fpErr.message,
      );
      return false;
    }
    if (fpDup && fpDup.length > 0) {
      return false; // R3 : même empreinte qu'un autre compte → suspect.
    }
  }

  // Toutes les règles passent → crédit autorisé.
  return true;
}
