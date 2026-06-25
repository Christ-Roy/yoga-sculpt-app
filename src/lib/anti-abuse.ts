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
import { createLogger } from "@/lib/log";

const log = createLogger("anti-abuse");

/**
 * Liste (non exhaustive) de domaines d'e-mails jetables courants. Suffisant
 * pour filtrer le gros des inscriptions opportunistes sans dépendre d'un
 * service externe. Stockée en Set pour un lookup O(1). À enrichir si besoin.
 */
const DISPOSABLE_EMAIL_DOMAINS_STATIC = new Set<string>([
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
 * Fournisseurs dont les ALIAS pointent tous vers la MÊME boîte. Pour ces
 * domaines, on canonicalise la partie locale avant tout test d'identité /
 * jetabilité :
 *   - on retire le `+tag` (tout ce qui suit le premier `+`) ;
 *   - pour Gmail on retire AUSSI les `.` (Gmail les ignore : `u.s.e.r` == `user`).
 * Conséquence : `u.s.e.r+promo@gmail.com`, `user@gmail.com`,
 * `US.ER+x@googlemail.com` se réduisent TOUS à `user@gmail.com` → un même
 * attaquant ne peut plus fabriquer N identités gratuites avec une seule boîte.
 *
 * `dotsIgnored` distingue Gmail (points ignorés) des autres (`+tag` seulement).
 */
const ALIAS_PROVIDERS: Record<string, { canonicalDomain: string; dotsIgnored: boolean }> = {
  "gmail.com": { canonicalDomain: "gmail.com", dotsIgnored: true },
  "googlemail.com": { canonicalDomain: "gmail.com", dotsIgnored: true },
};

/**
 * Source de blocklist dynamique (liste publique maintenue de domaines jetables).
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ POURQUOI une liste distante ?                                            │
 * │   La Set statique (~55 domaines) ignore les MILLIERS de domaines jetables│
 * │   réels et n'est jamais à jour. On unionne donc une liste publique tenue │
 * │   à jour par la communauté (un domaine par ligne, format texte brut).    │
 * │                                                                          │
 * │ RUNTIME — Cloudflare Workers (edge) :                                    │
 * │   `fetch` + `AbortSignal.timeout` + `Set` uniquement (Web standard, zéro │
 * │   built-in Node, pas de `fs`, pas de dépendance). Cache mémoire au niveau │
 * │   du module (l'isolate Worker est réutilisé entre requêtes → 1 fetch /   │
 * │   TTL, pas 1 par requête).                                                │
 * │                                                                          │
 * │ ⚠️ JAMAIS FAIL-OPEN :                                                     │
 * │   le test effectif = Set STATIQUE ∪ liste distante. Si le fetch échoue / │
 * │   time out / renvoie du vide, on RETOMBE sur la Set statique (le plancher │
 * │   conservateur reste appliqué). Un échec réseau ne peut donc QUE nous     │
 * │   rendre moins large que la liste distante — jamais plus permissif que le │
 * │   comportement statique d'origine. On ne « laisse jamais passer » par     │
 * │   panne : on bloque au minimum ce que la Set statique bloque déjà.        │
 * └─────────────────────────────────────────────────────────────────────────┘
 */
const DISPOSABLE_BLOCKLIST_URL =
  "https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf";

/** TTL du cache distant (ms). Au-delà, le prochain crédit re-fetch en best-effort. */
const BLOCKLIST_TTL_MS = 6 * 60 * 60 * 1000; // 6 h
/** Timeout du fetch distant (ms) — on ne bloque jamais un crédit sur le réseau. */
const BLOCKLIST_FETCH_TIMEOUT_MS = 2500;
/** Garde-fou anti-réponse aberrante : on ignore une liste démesurée (corruption/MITM). */
const BLOCKLIST_MAX_ENTRIES = 200_000;

/**
 * Cache mémoire (niveau module = niveau isolate Worker). `domains` = dernière
 * liste distante valide connue ; `fetchedAt` = horodatage ; `inflight` = promesse
 * de fetch en cours (dédoublonne les requêtes concurrentes du même isolate).
 */
const dynamicBlocklist: {
  domains: Set<string>;
  fetchedAt: number;
  inflight: Promise<void> | null;
} = { domains: new Set(), fetchedAt: 0, inflight: null };

/**
 * Rafraîchit (best-effort, silencieux) le cache de la blocklist distante si le
 * TTL est expiré. Ne JAMAIS throw : toute erreur (réseau, timeout, parse, taille
 * aberrante) laisse le dernier cache en place et retombe in fine sur la Set
 * statique. À appeler (await) en tête des chemins de crédit (async), pas dans le
 * test synchrone `isDisposableEmail` qui doit rester pur.
 */
export async function refreshDisposableBlocklist(): Promise<void> {
  const now = Date.now();
  // Cache encore frais (et déjà peuplé) → rien à faire.
  if (now - dynamicBlocklist.fetchedAt < BLOCKLIST_TTL_MS && dynamicBlocklist.domains.size > 0) {
    return;
  }
  // Un fetch est déjà en cours dans cet isolate → on s'y raccroche (pas de N fetchs).
  if (dynamicBlocklist.inflight) {
    return dynamicBlocklist.inflight;
  }

  dynamicBlocklist.inflight = (async () => {
    try {
      const res = await fetch(DISPOSABLE_BLOCKLIST_URL, {
        // AbortSignal.timeout : Web standard, supporté sur Workers edge.
        signal: AbortSignal.timeout(BLOCKLIST_FETCH_TIMEOUT_MS),
        headers: { accept: "text/plain" },
        cf: { cacheTtl: 21_600, cacheEverything: true },
      } as RequestInit);

      if (!res.ok) {
        log.warn("Blocklist jetable : HTTP non-OK, on garde le cache/statique", {
          status: res.status,
        });
        return;
      }

      const text = await res.text();
      const parsed = parseBlocklist(text);
      if (parsed.size === 0) {
        log.warn("Blocklist jetable : réponse vide/illisible, on garde le cache/statique");
        return;
      }
      if (parsed.size > BLOCKLIST_MAX_ENTRIES) {
        // Réponse aberrante (corruption, mauvais endpoint, MITM) → on ignore.
        log.warn("Blocklist jetable : taille aberrante, ignorée", { size: parsed.size });
        return;
      }

      dynamicBlocklist.domains = parsed;
      dynamicBlocklist.fetchedAt = Date.now();
      log.info("Blocklist jetable rafraîchie", { size: parsed.size });
    } catch (e) {
      // Réseau / timeout / parse : on NE crédite jamais sur une panne → on
      // retombe simplement sur la Set statique (jamais fail-open). Best-effort.
      log.warn("Blocklist jetable : fetch échoué, fallback Set statique", {
        err: e instanceof Error ? e.message : String(e),
      });
    } finally {
      dynamicBlocklist.inflight = null;
    }
  })();

  return dynamicBlocklist.inflight;
}

/**
 * TEST-ONLY — réinitialise le cache mémoire de la blocklist distante. Le cache
 * vit au niveau du module (volontaire : 1 fetch / TTL côté Worker) ; les tests
 * doivent pouvoir repartir d'un état propre entre les cas. À n'utiliser QUE
 * depuis les tests (pas de chemin de prod ne l'appelle).
 */
export function __resetDisposableBlocklistForTests(): void {
  dynamicBlocklist.domains = new Set();
  dynamicBlocklist.fetchedAt = 0;
  dynamicBlocklist.inflight = null;
}

/**
 * Parse une blocklist au format « un domaine par ligne » (conf communautaire) :
 * ignore lignes vides + commentaires (`#`), trim, lowercase. Robuste aux CR/LF.
 */
function parseBlocklist(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.split("\n")) {
    const line = raw.trim().toLowerCase();
    if (!line || line.startsWith("#")) continue;
    // Une entrée valide ressemble à un domaine (pas d'espace, au moins un point).
    if (line.includes(" ") || !line.includes(".")) continue;
    out.add(line);
  }
  return out;
}

/**
 * Canonicalise un e-mail pour la COMPARAISON D'IDENTITÉ et le test de jetabilité.
 *
 * Au-delà du simple `trim + lowercase`, réduit les ALIAS d'un même fournisseur à
 * une forme unique (cf. `ALIAS_PROVIDERS`) :
 *   - retire le `+tag` de la partie locale ;
 *   - retire les `.` de la partie locale pour Gmail/Googlemail (ignorés par Gmail).
 * `Googlemail.com` est rabattu sur `gmail.com`.
 *
 * Exemples :
 *   `U.s.e.r+promo@GMail.com`  → `user@gmail.com`
 *   `user@googlemail.com`      → `user@gmail.com`
 *   `Jean.Dupont@gmail.com`    → `jeandupont@gmail.com`
 *   `client+ys@outlook.com`    → `client@outlook.com` (tag retiré, points gardés)
 *
 * Un e-mail malformé (sans `@`) est renvoyé `trim+lowercase` tel quel (le format
 * est validé en amont par zod ; on ne casse rien ici).
 *
 * ⚠️ NE PAS confondre avec `normaliserEmail` de `lib/referral.ts`, volontairement
 * plus LÉGÈRE (juste trim+lowercase) car elle sert de CLÉ DE STOCKAGE pour
 * `referrals.filleul_email` (on veut y garder l'adresse réelle saisie). Celle-ci
 * est la forme CANONIQUE pour détecter qu'un attaquant réutilise la même boîte.
 */
export function normaliserEmail(email: string): string {
  const lower = email.trim().toLowerCase();
  const at = lower.lastIndexOf("@");
  if (at <= 0) return lower; // pas de @, ou @ en tête → on ne touche pas.

  let local = lower.slice(0, at);
  const domain = lower.slice(at + 1);

  const alias = ALIAS_PROVIDERS[domain];

  // `+tag` : tout fournisseur respectant la convention sub-addressing l'utilise.
  // On le retire systématiquement (gmail, outlook, proton, fastmail…). Sans risque
  // côté faux positif : `+` n'est jamais significatif dans une vraie identité.
  const plus = local.indexOf("+");
  if (plus >= 0) local = local.slice(0, plus);

  if (alias) {
    if (alias.dotsIgnored) local = local.split(".").join("");
    const canonicalLocal = local.length > 0 ? local : lower.slice(0, at); // garde-fou : ne vide jamais le local
    return `${canonicalLocal}@${alias.canonicalDomain}`;
  }

  // Domaine non-alias : on a retiré le `+tag`, on garde le reste tel quel.
  const safeLocal = local.length > 0 ? local : lower.slice(0, at);
  return `${safeLocal}@${domain}`;
}

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
  return getClientIpFromHeaders(request.headers);
}

/**
 * Variante prenant directement un porteur de headers (`Headers`, ou l'objet
 * renvoyé par `next/headers#headers()` dans une Server Action — qui n'a pas de
 * `Request` à portée de main). Même logique que `getClientIp`.
 */
export function getClientIpFromHeaders(
  headers: { get(name: string): string | null },
): string | null {
  const cf = headers.get("CF-Connecting-IP");
  if (cf && cf.trim().length > 0) return cf.trim();

  const xff = headers.get("x-forwarded-for");
  if (xff) {
    // x-forwarded-for = "client, proxy1, proxy2" → on prend la 1re (le client).
    const first = xff.split(",")[0]?.trim();
    if (first && first.length > 0) return first;
  }
  return null;
}

/**
 * Vrai si le domaine de l'e-mail est dans la blocklist des fournisseurs jetables.
 *
 * Le domaine testé est celui de la forme CANONIQUE (`normaliserEmail`) : on rabat
 * `googlemail.com`→`gmail.com` et on neutralise les alias avant le test.
 *
 * La blocklist effective = Set STATIQUE ∪ cache distant (`dynamicBlocklist`). Le
 * cache distant n'est peuplé qu'après un `refreshDisposableBlocklist()` réussi
 * (appelé en tête des chemins de crédit) ; tant qu'il est vide, seul le plancher
 * statique s'applique → JAMAIS fail-open, jamais plus permissif qu'avant.
 *
 * Reste SYNCHRONE (appelée telle quelle par `inviter/route.ts` et les chemins de
 * crédit) : pas d'I/O ici, on lit juste deux Set en mémoire. Robuste casse/espaces.
 * Un e-mail malformé (sans `@`) → jetable=false (le format est validé par zod).
 */
export function isDisposableEmail(email: string): boolean {
  const canonical = normaliserEmail(email);
  const at = canonical.lastIndexOf("@");
  if (at < 0) return false;
  const domain = canonical.slice(at + 1);
  if (!domain) return false;
  return DISPOSABLE_EMAIL_DOMAINS_STATIC.has(domain) || dynamicBlocklist.domains.has(domain);
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
  // Best-effort : rafraîchit la blocklist distante (TTL/in-flight gérés, ne throw
  // jamais). En cas d'échec on retombe sur la Set statique (jamais fail-open).
  await refreshDisposableBlocklist();
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
    log.error("Lecture referrals (R4) échouée", { db: dejaErr.message });
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
    // R2 — limite à 2 comptes par IP : une même maison (colocs / famille,
    // même IP publique) doit pouvoir se parrainer. On REFUSE seulement à partir
    // du 3e compte, soit quand ≥ 2 AUTRES comptes partagent déjà cette IP.
    const { data: ipDup, error: ipErr } = await service
      .from("account_signals")
      .select("user_id")
      .eq("ip_creation", ip)
      .neq("user_id", filleulUserId)
      .limit(2);
    if (ipErr) {
      log.error("Lecture account_signals IP (R2) échouée", { db: ipErr.message });
      return false;
    }
    if (ipDup && ipDup.length >= 2) {
      return false; // R2 : 3e compte (ou +) sur la même IP → suspect.
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
      log.error("Lecture account_signals fingerprint (R3) échouée", {
        db: fpErr.message,
      });
      return false;
    }
    if (fpDup && fpDup.length > 0) {
      return false; // R3 : même empreinte qu'un autre compte → suspect.
    }
  }

  // Toutes les règles passent → crédit autorisé.
  return true;
}

/**
 * Vrai s'il existe un AUTRE compte (≠ `userId`) partageant la même IP de
 * création OU le même fingerprint d'appareil — signe d'un multi-comptes.
 *
 * Mutualise R2 (IP) + R3 (fingerprint) de `canCreditReferral` pour les réutiliser
 * dans l'anti-abus du ticket de bienvenue (même menace : créer 10 faux comptes
 * pour multiplier les essais gratuits).
 *
 * Côté SÛR en cas d'erreur DB : on renvoie `true` (= « doublon présumé » → refus
 * du crédit côté appelant) plutôt que de risquer un abus.
 * Un signal `null` (IP ou fp absent) n'est jamais comparé (pas de faux positif).
 */
async function hasSharedSignals(
  service: SupabaseClient,
  params: { userId: string; ip: string | null; fingerprint: string | null },
): Promise<boolean> {
  const { userId, ip, fingerprint } = params;

  if (ip) {
    const { data: ipDup, error: ipErr } = await service
      .from("account_signals")
      .select("user_id")
      .eq("ip_creation", ip)
      .neq("user_id", userId)
      .limit(1);
    if (ipErr) {
      log.error("Lecture account_signals IP échouée", { db: ipErr.message });
      return true; // côté sûr : on présume le doublon → l'appelant ne crédite pas.
    }
    if (ipDup && ipDup.length > 0) return true;
  }

  if (fingerprint) {
    const { data: fpDup, error: fpErr } = await service
      .from("account_signals")
      .select("user_id")
      .eq("device_fingerprint", fingerprint)
      .neq("user_id", userId)
      .limit(1);
    if (fpErr) {
      log.error("Lecture account_signals fingerprint échouée", {
        db: fpErr.message,
      });
      return true;
    }
    if (fpDup && fpDup.length > 0) return true;
  }

  return false;
}

/** Paramètres de la décision d'octroi du ticket de bienvenue. */
export interface CanGrantWelcomeParams {
  /** Id du compte qui vient de compléter l'onboarding. */
  userId: string;
  /** E-mail du compte (pour le test « jetable »). */
  email: string;
  /** IP de création / d'onboarding (peut être null si non captée). */
  ip: string | null;
  /** Empreinte d'appareil hashée (peut être null en server action). */
  fingerprint: string | null;
}

/**
 * Décide si on PEUT octroyer le ticket de bienvenue (« 1ère séance offerte »).
 *
 * Mêmes signaux que le parrainage (e-mail jetable + IP/fingerprint partagés),
 * SANS la règle R4 (propre au parrainage). L'idempotence stricte « 1 ticket
 * bienvenue par compte » est garantie AILLEURS (flag profil
 * `welcome_ticket_granted_at` + index unique partiel DB), pas ici : cette
 * fonction ne se prononce QUE sur le risque d'abus multi-comptes.
 *
 *   (W1) E-mail jetable        — inscription opportuniste, pas un vrai prospect.
 *   (W2) IP partagée           — un AUTRE compte créé depuis la même IP.
 *   (W3) Fingerprint partagé   — un AUTRE compte avec la même empreinte.
 *
 * ÉCHEC SILENCIEUX : l'appelant ne crédite pas et ne révèle JAMAIS la raison
 * (comme le parrainage). En cas d'erreur DB → côté sûr (refus).
 *
 * @param service client Supabase service_role (bypass RLS — on inspecte d'AUTRES
 *                comptes que celui-ci, ce que la RLS interdirait).
 */
export async function canGrantWelcomeTicket(
  service: SupabaseClient,
  { userId, email, ip, fingerprint }: CanGrantWelcomeParams,
): Promise<boolean> {
  // ── W1 : e-mail jetable ────────────────────────────────────────────────────
  // Best-effort : rafraîchit la blocklist distante (fallback Set statique si KO).
  await refreshDisposableBlocklist();
  if (isDisposableEmail(email)) {
    return false;
  }

  // ── W2 & W3 : IP / fingerprint partagés avec un AUTRE compte ───────────────
  if (await hasSharedSignals(service, { userId, ip, fingerprint })) {
    return false;
  }

  return true;
}
