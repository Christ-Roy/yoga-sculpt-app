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
