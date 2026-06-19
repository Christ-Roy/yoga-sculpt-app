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
 * TODO (post-V2b, décision Robert) : conditionner le crédit du ticket de
 * parrainage à la publication d'un AVIS Google par le filleul (et non au seul
 * fait de s'inscrire). À brancher ici, dans `completerReferral`, comme garde
 * supplémentaire avant `crediterTicketParrain` — NE PAS implémenter maintenant.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { canCreditReferral } from "@/lib/anti-abuse";
import { PARRAINAGE_MAX_DEFAUT } from "@/lib/referral-config";
import { createLogger } from "@/lib/log";

const log = createLogger("referral");

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

/** Résultat de `completerReferral` (volontairement non révélateur). */
export type CompleteResult =
  | { credited: true } // un ticket a été crédité au parrain.
  | { credited: false }; // rien crédité (pas de referral, ou anti-abus, ou déjà fait).

/**
 * Complète le parrainage d'un filleul qui vient de s'inscrire avec un `code`.
 *
 * ÉTAPES :
 *   1. Résoudre le parrain via le code (profiles.referral_code). Code inconnu
 *      → on s'arrête (credited:false), silencieux.
 *   2. Garde anti-auto-parrainage trivial : un user ne se parraine pas lui-même.
 *   3. Anti-abus : canCreditReferral (IP / fingerprint / email jetable / déjà
 *      crédité). Refus → credited:false, SILENCIEUX (referral laissé pending).
 *   4. Trouver/lier le referral : on rattache un referral pending existant
 *      (invitation par e-mail) si présent, sinon on en crée un (cas « code
 *      partagé par lien », sans invitation e-mail préalable).
 *   5. Idempotence : si ce referral est déjà ticket_credite → credited:false.
 *   6. Créditer le ticket au parrain + marquer le referral completed/credité.
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
  if (!code) return { credited: false };

  // 1) Résoudre le parrain via son code.
  const { data: parrainProfile, error: parrainErr } = await service
    .from("profiles")
    .select("id")
    .eq("referral_code", code)
    .maybeSingle();

  if (parrainErr) {
    log.error("Résolution code parrain échouée", { db: parrainErr.message });
    return { credited: false };
  }
  if (!parrainProfile?.id) {
    // Code inconnu → silencieux.
    return { credited: false };
  }
  const parrainUserId = parrainProfile.id as string;

  // 2) Un user ne se parraine pas lui-même.
  if (parrainUserId === params.filleulUserId) {
    return { credited: false };
  }

  // 3) Anti-abus — refus SILENCIEUX. On laisse tout referral éventuel en pending.
  const ok = await canCreditReferral(service, {
    filleulUserId: params.filleulUserId,
    filleulEmail: params.filleulEmail,
    ip: params.ip,
    fingerprint: params.fingerprint,
  });
  if (!ok) {
    // On rattache quand même le filleul à un referral pending existant (pour la
    // traçabilité côté parrain : « invité, inscrit, mais non validé »), sans
    // jamais créditer ni révéler la raison.
    await lierFilleulSansCrediter(service, {
      parrainUserId,
      code,
      filleulUserId: params.filleulUserId,
      filleulEmail: params.filleulEmail,
    });
    return { credited: false };
  }

  // 4) Trouver un referral pending (invitation par e-mail) sinon en créer un.
  const filleulEmail = normaliserEmail(params.filleulEmail);
  const { data: pending } = await service
    .from("referrals")
    .select("id, ticket_credite")
    .eq("parrain_user_id", parrainUserId)
    .eq("filleul_email", filleulEmail)
    .maybeSingle();

  let referralId: string | null = pending?.id ?? null;

  // 5) Idempotence : déjà crédité → on ne refait rien.
  if (pending?.ticket_credite) {
    return { credited: false };
  }

  if (!referralId) {
    // Pas d'invitation préalable (le filleul a juste suivi un lien `?ref=CODE`).
    // On crée le referral à la volée.
    const { data: created, error: createErr } = await service
      .from("referrals")
      .insert({
        parrain_user_id: parrainUserId,
        filleul_email: filleulEmail,
        filleul_user_id: params.filleulUserId,
        code,
        status: "pending",
      })
      .select("id")
      .single();
    if (createErr || !created) {
      log.error("Création referral à la volée échouée", {
        parrain_user_id: parrainUserId,
        filleul_user_id: params.filleulUserId,
        db: createErr?.message,
      });
      return { credited: false };
    }
    referralId = created.id as string;
  }

  // 5bis) PLAFOND (anti-farming) : un parrain est crédité au maximum
  // `maxParrainagesCredites()` fois (1 ticket par filleul). Au-delà, on lie le
  // filleul pour la traçabilité mais on ne crédite plus. Plafond configurable via
  // `REFERRAL_MAX_CREDITS` (défaut métier 3). (count exact via head:true)
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
    return { credited: false };
  }
  if ((dejaCredites ?? 0) >= plafond) {
    // Plafond atteint : on ne crédite plus, mais le filleul reste rattaché.
    return { credited: false };
  }

  // TODO(anti-abus): créditer après la 1ère séance HONORÉE du filleul (booking
  // passé + bookings.attendance='attended') plutôt qu'à l'inscription (cf. todo
  // 2026-06-19-qa-secu-parrainage-anti-abus-farmable, levier 1). C'est le levier
  // qui tue le farming (un faux compte ne va pas en cours), mais il déplace le
  // déclencheur du crédit vers le cron d'attendance → recâblage non trivial,
  // laissé hors de ce commit pour ne pas fragiliser le flux d'inscription.

  // 6) Créditer le ticket au parrain, PUIS marquer le referral (ordre choisi
  // pour ne jamais marquer « crédité » sans ticket réel). On verrouille la
  // marque par `ticket_credite = false` pour rester idempotent face à un appel
  // concurrent (deux complétions simultanées → une seule passe).
  const credited = await crediterTicketParrain(service, parrainUserId);
  if (!credited) {
    return { credited: false };
  }

  const { data: marked, error: markErr } = await service
    .from("referrals")
    .update({
      status: "completed",
      ticket_credite: true,
      filleul_user_id: params.filleulUserId,
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
    return { credited: true };
  }
  if (!marked) {
    // Un appel concurrent a déjà marqué ce referral entre-temps → on vient de
    // créer un ticket en doublon. Compensation : on le retire (best-effort).
    // (Cas extrêmement rare ; on préfère recréditer juste 1 ticket.)
    log.warn("Course détectée sur le marquage — rollback du ticket doublon", {
      referral_id: referralId,
      parrain_user_id: parrainUserId,
    });
    await retirerDernierTicketParrainage(service, parrainUserId);
    return { credited: false };
  }

  return { credited: true };
}

/**
 * Rattache un filleul à un referral pending existant (ou en crée un en pending)
 * SANS créditer — utilisé quand l'anti-abus refuse. Best-effort, silencieux.
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
