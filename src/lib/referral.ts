/**
 * Logique métier du PARRAINAGE (V2b) — partagée par les routes API et le
 * callback d'authentification.
 *
 * Responsabilités :
 *   - générer / résoudre le code de parrainage d'un membre (parrain) ;
 *   - enregistrer les signaux anti-abus (IP / fingerprint) d'un compte ;
 *   - compléter un referral et créditer 1 ticket au parrain — SOUS RÉSERVE de
 *     l'anti-abus (canCreditReferral). En cas de refus → SILENCIEUX (le
 *     referral reste 'pending', aucun ticket, aucune erreur révélatrice).
 *
 * Tout passe par la `service_role` (bypass RLS) : on écrit au nom du système
 * (créditer un AUTRE user que l'appelant, lire les signaux d'autres comptes).
 *
 * Runtime edge (Cloudflare Workers) : fetch + Web Crypto uniquement.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ ANTI-FARMING (2026-06-19) — LE CRÉDIT N'EST PLUS DÉCLENCHÉ À L'INSCRIPTION │
 * │                                                                           │
 * │ Avant : `completerReferral` créditait le parrain dès que le filleul       │
 * │ s'inscrivait (callback auth / POST /completer). Farmable : il suffisait    │
 * │ de créer de faux comptes (ou de faire (re)cliquer des comptes EXISTANTS)  │
 * │ pour récolter des tickets sans aucune acquisition réelle.                  │
 * │                                                                           │
 * │ Maintenant : à l'inscription, `completerReferral` se contente de LIER le  │
 * │ filleul au parrain en `pending` (referral créé/rattaché, AUCUN ticket).   │
 * │ Le crédit (1 ticket au parrain) n'a lieu qu'au moment où le filleul a sa  │
 * │ 1re séance réellement HONORÉE (`bookings.attendance='attended'`, pointée  │
 * │ par Alice), via `crediterParrainsApresSeanceHonoree` appelée depuis la     │
 * │ route admin attendance. Un faux compte / un compte existant qui ne vient   │
 * │ jamais en cours ne rapporte donc RIEN. C'est le levier qui tue le farming. │
 * │                                                                           │
 * │ L'anti-abus (canCreditReferral : email jetable, IP/fp partagés, R4) +     │
 * │ le plafond (maxParrainagesCredites) + l'idempotence + la compensation de  │
 * │ course sont RÉ-ÉVALUÉS au moment du crédit (signaux account_signals déjà   │
 * │ persistés), pas à l'inscription → durcissement, pas de régression.         │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { canCreditReferral } from "@/lib/anti-abuse";
import { PARRAINAGE_MAX_DEFAUT } from "@/lib/referral-config";
import { sanitizeRefCode } from "@/lib/ref-code";
import {
  getUserGclid,
  recordAdsConversion,
  FREE_TICKET_VALUE_EUR,
} from "@/lib/ads-attribution";
import { createLogger } from "@/lib/log";

const log = createLogger("referral");

/**
 * Résout le PRÉNOM du parrain à partir d'un code de parrainage — pour la landing
 * d'invitation `/invitation?ref=<CODE>` (« {Prénom} vous a invité… »).
 *
 * Garde-fous (SÉCURITÉ / VIE PRIVÉE) :
 *   - Le `code` est SANITISÉ (sanitizeRefCode) : format strict 8 chars de
 *     l'alphabet non ambigu, MAJUSCULES. Tout code hors-norme → `null` (on ne
 *     lance même pas la requête).
 *   - SELECT BORNÉ à `full_name` UNIQUEMENT : on n'expose JAMAIS l'e-mail, le
 *     téléphone, l'id ni aucune autre PII du parrain via cette route publique.
 *   - On ne renvoie que le PREMIER token du nom (le prénom), pas le nom complet.
 *   - Code inconnu, profil sans nom, ou erreur DB → `null` (la landing affiche
 *     alors son titre de repli « Vous avez été invité(e)… »). Best-effort : ne
 *     throw jamais (une page publique ne doit pas planter sur un lookup raté).
 *
 * @param service client `service_role` (bypass RLS) — la route est publique, la
 *                table profiles est sous RLS ; on lit au nom du système, borné au
 *                seul champ `full_name`.
 * @param rawCode valeur brute du paramètre `?ref=` (non fiable).
 * @returns le prénom du parrain, ou `null`.
 */
export async function prenomParrainParCode(
  service: SupabaseClient,
  rawCode: string | null | undefined,
): Promise<string | null> {
  const code = sanitizeRefCode(rawCode);
  if (!code) return null;

  try {
    const { data, error } = await service
      .from("profiles")
      // ⚠️ Champ unique : full_name. Ne JAMAIS élargir ce select (pas d'email/tel).
      .select("full_name")
      .eq("referral_code", code)
      .maybeSingle();

    if (error) {
      log.error("Résolution prénom parrain échouée", { db: error.message });
      return null;
    }

    const fullName =
      typeof data?.full_name === "string" ? data.full_name.trim() : "";
    if (!fullName) return null;

    // Premier token = prénom (on ne renvoie pas le nom de famille).
    const prenom = fullName.split(/\s+/)[0] ?? "";
    return prenom || null;
  } catch (err) {
    // Page PUBLIQUE : un lookup raté ne doit jamais la faire planter en 500.
    log.error("Exception résolution prénom parrain", {
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Vue PUBLIQUE d'un parrain pour la landing d'invitation — prénom + avatar +
 * e-mail. Tout champ est `null` quand il est absent (best-effort).
 */
export interface ParrainPublic {
  /** Premier token du nom complet (le prénom seul, jamais le nom de famille). */
  prenom: string | null;
  /** Photo de profil OAuth (Google/Microsoft), image distante. `null` sinon. */
  avatarUrl: string | null;
  /** E-mail COMPLET du parrain — affichage validé par Robert (cf. ticket). */
  email: string | null;
}

/**
 * Résout les infos PUBLIQUES du parrain (prénom + avatar + e-mail) à partir d'un
 * code de parrainage — pour la landing `/invitation?ref=<CODE>` enrichie (avatar
 * + prénom + e-mail du parrain).
 *
 * Décision Robert (2026-06-19) : l'e-mail COMPLET est affiché en clair. Le
 * parrain partage son lien volontairement à des gens qu'il connaît → e-mail
 * assumé. (Reste à surveiller l'énumération de codes côté sécu — rate limiting
 * éventuel sur /invitation, cf. ticket passe-sécurité — NON traité ici.)
 *
 * Garde-fous (SÉCURITÉ / VIE PRIVÉE) :
 *   - `code` SANITISÉ (sanitizeRefCode) : 8 chars de l'alphabet non ambigu,
 *     MAJUSCULES. Hors-norme → tout `null` (aucune requête lancée).
 *   - On n'expose QUE prénom + avatar + e-mail. JAMAIS le téléphone, l'id, ni
 *     aucune autre PII. Le prénom = 1er token de `full_name`.
 *   - L'avatar vient des claims OAuth dans `auth.users.raw_user_meta_data`
 *     (`avatar_url` puis `picture`), lu via l'Admin API (getUserById) — la
 *     table profiles ne le stocke pas. L'e-mail vient de `profiles.email`
 *     (fallback `user.email`).
 *   - Best-effort TOTAL : code inconnu, profil introuvable, erreur DB ou Admin
 *     → champs à `null`, ne throw JAMAIS (page publique : pas de 500).
 *
 * @param service client `service_role` (bypass RLS + Admin API). La route est
 *                publique ; on lit au nom du système, borné aux 3 champs publics.
 * @param rawCode valeur brute du paramètre `?ref=` (non fiable).
 */
export async function parrainPublicParCode(
  service: SupabaseClient,
  rawCode: string | null | undefined,
): Promise<ParrainPublic> {
  const vide: ParrainPublic = { prenom: null, avatarUrl: null, email: null };

  const code = sanitizeRefCode(rawCode);
  if (!code) return vide;

  try {
    const { data, error } = await service
      .from("profiles")
      // Borné : id (pour l'Admin API), full_name (prénom), email. Pas de tél.
      .select("id, full_name, email")
      .eq("referral_code", code)
      .maybeSingle();

    if (error) {
      log.error("Résolution parrain public échouée", { db: error.message });
      return vide;
    }
    const parrainId = typeof data?.id === "string" ? data.id : null;
    if (!parrainId) return vide; // code inconnu / aucun profil.

    // Prénom = 1er token du nom complet (jamais le nom de famille).
    const fullName =
      typeof data?.full_name === "string" ? data.full_name.trim() : "";
    const prenom = fullName ? (fullName.split(/\s+/)[0] ?? "") || null : null;

    // E-mail : profiles.email (peut être enrichi par user.email plus bas).
    let email =
      typeof data?.email === "string" && data.email.trim()
        ? data.email.trim()
        : null;

    // Avatar : claims OAuth dans auth.users.raw_user_meta_data, via Admin API.
    // Best-effort : toute erreur ici NE doit pas annuler prénom/e-mail déjà
    // résolus → on garde le reste, avatar à null.
    let avatarUrl: string | null = null;
    try {
      const { data: userData, error: adminErr } =
        await service.auth.admin.getUserById(parrainId);
      if (adminErr) {
        log.error("getUserById parrain échoué", { db: adminErr.message });
      } else {
        const meta = userData?.user?.user_metadata as
          | Record<string, unknown>
          | undefined;
        const candidate =
          (typeof meta?.avatar_url === "string" && meta.avatar_url) ||
          (typeof meta?.picture === "string" && meta.picture) ||
          null;
        // On n'accepte qu'une URL http(s) — défense minimale contre une valeur
        // de claim douteuse (pas de data:/javascript: dans un src d'image).
        avatarUrl =
          candidate && /^https?:\/\//i.test(candidate) ? candidate : null;
        // Fallback e-mail si profiles.email était vide.
        if (!email && typeof userData?.user?.email === "string") {
          email = userData.user.email.trim() || null;
        }
      }
    } catch (adminEx) {
      log.error("Exception getUserById parrain", {
        err: adminEx instanceof Error ? adminEx.message : String(adminEx),
      });
    }

    return { prenom, avatarUrl, email };
  } catch (err) {
    // Page PUBLIQUE : un lookup raté ne doit jamais la faire planter en 500.
    log.error("Exception résolution parrain public", {
      err: err instanceof Error ? err.message : String(err),
    });
    return vide;
  }
}

/**
 * Plafond EFFECTIF de parrainages crédités par parrain (anti-farming).
 *
 * Lit la surcharge d'environnement `REFERRAL_MAX_CREDITS` si elle est un entier
 * positif valide, sinon retombe sur le défaut métier (`PARRAINAGE_MAX_DEFAUT`).
 * Permet d'ajuster le plafond (durcir / desserrer) sans redéploiement de code.
 *
 * C'est la SEULE source de vérité du plafond appliqué au crédit (cf.
 * `completerReferral`). Les écrans UI n'utilisent que le défaut comme repère.
 */
export function maxParrainagesCredites(): number {
  const brut = process.env.REFERRAL_MAX_CREDITS;
  if (brut !== undefined) {
    const n = Number.parseInt(brut, 10);
    // On n'accepte qu'un entier strictement positif ; toute valeur douteuse
    // (vide, négative, non numérique) → on garde le défaut sûr.
    if (Number.isInteger(n) && n > 0) return n;
  }
  return PARRAINAGE_MAX_DEFAUT;
}

/**
 * Alphabet du code de parrainage : sans caractères ambigus (pas de 0/O, 1/I/L)
 * pour qu'un humain puisse le dicter / recopier sans erreur.
 */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

/**
 * Génère un code de parrainage aléatoire (Web Crypto, edge-safe).
 * Format : 8 caractères de l'alphabet non ambigu (~40 bits d'entropie).
 */
export function genererCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

/** Normalise un e-mail (trim + minuscules) pour comparaison / stockage. */
export function normaliserEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Récupère le code de parrainage d'un membre, en le générant et le persistant
 * sur son profil s'il n'en a pas encore (idempotent).
 *
 * Gère la collision (improbable) sur l'index unique `profiles.referral_code` :
 * en cas de conflit, on régénère et on retente quelques fois.
 *
 * @returns le code, ou `null` si l'écriture échoue durablement.
 */
export async function getOrCreateCode(
  service: SupabaseClient,
  userId: string,
): Promise<string | null> {
  // 1) Le profil a-t-il déjà un code ?
  const { data: profile, error: readErr } = await service
    .from("profiles")
    .select("referral_code")
    .eq("id", userId)
    .maybeSingle();

  if (readErr) {
    log.error("Lecture profile échouée", { user_id: userId, db: readErr.message });
    return null;
  }
  if (profile?.referral_code) {
    return profile.referral_code as string;
  }

  // 2) Pas de code → on en génère un et on l'écrit (retry sur collision unique).
  const PG_UNIQUE_VIOLATION = "23505";
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = genererCode();
    const { error: updErr } = await service
      .from("profiles")
      .update({ referral_code: code })
      .eq("id", userId)
      // Garde anti-écrasement concurrent : on n'écrit que si encore vide.
      .is("referral_code", null);

    if (!updErr) {
      // Update OK (ou 0 ligne car un appel concurrent a posé un code juste
      // avant) → on relit pour renvoyer le code effectivement en base.
      const { data: after } = await service
        .from("profiles")
        .select("referral_code")
        .eq("id", userId)
        .maybeSingle();
      if (after?.referral_code) return after.referral_code as string;
      continue; // improbable : on retente.
    }

    if (updErr.code === PG_UNIQUE_VIOLATION) {
      // Collision de code (déjà pris par un autre profil) → on régénère.
      continue;
    }
    log.error("Écriture referral_code échouée", {
      user_id: userId,
      db: updErr.message,
    });
    return null;
  }
  log.error("Impossible de générer un code unique après 5 essais", {
    user_id: userId,
  });
  return null;
}

/**
 * Enregistre (upsert) les signaux anti-abus d'un compte à l'inscription.
 * - PK = user_id → un seul jeu de signaux par compte (celui de la création).
 * - On ne fait PAS de merge agressif : on pose ip/fingerprint si fournis,
 *   sans écraser une valeur déjà présente par un `null` (cas où le fingerprint
 *   arrive dans un 2e appel après l'IP captée au callback).
 *
 * Best-effort : on log en cas d'échec mais on ne fait pas planter le flux
 * d'authentification pour ça.
 */
export async function enregistrerSignaux(
  service: SupabaseClient,
  params: { userId: string; ip?: string | null; fingerprint?: string | null },
): Promise<void> {
  const { userId, ip, fingerprint } = params;

  // On lit l'existant pour ne pas écraser un champ déjà rempli avec un null.
  const { data: existing } = await service
    .from("account_signals")
    .select("ip_creation, device_fingerprint")
    .eq("user_id", userId)
    .maybeSingle();

  const row: Record<string, unknown> = { user_id: userId };
  row.ip_creation = ip ?? existing?.ip_creation ?? null;
  row.device_fingerprint =
    fingerprint ?? existing?.device_fingerprint ?? null;

  const { error } = await service
    .from("account_signals")
    .upsert(row, { onConflict: "user_id" });

  if (error) {
    log.error("Upsert account_signals échoué", {
      user_id: userId,
      db: error.message,
    });
  }
}

/**
 * Crédite 1 ticket de parrainage au parrain. Type 'collectif' (cours collectif
 * = le levier d'acquisition ; un particulier serait disproportionné en cadeau).
 * Idempotence assurée par l'appelant via le flag `ticket_credite` du referral.
 */
async function crediterTicketParrain(
  service: SupabaseClient,
  parrainUserId: string,
): Promise<boolean> {
  const { error } = await service.from("tickets").insert({
    user_id: parrainUserId,
    type: "collectif",
    quantite_initiale: 1,
    quantite_restante: 1,
    source: "referral", // traçabilité d'origine (cf migration 0009).
    // Pas de stripe_* : c'est un ticket offert (parrainage), pas un achat.
    // expires_at null = pas d'expiration imposée au cadeau.
  });
  if (error) {
    log.error("Insert ticket parrainage échoué", {
      parrain_user_id: parrainUserId,
      db: error.message,
    });
    return false;
  }
  return true;
}

/**
 * Résultat de `completerReferral` (volontairement non révélateur).
 *
 * ⚠️ Depuis le durcissement anti-farming (2026-06-19), `completerReferral` NE
 * CRÉDITE PLUS à l'inscription → `credited` y vaut TOUJOURS `false`. Le champ
 * est conservé pour la stabilité du contrat appelant ; le crédit réel se mesure
 * au moment de la séance honorée (cf. `crediterParrainsApresSeanceHonoree`).
 * `linked` indique seulement si le filleul a bien été rattaché au parrain
 * (referral pending posé) — utile au tracking interne, jamais exposé au client.
 */
export type CompleteResult = {
  /** TOUJOURS false à l'inscription (le crédit est déféré à la séance honorée). */
  credited: false;
  /** True si le filleul a été rattaché au parrain (referral pending posé). */
  linked: boolean;
};

/**
 * Lie le filleul qui vient de s'inscrire (cookie `ys_ref`) à son parrain — SANS
 * créditer. Le crédit est DÉFÉRÉ à la 1re séance honorée du filleul (anti-farming,
 * cf. en-tête de module + `crediterParrainsApresSeanceHonoree`).
 *
 * ÉTAPES :
 *   1. Résoudre le parrain via le code (profiles.referral_code). Code inconnu
 *      → on s'arrête (linked:false), silencieux.
 *   2. Garde anti-auto-parrainage trivial : un user ne se parraine pas lui-même.
 *   3. Rattacher (ou créer) le referral en `pending` avec `filleul_user_id`,
 *      `ticket_credite=false`. AUCUN ticket n'est crédité ici, AUCUN anti-abus
 *      n'est évalué (il le sera au crédit, sur signaux persistés) — on se
 *      contente de poser le lien pour qu'il existe au moment de la séance.
 *
 * Idempotent : rejouer /completer ne re-crée pas de doublon (unique
 * (parrain,email) + `ticket_credite` jamais touché ici).
 *
 * ⚠️ Quelle que soit l'issue, l'APPELANT doit répondre de façon NEUTRE au
 * client : ce booléen n'est jamais exposé tel quel à l'UI du filleul.
 */
export async function completerReferral(
  service: SupabaseClient,
  params: {
    code: string;
    filleulUserId: string;
    filleulEmail: string;
    ip: string | null;
    fingerprint: string | null;
  },
): Promise<CompleteResult> {
  const code = params.code.trim().toUpperCase();
  if (!code) return { credited: false, linked: false };

  // 1) Résoudre le parrain via son code.
  const { data: parrainProfile, error: parrainErr } = await service
    .from("profiles")
    .select("id")
    .eq("referral_code", code)
    .maybeSingle();

  if (parrainErr) {
    log.error("Résolution code parrain échouée", { db: parrainErr.message });
    return { credited: false, linked: false };
  }
  if (!parrainProfile?.id) {
    // Code inconnu → silencieux.
    return { credited: false, linked: false };
  }
  const parrainUserId = parrainProfile.id as string;

  // 2) Un user ne se parraine pas lui-même.
  if (parrainUserId === params.filleulUserId) {
    return { credited: false, linked: false };
  }

  // 3) Rattacher le filleul en pending (le crédit viendra à la séance honorée).
  //    On NE crédite PAS, on NE fait PAS l'anti-abus ici (déféré au crédit, sur
  //    signaux persistés) : on pose juste le lien parrain↔filleul.
  await lierFilleulSansCrediter(service, {
    parrainUserId,
    code,
    filleulUserId: params.filleulUserId,
    filleulEmail: params.filleulEmail,
  });

  return { credited: false, linked: true };
}

/**
 * Crédite les PARRAINS dont `filleulUserId` est le filleul, dès lors que ce
 * filleul a une 1re séance réellement HONORÉE (`bookings.attendance='attended'`).
 * Appelée depuis la route admin attendance au moment où Alice pointe « présent ».
 *
 * C'est ICI que tombe le ticket de parrainage (plus à l'inscription) : un faux
 * compte / un compte existant qui ne vient jamais en cours ne sera jamais pointé
 * présent → le parrain n'est jamais crédité (anti-farming, cf. en-tête).
 *
 * Pour chaque referral `pending` non encore crédité liant ce filleul :
 *   - ré-évalue l'anti-abus (canCreditReferral, signaux persistés) + le plafond ;
 *   - crédite 1 ticket au parrain, marque le referral completed/credité ;
 *   - idempotent (le `.eq('ticket_credite', false)` du marquage garantit un seul
 *     crédit, même si l'attendance est repointée plusieurs fois) ;
 *   - best-effort : ne throw JAMAIS (un échec de crédit ne doit pas faire échouer
 *     le pointage de présence d'Alice). Toute erreur est loggée.
 *
 * @returns le nombre de referrals effectivement crédités (≥ 0).
 */
export async function crediterParrainsApresSeanceHonoree(
  service: SupabaseClient,
  filleulUserId: string,
): Promise<number> {
  if (!filleulUserId) return 0;

  try {
    // Referrals où ce user est filleul, en attente de crédit. En théorie au plus
    // un (unique (parrain,email) + R4 = 1 crédit/filleul à vie), mais on boucle
    // par robustesse (un même filleul a pu être lié par plusieurs parrains avant
    // qu'un crédit ne soit posé ; R4 tranchera au crédit).
    const { data: pendings, error: listErr } = await service
      .from("referrals")
      .select("id, parrain_user_id, filleul_email")
      .eq("filleul_user_id", filleulUserId)
      .eq("ticket_credite", false)
      .eq("status", "pending");

    if (listErr) {
      log.error("Liste referrals pending du filleul échouée", {
        filleul_user_id: filleulUserId,
        db: listErr.message,
      });
      return 0;
    }
    const rows = (pendings ?? []) as Array<{
      id: string;
      parrain_user_id: string;
      filleul_email: string;
    }>;
    if (rows.length === 0) return 0;

    // Signaux persistés du filleul (IP/fingerprint posés à l'inscription) :
    // servent à ré-évaluer l'anti-abus AU CRÉDIT (pas de Request ici, c'est
    // Alice qui pointe). Best-effort : absents → null (R2/R3 skippées, comme
    // pour un compte sans signal).
    const { ip: filleulIp, fingerprint: filleulFp } = await lireSignauxFilleul(
      service,
      filleulUserId,
    );

    let credites = 0;
    for (const ref of rows) {
      // Garde anti-auto (défense en profondeur : déjà filtré à la liaison).
      if (ref.parrain_user_id === filleulUserId) continue;

      const ok = await crediterReferralPending(service, {
        referralId: ref.id,
        parrainUserId: ref.parrain_user_id,
        filleulUserId,
        filleulEmail: ref.filleul_email,
        ip: filleulIp,
        fingerprint: filleulFp,
      });
      if (ok) credites += 1;
    }
    return credites;
  } catch (err) {
    // Best-effort absolu : le pointage de présence ne doit jamais échouer pour ça.
    log.error("Exception crédit parrains après séance honorée", {
      filleul_user_id: filleulUserId,
      err: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}

/** Lit les signaux anti-abus persistés d'un filleul (IP + fingerprint). */
async function lireSignauxFilleul(
  service: SupabaseClient,
  filleulUserId: string,
): Promise<{ ip: string | null; fingerprint: string | null }> {
  try {
    const { data } = await service
      .from("account_signals")
      .select("ip_creation, device_fingerprint")
      .eq("user_id", filleulUserId)
      .maybeSingle();
    return {
      ip: (data?.ip_creation as string | null) ?? null,
      fingerprint: (data?.device_fingerprint as string | null) ?? null,
    };
  } catch {
    return { ip: null, fingerprint: null };
  }
}

/**
 * Crédite UN referral pending donné (anti-abus + plafond + ticket + marquage
 * idempotent + attribution Ads + compensation de course). Cœur partagé du crédit
 * de parrainage, appelé désormais UNIQUEMENT depuis le déclencheur « séance
 * honorée » (`crediterParrainsApresSeanceHonoree`).
 *
 * @returns `true` si un ticket a été crédité, `false` sinon (anti-abus, plafond,
 *          déjà crédité, erreur DB — toujours SÛR/silencieux).
 */
async function crediterReferralPending(
  service: SupabaseClient,
  params: {
    referralId: string;
    parrainUserId: string;
    filleulUserId: string;
    filleulEmail: string;
    ip: string | null;
    fingerprint: string | null;
  },
): Promise<boolean> {
  const { referralId, parrainUserId, filleulUserId } = params;

  // 1) Anti-abus — refus SILENCIEUX (laisse le referral pending, jamais crédité).
  const ok = await canCreditReferral(service, {
    filleulUserId,
    filleulEmail: params.filleulEmail,
    ip: params.ip,
    fingerprint: params.fingerprint,
  });
  if (!ok) return false;

  // 2) PLAFOND (anti-farming) : un parrain est crédité au maximum
  //    `maxParrainagesCredites()` fois (1 ticket par filleul). Plafond
  //    configurable via `REFERRAL_MAX_CREDITS` (défaut métier 3).
  const plafond = maxParrainagesCredites();
  const { count: dejaCredites, error: countErr } = await service
    .from("referrals")
    .select("id", { count: "exact", head: true })
    .eq("parrain_user_id", parrainUserId)
    .eq("ticket_credite", true);
  if (countErr) {
    log.error("Comptage plafond parrain échoué", {
      parrain_user_id: parrainUserId,
      db: countErr.message,
    });
    return false;
  }
  if ((dejaCredites ?? 0) >= plafond) {
    // Plafond atteint : on ne crédite plus, le referral reste pending.
    return false;
  }

  // 3) Créditer le ticket au parrain, PUIS marquer le referral (ordre choisi
  //    pour ne jamais marquer « crédité » sans ticket réel). On verrouille la
  //    marque par `ticket_credite = false` pour rester idempotent face à un
  //    appel concurrent (deux pointages simultanés → une seule passe).
  const credited = await crediterTicketParrain(service, parrainUserId);
  if (!credited) return false;

  // ── ATTRIBUTION ADS — VALEUR FILLEUL (intérêts composés). ───────────────────
  // Un filleul vient d'être validé (séance honorée) : on attribue sa valeur au
  // gclid du PARRAIN (s'il vient de l'Ads). Idempotent sur referralId. Best-effort.
  {
    const parrainGclid = await getUserGclid(service, parrainUserId);
    await recordAdsConversion(service, {
      userId: parrainUserId,
      kind: "referral_value",
      sourceRef: referralId,
      gclid: parrainGclid,
      valueEur: FREE_TICKET_VALUE_EUR,
    });
  }

  const { data: marked, error: markErr } = await service
    .from("referrals")
    .update({
      status: "completed",
      ticket_credite: true,
      filleul_user_id: filleulUserId,
      completed_at: new Date().toISOString(),
    })
    .eq("id", referralId)
    .eq("ticket_credite", false) // garde d'idempotence concurrente.
    .select("id")
    .maybeSingle();

  if (markErr) {
    log.error("Marquage referral completed échoué", {
      referral_id: referralId,
      parrain_user_id: parrainUserId,
      db: markErr.message,
    });
    // Le ticket est déjà inséré : on log, mais on considère le crédit fait.
    return true;
  }
  if (!marked) {
    // Un appel concurrent a déjà marqué ce referral entre-temps → on vient de
    // créer un ticket en doublon. Compensation : on le retire (best-effort).
    log.warn("Course détectée sur le marquage — rollback du ticket doublon", {
      referral_id: referralId,
      parrain_user_id: parrainUserId,
    });
    await retirerDernierTicketParrainage(service, parrainUserId);
    return false;
  }

  return true;
}

/**
 * Rattache un filleul à un referral pending existant (ou en crée un en pending)
 * SANS créditer. C'est désormais le chemin NOMINAL à l'inscription (le crédit est
 * déféré à la séance honorée), et aussi le filet de traçabilité. Best-effort,
 * silencieux : ne crédite jamais, ne touche jamais `ticket_credite`.
 */
async function lierFilleulSansCrediter(
  service: SupabaseClient,
  params: {
    parrainUserId: string;
    code: string;
    filleulUserId: string;
    filleulEmail: string;
  },
): Promise<void> {
  const filleulEmail = normaliserEmail(params.filleulEmail);
  const { data: pending } = await service
    .from("referrals")
    .select("id")
    .eq("parrain_user_id", params.parrainUserId)
    .eq("filleul_email", filleulEmail)
    .maybeSingle();

  if (pending?.id) {
    await service
      .from("referrals")
      .update({ filleul_user_id: params.filleulUserId })
      .eq("id", pending.id);
    return;
  }

  // Création best-effort (peut échouer sur l'unique (parrain,email) en course :
  // on ignore, c'est purement de la traçabilité).
  await service.from("referrals").insert({
    parrain_user_id: params.parrainUserId,
    filleul_email: filleulEmail,
    filleul_user_id: params.filleulUserId,
    code: params.code,
    status: "pending",
  });
}

/**
 * Compensation de la course du point 6 : retire le ticket de parrainage qu'on
 * vient de créer en doublon (offert, non consommé). On cible le plus récent
 * ticket collectif offert (sans stripe) du parrain, quantite_restante=1.
 */
async function retirerDernierTicketParrainage(
  service: SupabaseClient,
  parrainUserId: string,
): Promise<void> {
  const { data: candidate } = await service
    .from("tickets")
    .select("id")
    .eq("user_id", parrainUserId)
    .eq("type", "collectif")
    .is("stripe_session_id", null)
    .eq("quantite_restante", 1)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (candidate?.id) {
    await service.from("tickets").delete().eq("id", candidate.id);
  }
}
