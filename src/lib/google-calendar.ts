/**
 * Google Calendar — lib d'accès à l'API REST, 100 % edge-compatible.
 *
 * Authentifie un **service account** Google (flow OAuth2 "JWT Bearer") puis
 * appelle l'API Google Calendar v3. Pensée pour tourner sur Cloudflare Workers
 * (edge, via OpenNext) : ZÉRO dépendance Node.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ RUNTIME — Cloudflare Workers (edge).                                      │
 * │   ❌ Interdit : `googleapis`, `google-auth-library`, `crypto` de Node,    │
 * │      `jsonwebtoken`. Aucune dépendance npm ajoutée.                       │
 * │   ✅ Uniquement Web Crypto (`crypto.subtle`) + `fetch`, dispos nativement │
 * │      sur Workers.                                                         │
 * │                                                                           │
 * │   Même approche que `src/app/api/webhooks/stripe/route.ts` (HMAC SHA-256  │
 * │   fait main avec `crypto.subtle`) — ici on signe en RS256 pour le JWT.    │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ FLOW d'auth service account (OAuth2 "JWT Bearer", RFC 7523) :            │
 * │   1. Construire un JWT signé RS256 (header + claims).                     │
 * │   2. POST le JWT à oauth2.googleapis.com/token (grant_type jwt-bearer).   │
 * │   3. Google renvoie un `access_token` (Bearer) valable ~1 h.              │
 * │   4. On le met en cache module-level (réutilisé tant que non expiré).     │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Config (variables d'environnement, lues via `process.env`) :
 *   - `GOOGLE_CALENDAR_SA_KEY` : le JSON COMPLET du service account (string).
 *     On en extrait `client_email` + `private_key` (PEM PKCS#8).
 *   - `GOOGLE_CALENDAR_ID`     : id du calendrier cible.
 */

// ============================================================================
// Types
// ============================================================================

/** Une borne temporelle d'événement (début ou fin). */
export interface GoogleCalendarEventDateTime {
  /** Date+heure RFC3339, p.ex. "2026-06-20T10:00:00+02:00". Mutuellement exclusif avec `date`. */
  dateTime?: string;
  /** Date seule "YYYY-MM-DD" pour un événement "journée entière". Exclusif avec `dateTime`. */
  date?: string;
  /** Fuseau, p.ex. "Europe/Paris". */
  timeZone?: string;
}

/** Un participant à un événement. */
export interface GoogleCalendarAttendee {
  email: string;
  displayName?: string;
  optional?: boolean;
  organizer?: boolean;
  self?: boolean;
  resource?: boolean;
  /** "needsAction" | "declined" | "tentative" | "accepted". */
  responseStatus?: "needsAction" | "declined" | "tentative" | "accepted";
  comment?: string;
}

/**
 * Un événement Google Calendar (sous-ensemble des champs utiles à l'app).
 * Champs renvoyés par l'API : cf. https://developers.google.com/calendar/api/v3/reference/events
 */
export interface GoogleCalendarEvent {
  /** Toujours "calendar#event". */
  kind?: string;
  /** ETag de la ressource. */
  etag?: string;
  /** Identifiant unique de l'événement (utilisé par get/patch/delete). */
  id?: string;
  /** "confirmed" | "tentative" | "cancelled". */
  status?: "confirmed" | "tentative" | "cancelled";
  /** Lien vers l'événement dans l'UI Google Calendar. */
  htmlLink?: string;
  created?: string;
  updated?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleCalendarEventDateTime;
  end?: GoogleCalendarEventDateTime;
  /** Identifiant de l'événement récurrent parent (présent sur les instances). */
  recurringEventId?: string;
  /** Règles de récurrence (RRULE/RDATE/EXDATE), sur l'événement maître uniquement. */
  recurrence?: string[];
  attendees?: GoogleCalendarAttendee[];
  organizer?: { email?: string; displayName?: string; self?: boolean };
  creator?: { email?: string; displayName?: string; self?: boolean };
  /** Autorise d'autres champs renvoyés par l'API sans casser le typage strict. */
  [key: string]: unknown;
}

/** Réponse paginée de `events.list`. */
interface GoogleCalendarEventsListResponse {
  kind?: string;
  items?: GoogleCalendarEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
  timeZone?: string;
  [key: string]: unknown;
}

/** Options de `listEvents`. */
export interface ListEventsOptions {
  /** Borne basse (RFC3339), inclusive sur la fin de l'événement. */
  timeMin?: string;
  /** Borne haute (RFC3339), exclusive sur le début de l'événement. */
  timeMax?: string;
  /** Développe les événements récurrents en instances individuelles. Défaut : true. */
  singleEvents?: boolean;
  /** Tri ("startTime" exige singleEvents=true ; sinon "updated"). Défaut : "startTime". */
  orderBy?: "startTime" | "updated";
  /** Nombre max d'événements par page (1..2500). */
  maxResults?: number;
  /** Recherche plein texte. */
  q?: string;
  /** Jeton de pagination (page suivante). */
  pageToken?: string;
  /** Inclure les événements annulés (status="cancelled"). Défaut côté API : false. */
  showDeleted?: boolean;
}

/** Corps de création/modification d'un événement (champs autorisés à l'écriture). */
export interface EventWriteBody {
  summary?: string;
  description?: string;
  location?: string;
  start: GoogleCalendarEventDateTime;
  end: GoogleCalendarEventDateTime;
  attendees?: GoogleCalendarAttendee[];
  recurrence?: string[];
  /** Champs additionnels acceptés par l'API (extendedProperties, reminders, etc.). */
  [key: string]: unknown;
}

// ============================================================================
// Auth — JWT RS256 → access token (Web Crypto)
// ============================================================================

/** Structure (partielle) du JSON de clé de service account Google. */
interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

const TOKEN_URI = "https://oauth2.googleapis.com/token";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";
const API_BASE = "https://www.googleapis.com/calendar/v3";

/**
 * Cache module-level de l'access token. Persiste tant que l'isolat Worker reste
 * chaud, ce qui évite de re-signer un JWT + re-appeler Google à chaque requête.
 * On stocke l'instant d'expiration (ms epoch) et on garde une marge de sécurité.
 */
let cachedToken: { accessToken: string; expiresAt: number } | null = null;

/** Marge avant expiration réelle : on renouvelle 60 s à l'avance. */
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

/**
 * base64url (RFC 4648 §5) sans padding, à partir d'une chaîne UTF-8.
 * Utilisé pour le header et les claims du JWT.
 */
function base64UrlEncodeString(input: string): string {
  return base64UrlFromBytes(new TextEncoder().encode(input));
}

/** base64url sans padding à partir d'octets bruts (header/claims/signature). */
function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  // btoa est dispo sur Workers. On convertit ensuite base64 → base64url.
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Décode une chaîne base64 (standard, avec padding) en octets bruts.
 * Sert à transformer le corps PEM (base64) de la clé privée en DER.
 */
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Convertit une clé privée PEM PKCS#8 (`-----BEGIN PRIVATE KEY-----`) en
 * `CryptoKey` importée pour la signature RS256 (RSASSA-PKCS1-v1_5 / SHA-256).
 *
 * Étapes : retirer en-têtes/armures + tous les retours à la ligne, base64-décoder
 * le corps en DER, puis `importKey("pkcs8", …)`.
 *
 * ⚠️ Les clés de service account Google échappent souvent les "\n" littéraux
 * (p.ex. quand le JSON transite par une variable d'env). On les re-normalise.
 */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const normalized = pem.replace(/\\n/g, "\n");
  const body = normalized
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");

  if (!body) {
    throw new Error(
      "[google-calendar] Clé privée du service account vide ou mal formée " +
        "(format attendu : PEM PKCS#8 `-----BEGIN PRIVATE KEY-----`).",
    );
  }

  const der = base64ToBytes(body);
  return crypto.subtle.importKey(
    "pkcs8",
    // `der.buffer` peut être un ArrayBuffer plus large que les octets utiles ;
    // on passe une vue exacte pour rester correct sur des Uint8Array tronqués.
    der.buffer.slice(der.byteOffset, der.byteOffset + der.byteLength) as ArrayBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

/**
 * Construit et signe (RS256) le JWT d'assertion pour le flow service account.
 * @returns le JWT compact `header.claims.signature`.
 */
async function buildSignedJwt(sa: ServiceAccountKey): Promise<string> {
  // `Date.now()` est disponible à l'exécution Workers (c'est uniquement interdit
  // dans les scripts de workflow, pas dans le code applicatif runtime).
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600; // Google plafonne la durée de vie de l'assertion à 1 h.

  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: sa.client_email,
    scope: CALENDAR_SCOPE,
    aud: sa.token_uri || TOKEN_URI,
    iat,
    exp,
  };

  const signingInput =
    base64UrlEncodeString(JSON.stringify(header)) +
    "." +
    base64UrlEncodeString(JSON.stringify(claims));

  const key = await importPrivateKey(sa.private_key);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );

  return signingInput + "." + base64UrlFromBytes(new Uint8Array(signature));
}

/**
 * Lit et parse le JSON du service account depuis `GOOGLE_CALENDAR_SA_KEY`.
 * @throws si la variable est absente, n'est pas du JSON, ou n'a pas les champs requis.
 */
function loadServiceAccount(): ServiceAccountKey {
  const raw = process.env.GOOGLE_CALENDAR_SA_KEY;
  if (!raw) {
    throw new Error(
      "[google-calendar] Variable GOOGLE_CALENDAR_SA_KEY manquante " +
        "(JSON complet de la clé de service account attendu).",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      "[google-calendar] GOOGLE_CALENDAR_SA_KEY n'est pas du JSON valide.",
    );
  }

  const sa = parsed as Partial<ServiceAccountKey>;
  if (!sa.client_email || !sa.private_key) {
    throw new Error(
      "[google-calendar] GOOGLE_CALENDAR_SA_KEY incomplet : " +
        "`client_email` et `private_key` sont requis.",
    );
  }

  return { client_email: sa.client_email, private_key: sa.private_key, token_uri: sa.token_uri };
}

/** Lit l'id du calendrier cible depuis `GOOGLE_CALENDAR_ID`. */
function getCalendarId(): string {
  const id = process.env.GOOGLE_CALENDAR_ID;
  if (!id) {
    throw new Error(
      "[google-calendar] Variable GOOGLE_CALENDAR_ID manquante " +
        "(id du calendrier cible attendu).",
    );
  }
  return id;
}

/** Réponse du endpoint token de Google. */
interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
}

/**
 * Récupère un access token valide pour l'API Calendar, avec cache module-level.
 *
 * Si un token en cache est encore valide (marge 60 s), on le réutilise.
 * Sinon : on signe un nouveau JWT et on l'échange contre un access token.
 */
export async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && now < cachedToken.expiresAt - TOKEN_EXPIRY_MARGIN_MS) {
    return cachedToken.accessToken;
  }

  const sa = loadServiceAccount();
  const jwt = await buildSignedJwt(sa);

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: jwt,
  });

  const res = await fetch(sa.token_uri || TOKEN_URI, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  let data: TokenResponse;
  try {
    data = (await res.json()) as TokenResponse;
  } catch {
    throw new Error(
      `[google-calendar] Réponse token illisible (HTTP ${res.status}).`,
    );
  }

  if (!res.ok || !data.access_token) {
    const detail = data.error_description || data.error || `HTTP ${res.status}`;
    throw new Error(`[google-calendar] Échec d'obtention de l'access token : ${detail}`);
  }

  // expires_in est en secondes ; on convertit en instant d'expiration absolu.
  const expiresInMs = (data.expires_in ?? 3600) * 1000;
  cachedToken = { accessToken: data.access_token, expiresAt: now + expiresInMs };

  return data.access_token;
}

/** Vide le cache d'access token (utile en test, ou après rotation de clé). */
export function clearTokenCache(): void {
  cachedToken = null;
}

// ============================================================================
// Couche fetch — appels REST authentifiés
// ============================================================================

/**
 * Appel authentifié à l'API Calendar. Ajoute le Bearer, gère le JSON et les
 * erreurs HTTP (throw avec status + corps d'erreur Google pour le debug).
 *
 * @param path     chemin relatif à l'API base (commence par "/").
 * @param init     options fetch (méthode, body…). Le content-type JSON est posé
 *                 automatiquement quand un body est fourni.
 * @returns le JSON parsé typé en T, ou `undefined` pour une réponse 204 (vide).
 */
async function calendarFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();

  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });

  // 204 No Content (typiquement DELETE) : succès sans corps.
  if (res.status === 204) {
    return undefined as T;
  }

  const text = await res.text();

  if (!res.ok) {
    // Le corps d'erreur Google est un JSON { error: { code, message, errors } }.
    // On le ressort tel quel (tronqué) pour rendre le debug exploitable.
    throw new Error(
      `[google-calendar] ${init.method || "GET"} ${path} → HTTP ${res.status}: ${text.slice(0, 1000)}`,
    );
  }

  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

/** Encode un segment de chemin (id d'événement) pour l'insérer dans l'URL. */
function eventsPath(suffix = ""): string {
  const calendarId = encodeURIComponent(getCalendarId());
  return `/calendars/${calendarId}/events${suffix}`;
}

// ============================================================================
// Wrappers REST exportés
// ============================================================================

/**
 * Liste les événements du calendrier sur une fenêtre temporelle.
 *
 * Par défaut : `singleEvents=true` (récurrences développées en instances) et
 * `orderBy="startTime"`. Retourne directement le tableau `items` (jamais null).
 *
 * Note : pour parcourir au-delà d'une page, relire `nextPageToken` côté appelant
 * et rappeler avec `pageToken`. Ici on expose le cas simple (1 page) ; on ajoutera
 * un helper de pagination complète si un besoin réel apparaît.
 */
export async function listEvents(
  options: ListEventsOptions = {},
): Promise<GoogleCalendarEvent[]> {
  const {
    timeMin,
    timeMax,
    singleEvents = true,
    orderBy = "startTime",
    maxResults,
    q,
    pageToken,
    showDeleted,
  } = options;

  const params = new URLSearchParams();
  if (timeMin) params.set("timeMin", timeMin);
  if (timeMax) params.set("timeMax", timeMax);
  params.set("singleEvents", String(singleEvents));
  // "startTime" n'est valide que si singleEvents=true (contrainte API Google).
  if (singleEvents) params.set("orderBy", orderBy);
  if (typeof maxResults === "number") params.set("maxResults", String(maxResults));
  if (q) params.set("q", q);
  if (pageToken) params.set("pageToken", pageToken);
  if (typeof showDeleted === "boolean") params.set("showDeleted", String(showDeleted));

  const data = await calendarFetch<GoogleCalendarEventsListResponse>(
    eventsPath(`?${params.toString()}`),
  );
  return data.items ?? [];
}

/** Récupère un événement par son id. */
export async function getEvent(eventId: string): Promise<GoogleCalendarEvent> {
  if (!eventId) throw new Error("[google-calendar] getEvent: eventId requis.");
  return calendarFetch<GoogleCalendarEvent>(
    eventsPath(`/${encodeURIComponent(eventId)}`),
  );
}

/**
 * Crée un événement. `start`/`end` au format `{ dateTime: ISO, timeZone: "Europe/Paris" }`
 * (ou `{ date }` pour une journée entière). Retourne l'événement créé (avec son `id`).
 */
export async function insertEvent(
  body: EventWriteBody,
): Promise<GoogleCalendarEvent> {
  if (!body?.start || !body?.end) {
    throw new Error("[google-calendar] insertEvent: `start` et `end` sont requis.");
  }
  return calendarFetch<GoogleCalendarEvent>(eventsPath(), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * Met à jour partiellement un événement (PATCH : seuls les champs fournis sont
 * modifiés, les autres sont préservés). Retourne l'événement mis à jour.
 */
export async function patchEvent(
  eventId: string,
  partialBody: Partial<EventWriteBody>,
): Promise<GoogleCalendarEvent> {
  if (!eventId) throw new Error("[google-calendar] patchEvent: eventId requis.");
  return calendarFetch<GoogleCalendarEvent>(
    eventsPath(`/${encodeURIComponent(eventId)}`),
    { method: "PATCH", body: JSON.stringify(partialBody) },
  );
}

/**
 * Supprime un événement. L'API renvoie 204 No Content en cas de succès
 * (résolu silencieusement par `calendarFetch`).
 */
export async function deleteEvent(eventId: string): Promise<void> {
  if (!eventId) throw new Error("[google-calendar] deleteEvent: eventId requis.");
  await calendarFetch<void>(eventsPath(`/${encodeURIComponent(eventId)}`), {
    method: "DELETE",
  });
}
