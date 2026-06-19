/**
 * Attribution Google Ads — côté serveur, valeur composée.
 *
 * Le tunnel est cross-domain : Ads → vitrine (yoga-sculpt.fr) → espace client
 * (app.yoga-sculpt.fr). Le `gclid` n'arrive QUE sur la vitrine, qui le stocke en
 * cookie 1st-party `ys_gclid` scopé `Domain=.yoga-sculpt.fr` (cf composant
 * GclidCapture du repo vitrine). Ce module :
 *   1. CAPTE ce gclid à la 1re session (callback auth) → le range sur profiles
 *      en FIRST-TOUCH (on n'écrase pas une attribution déjà posée).
 *   2. ENREGISTRE des conversions de valeur (idempotentes) à uploader à Google :
 *      paiement Stripe, valeur d'un filleul (→ gclid du PARRAIN), ticket gratuit
 *      consommé (~10€). L'upload réseau vers l'API Google Ads est un 2e temps
 *      (cf todo attribution-ads-server-side) ; ici on persiste le journal.
 *
 * Tout est BEST-EFFORT : un échec d'attribution ne casse JAMAIS l'auth, le
 * paiement, ni le parrainage. Écritures via service_role uniquement.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { readAdsEnv, uploadClickConversion } from "@/lib/google-ads";
import { createLogger, serializeError } from "@/lib/log";

const log = createLogger("ads-attribution");

/** Forme du cookie ys_gclid posé par la vitrine (JSON encodé). */
export interface GclidPayload {
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  landing?: string;
  ts?: string;
}

/** Valeur fixe attribuée à un ticket gratuit CONSOMMÉ (≈ valeur d'une séance). */
export const FREE_TICKET_VALUE_EUR = 10;

/** Parse le contenu (URL-encodé) du cookie ys_gclid. null si absent/illisible. */
export function parseGclidCookie(raw: string | undefined | null): GclidPayload | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(decodeURIComponent(raw)) as GclidPayload;
    // Au moins un identifiant de clic doit être présent.
    if (!obj.gclid && !obj.gbraid && !obj.wbraid) return null;
    return obj;
  } catch {
    return null;
  }
}

/**
 * Range le gclid sur le profil en FIRST-TOUCH : n'écrit QUE si aucun gclid n'est
 * encore présent (on ne réattribue pas un user déjà acquis à un clic plus récent).
 * Best-effort : avale toute erreur. service_role attendu.
 */
export async function captureGclidOnProfile(
  service: SupabaseClient,
  userId: string,
  payload: GclidPayload | null,
): Promise<void> {
  if (!payload) return;
  try {
    // First-touch : ne pas écraser un gclid déjà posé.
    const { data: existing } = await service
      .from("profiles")
      .select("gclid, gbraid, wbraid")
      .eq("id", userId)
      .maybeSingle();

    if (existing?.gclid || existing?.gbraid || existing?.wbraid) return;

    await service
      .from("profiles")
      .update({
        gclid: payload.gclid ?? null,
        gbraid: payload.gbraid ?? null,
        wbraid: payload.wbraid ?? null,
        ad_landing: payload.landing ?? null,
        ad_clicked_at: payload.ts ?? null,
        gclid_captured_at: new Date().toISOString(),
      })
      .eq("id", userId);
  } catch {
    // attribution best-effort : ne jamais casser l'auth.
  }
}

export type AdsConversionKind = "purchase" | "referral_value" | "free_ticket_used";

/**
 * Enregistre une conversion de valeur à attribuer à un gclid (journal idempotent
 * ads_conversions). Ne fait PAS l'upload réseau (2e temps) — pose la ligne avec
 * uploaded=false. Idempotent sur (kind, source_ref) : un rejeu = no-op silencieux.
 *
 * @param gclid  le gclid à créditer. Pour `referral_value`, c'est le gclid du
 *               PARRAIN (intérêts composés), pas du filleul.
 * Best-effort : avale les erreurs (le métier — ticket/paiement — a déjà réussi).
 */
export async function recordAdsConversion(
  service: SupabaseClient,
  params: {
    userId: string;
    kind: AdsConversionKind;
    sourceRef: string;
    gclid: string | null;
    valueEur: number;
  },
): Promise<void> {
  // Pas de gclid → user non venu de l'Ads, rien à attribuer.
  if (!params.gclid) return;
  try {
    await service.from("ads_conversions").upsert(
      {
        user_id: params.userId,
        kind: params.kind,
        source_ref: params.sourceRef,
        gclid: params.gclid,
        value_eur: params.valueEur,
        uploaded: false,
      },
      { onConflict: "kind,source_ref", ignoreDuplicates: true },
    );
  } catch {
    // best-effort.
  }
}

/** Récupère le gclid first-touch d'un user (pour attribuer un paiement). */
export async function getUserGclid(
  service: SupabaseClient,
  userId: string,
): Promise<string | null> {
  try {
    const { data } = await service
      .from("profiles")
      .select("gclid")
      .eq("id", userId)
      .maybeSingle();
    return data?.gclid ?? null;
  } catch {
    return null;
  }
}

/**
 * Mappe un kind de conversion vers le resource name de sa conversion action
 * Google Ads (créée sur le compte, son resource name mis en env). null si non
 * configuré → on n'uploade pas (on laisse la ligne pending, pas d'erreur).
 */
function conversionActionFor(
  kind: AdsConversionKind,
  env: Record<string, string | undefined>,
): string | null {
  switch (kind) {
    case "purchase":
      return env.ADS_CONV_ACTION_PURCHASE ?? null;
    case "referral_value":
      return env.ADS_CONV_ACTION_REFERRAL ?? null;
    case "free_ticket_used":
      return env.ADS_CONV_ACTION_FREE_TICKET ?? null;
  }
}

interface DrainResult {
  uploaded: number;
  failed: number;
  skipped: number;
}

/**
 * Draine le journal ads_conversions : pousse à Google Ads les conversions
 * pending (uploaded=false) qui ont un gclid + une conversion action configurée,
 * et marque le résultat. Idempotent : une ligne uploadée n'est jamais re-tentée.
 * Appelé par un cron (ou en best-effort après écriture). Ne throw jamais — agrège.
 *
 * @param env  process.env (secrets Ads + resource names des conversion actions).
 * @param limit nb max de conversions traitées par run.
 */
export async function drainAdsConversions(
  service: SupabaseClient,
  env: Record<string, string | undefined>,
  limit = 50,
): Promise<DrainResult> {
  const result: DrainResult = { uploaded: 0, failed: 0, skipped: 0 };
  const adsEnv = readAdsEnv(env);
  if (!adsEnv) {
    log.warn("Config Google Ads incomplète — drain ignoré");
    return result;
  }

  const { data: pending, error } = await service
    .from("ads_conversions")
    .select("id, user_id, kind, source_ref, gclid, value_eur, created_at")
    .eq("uploaded", false)
    .not("gclid", "is", null)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    log.error("Lecture ads_conversions pending échouée", { db: error.message });
    return result;
  }
  if (!pending || pending.length === 0) return result;

  // ── GARDE-FOU ENVIRONNEMENT DE TEST ────────────────────────────────────────
  // Sur staging (ADS_TEST_MODE=true), les creds Ads pointent la VRAIE campagne
  // (customer 6478938833). Pour ne JAMAIS créer de fausse conversion attribuée à
  // un vrai clic depuis l'env de test, on n'uploade QUE les gclid de test
  // (préfixe TEST_). Un vrai gclid sur staging est sauté, jamais envoyé à Google.
  // En prod, ADS_TEST_MODE est absent → comportement normal (tout est uploadé).
  const testMode =
    env.ADS_TEST_MODE === "true" || env.ADS_TEST_MODE === "1";

  for (const row of pending) {
    if (testMode && !String(row.gclid).startsWith("TEST_")) {
      // Env de test : on refuse tout vrai gclid (anti-fausse-conversion live).
      log.warn("ADS_TEST_MODE : gclid réel ignoré sur staging (non uploadé)", {
        id: row.id, kind: row.kind,
      });
      result.skipped++;
      continue;
    }
    const action = conversionActionFor(row.kind as AdsConversionKind, env);
    if (!action) {
      // Conversion action non configurée pour ce kind → on saute (pas d'erreur).
      result.skipped++;
      continue;
    }
    try {
      await uploadClickConversion(adsEnv, {
        gclid: row.gclid as string,
        conversionActionResourceName: action,
        conversionDateTimeIso: row.created_at as string,
        valueEur: Number(row.value_eur),
        // transactionId stable = clé idempotente de la ligne (kind:source_ref).
        // Un rejeu ré-uploade le même id → Google ne compte pas 2× la conversion.
        transactionId: `${row.kind}:${row.source_ref}`,
      });
      await service
        .from("ads_conversions")
        .update({ uploaded: true, uploaded_at: new Date().toISOString(), upload_error: null })
        .eq("id", row.id);
      result.uploaded++;
    } catch (err) {
      // On persiste l'erreur sur la ligne (reste pending → re-tentée au prochain run).
      await service
        .from("ads_conversions")
        .update({ upload_error: serializeError(err).message ?? "upload échoué" })
        .eq("id", row.id);
      log.error("Upload conversion Ads échoué", {
        id: row.id, kind: row.kind, err: serializeError(err),
      });
      result.failed++;
    }
  }
  log.info("Drain ads_conversions terminé", { ...result });
  return result;
}
