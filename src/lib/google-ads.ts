/**
 * Client Google Ads — upload de conversions OFFLINE (server-side, edge-compatible).
 *
 * Pourquoi maison : le SDK officiel google-ads est Python/Node-lourd, incompatible
 * Cloudflare Workers (edge). On parle donc directement à l'API REST avec un
 * access token OAuth rafraîchi via fetch (pas de dépendance Node).
 *
 * ⚠️ MIGRATION DATA MANAGER API (2026-06-19) — l'ancienne API
 * `ConversionUploadService.UploadClickConversions` (googleads.googleapis.com/v23/
 * customers/{id}:uploadClickConversions) est FERMÉE aux nouveaux comptes : Google
 * renvoie « New integrations for uploading click conversions should use the Data
 * Manager API. Usage of ConversionUploadService.UploadClickConversions is limited
 * to existing users. ». Le compte Yoga Sculpt (6478938833) est neuf → on DOIT
 * passer par la **Data Manager API** :
 *   POST https://datamanager.googleapis.com/v1/events:ingest
 * Doc : https://developers.google.com/data-manager/api/devguides/events/google-ads/offline
 *
 * Différences vs l'ancienne API (importantes) :
 *   - HÔTE/ENDPOINT différent (datamanager.googleapis.com, méthode events:ingest).
 *   - SCOPE OAuth différent : `https://www.googleapis.com/auth/datamanager` (PAS
 *     `adwords`). → le refresh_token doit avoir été émis avec ce scope (cf rapport
 *     d'activation Robert).
 *   - AUCUN header `developer-token` ni `login-customer-id` : la Data Manager API
 *     ignore les headers d'ingestion. La relation MCC↔compte passe par les champs
 *     `loginAccount` (MCC) / `operatingAccount` (compte client) du payload.
 *   - `productDestinationId` = l'ID NUMÉRIQUE de la conversion action (pas son
 *     resource name complet). On l'extrait de `customers/X/conversionActions/Y` → Y.
 *   - `eventTimestamp` au format RFC 3339 (ex. 2026-06-19T12:34:56Z), pas le format
 *     legacy "yyyy-MM-dd HH:mm:ss+00:00".
 *
 * Secrets (env, jamais en dur) :
 *   GOOGLE_ADS_OAUTH_CLIENT_ID / GOOGLE_ADS_OAUTH_CLIENT_SECRET / GOOGLE_ADS_REFRESH_TOKEN
 *   GOOGLE_ADS_DEVELOPER_TOKEN     (conservé en config — non utilisé par Data Manager)
 *   GOOGLE_ADS_LOGIN_CUSTOMER_ID   (MCC Veridian, sans tirets) → loginAccount
 *   YOGA_SCULPT_ADS_CUSTOMER_ID    (compte Yoga Sculpt, sans tirets) → operatingAccount — 6478938833
 *   Les resource names des conversion_action sont passés en paramètre (cf env mapping).
 */

const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const DATA_MANAGER_INGEST_URL = "https://datamanager.googleapis.com/v1/events:ingest";

interface AdsEnv {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  developerToken: string;
  loginCustomerId: string; // MCC, sans tirets
  customerId: string; // compte client, sans tirets
}

/** Lit et valide la config Ads depuis l'environnement. null si incomplète. */
export function readAdsEnv(env: Record<string, string | undefined>): AdsEnv | null {
  const clientId = env.GOOGLE_ADS_OAUTH_CLIENT_ID;
  const clientSecret = env.GOOGLE_ADS_OAUTH_CLIENT_SECRET;
  const refreshToken = env.GOOGLE_ADS_REFRESH_TOKEN;
  const developerToken = env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const loginCustomerId = env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
  const customerId = env.YOGA_SCULPT_ADS_CUSTOMER_ID;
  if (
    !clientId || !clientSecret || !refreshToken || !developerToken ||
    !loginCustomerId || !customerId
  ) {
    return null;
  }
  return {
    clientId, clientSecret, refreshToken, developerToken,
    loginCustomerId: loginCustomerId.replace(/-/g, ""),
    customerId: customerId.replace(/-/g, ""),
  };
}

/** Échange le refresh token contre un access token (OAuth, fetch — edge-safe). */
async function getAccessToken(env: AdsEnv): Promise<string> {
  const body = new URLSearchParams({
    client_id: env.clientId,
    client_secret: env.clientSecret,
    refresh_token: env.refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`OAuth refresh échoué (${res.status}): ${txt.slice(0, 300)}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("OAuth: access_token absent de la réponse.");
  return json.access_token;
}

/**
 * Format legacy Google Ads ("yyyy-MM-dd HH:mm:ss+00:00", UTC).
 * Conservé pour compatibilité — la Data Manager API utilise désormais
 * `formatEventTimestamp` (RFC 3339). Plus utilisé par l'upload.
 */
export function formatConversionDateTime(iso: string): string {
  // iso = "2026-06-19T12:34:56.000Z" → "2026-06-19 12:34:56+00:00"
  const d = iso.replace("T", " ").replace(/\.\d+Z$/, "").replace(/Z$/, "");
  return `${d}+00:00`;
}

/**
 * Format RFC 3339 attendu par la Data Manager API (`eventTimestamp`).
 * Normalise n'importe quelle date ISO en "yyyy-MM-ddTHH:mm:ssZ" (UTC, sans ms).
 * Ex : "2026-06-19T12:34:56.789Z" → "2026-06-19T12:34:56Z".
 */
export function formatEventTimestamp(iso: string): string {
  // toISOString garantit l'UTC ("...Z") ; on enlève les millisecondes (acceptées
  // mais inutiles) pour un format propre et stable.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    // Date illisible : on tente un best-effort sur la chaîne brute plutôt que throw,
    // le drain restant best-effort. Mais une date valide est attendue en amont.
    return iso;
  }
  return d.toISOString().replace(/\.\d+Z$/, "Z");
}

/**
 * Extrait l'ID numérique d'une conversion action depuis son resource name.
 * "customers/6478938833/conversionActions/7654707078" → "7654707078".
 * Si on reçoit déjà un ID nu (que des chiffres), on le renvoie tel quel.
 */
export function conversionActionId(resourceNameOrId: string): string {
  const m = resourceNameOrId.match(/conversionActions\/(\d+)/);
  if (m) return m[1];
  if (/^\d+$/.test(resourceNameOrId)) return resourceNameOrId;
  throw new Error(
    `conversionActionId: resource name de conversion action invalide « ${resourceNameOrId} »`,
  );
}

export interface ClickConversionInput {
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  /** resource name complet de la conversion action (customers/X/conversionActions/Y). */
  conversionActionResourceName: string;
  /** quand la conversion a eu lieu (ISO) → formaté en eventTimestamp RFC 3339. */
  conversionDateTimeIso: string;
  valueEur: number;
}

/**
 * Upload une conversion offline attribuée à un gclid (ou gbraid/wbraid) via la
 * **Data Manager API** (events:ingest). Remplace l'ancien
 * ConversionUploadService.UploadClickConversions (fermé aux nouveaux comptes).
 *
 * Contrat INCHANGÉ vis-à-vis de `drainAdsConversions` : même signature, throw en
 * cas d'échec (OAuth / réseau / API). Idempotence côté Supabase préservée.
 *
 * @throws si l'OAuth, le réseau, ou l'API renvoie une erreur.
 */
export async function uploadClickConversion(
  env: AdsEnv,
  input: ClickConversionInput,
): Promise<void> {
  // Un seul identifiant de clic par conversion (gclid prioritaire).
  const adIdentifiers: Record<string, string> = {};
  if (input.gclid) adIdentifiers.gclid = input.gclid;
  else if (input.gbraid) adIdentifiers.gbraid = input.gbraid;
  else if (input.wbraid) adIdentifiers.wbraid = input.wbraid;
  else throw new Error("uploadClickConversion: aucun identifiant de clic (gclid/gbraid/wbraid).");

  const accessToken = await getAccessToken(env);

  const payload = {
    destinations: [
      {
        // Compte qui reçoit la conversion (Yoga Sculpt).
        operatingAccount: {
          accountType: "GOOGLE_ADS",
          accountId: env.customerId,
        },
        // Accès via le MCC : nos credentials sont actives sur le manager Veridian.
        loginAccount: {
          accountType: "GOOGLE_ADS",
          accountId: env.loginCustomerId,
        },
        // ID NUMÉRIQUE de la conversion action (UPLOAD_CLICKS), pas le resource name.
        productDestinationId: conversionActionId(input.conversionActionResourceName),
      },
    ],
    events: [
      {
        destinationReferences: [] as string[], // vide = toutes les destinations ci-dessus
        adIdentifiers,
        conversionValue: input.valueEur,
        currency: "EUR",
        eventTimestamp: formatEventTimestamp(input.conversionDateTimeIso),
        eventSource: "WEB",
      },
    ],
  };

  // ⚠️ La Data Manager API IGNORE les headers d'ingestion (pas de developer-token
  // ni login-customer-id ici — la relation MCC est dans loginAccount du payload).
  const res = await fetch(DATA_MANAGER_INGEST_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Data Manager events:ingest HTTP ${res.status}: ${txt.slice(0, 500)}`);
  }

  // Réponse de succès : { requestId: "..." }. Pas de partial failure par ligne sur
  // ce endpoint — un défaut de validation remonte en HTTP non-2xx (géré ci-dessus).
  // On consomme le corps pour fermer proprement le flux.
  await res.json().catch(() => ({}));
}
