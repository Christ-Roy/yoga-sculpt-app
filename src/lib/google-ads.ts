/**
 * Client Google Ads — upload de conversions OFFLINE (server-side, edge-compatible).
 *
 * Pourquoi maison : le SDK officiel google-ads est Python/Node-lourd, incompatible
 * Cloudflare Workers (edge). On parle donc directement à l'API REST v23 avec un
 * access token OAuth rafraîchi via fetch (pas de dépendance Node).
 *
 * Ce que ça fait : `uploadClickConversion` envoie une conversion attribuée à un
 * `gclid` (offline conversion import) — c'est ainsi qu'on remonte à Google la
 * VRAIE valeur d'un user venu de l'Ads : paiement, valeur de ses filleuls, ticket
 * gratuit consommé. Chaque conversion porte une `conversion_action` (créée sur le
 * compte) + une value + une devise + un timestamp.
 *
 * Secrets (env, jamais en dur) :
 *   GOOGLE_ADS_OAUTH_CLIENT_ID / GOOGLE_ADS_OAUTH_CLIENT_SECRET / GOOGLE_ADS_REFRESH_TOKEN
 *   GOOGLE_ADS_DEVELOPER_TOKEN
 *   GOOGLE_ADS_LOGIN_CUSTOMER_ID   (MCC Veridian, sans tirets)
 *   YOGA_SCULPT_ADS_CUSTOMER_ID    (compte Yoga Sculpt, sans tirets) — 6478938833
 *   Les resource names des conversion_action sont passés en paramètre (cf env mapping).
 */

const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const ADS_API_VERSION = "v23";

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

/** Format Google Ads : "yyyy-MM-dd HH:mm:ss+00:00" (UTC). */
export function formatConversionDateTime(iso: string): string {
  // iso = "2026-06-19T12:34:56.000Z" → "2026-06-19 12:34:56+00:00"
  const d = iso.replace("T", " ").replace(/\.\d+Z$/, "").replace(/Z$/, "");
  return `${d}+00:00`;
}

export interface ClickConversionInput {
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  /** resource name complet de la conversion action (customers/X/conversionActions/Y). */
  conversionActionResourceName: string;
  /** quand la conversion a eu lieu (ISO) → formaté en datetime Ads. */
  conversionDateTimeIso: string;
  valueEur: number;
}

/**
 * Upload une conversion offline attribuée à un gclid (ou gbraid/wbraid).
 * Appelle customers.uploadClickConversions de l'API Ads REST.
 * @throws si l'OAuth, le réseau, ou l'API renvoie une erreur (partial_failure incluse).
 */
export async function uploadClickConversion(
  env: AdsEnv,
  input: ClickConversionInput,
): Promise<void> {
  const accessToken = await getAccessToken(env);

  const conversion: Record<string, unknown> = {
    conversionAction: input.conversionActionResourceName,
    conversionDateTime: formatConversionDateTime(input.conversionDateTimeIso),
    conversionValue: input.valueEur,
    currencyCode: "EUR",
  };
  // Un seul identifiant de clic par conversion (gclid prioritaire).
  if (input.gclid) conversion.gclid = input.gclid;
  else if (input.gbraid) conversion.gbraid = input.gbraid;
  else if (input.wbraid) conversion.wbraid = input.wbraid;
  else throw new Error("uploadClickConversion: aucun identifiant de clic (gclid/gbraid/wbraid).");

  const url =
    `https://googleads.googleapis.com/${ADS_API_VERSION}/customers/${env.customerId}:uploadClickConversions`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": env.developerToken,
      "login-customer-id": env.loginCustomerId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      conversions: [conversion],
      // partialFailure: true → on récupère les erreurs par ligne plutôt qu'un
      // rejet global ; on les inspecte ci-dessous et on throw si non vide.
      partialFailure: true,
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`uploadClickConversions HTTP ${res.status}: ${txt.slice(0, 500)}`);
  }
  const json = (await res.json()) as {
    partialFailureError?: { message?: string };
  };
  if (json.partialFailureError) {
    throw new Error(
      `uploadClickConversions partial failure: ${json.partialFailureError.message ?? "?"}`,
    );
  }
}
