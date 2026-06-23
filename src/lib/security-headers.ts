/**
 * En-têtes de sécurité HTTP de l'espace client (app.yoga-sculpt.fr).
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ POURQUOI ICI (et pas dans `next.config.ts#headers()`)                     │
 * │   L'app est servie par Cloudflare Workers via OpenNext. La fonction       │
 * │   `headers()` de `next.config.ts` n'est PAS appliquée de façon fiable sur │
 * │   un export edge OpenNext (elle vise le serveur Node de Next). Le SEUL    │
 * │   point traversé par TOUTES les requêtes (pages + routes API) sur ce      │
 * │   runtime est le middleware edge → on pose les en-têtes là, sur la        │
 * │   réponse, de façon centralisée et testable.                              │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ CSP — REPORT-ONLY (volontaire, comme le vitrine)                          │
 * │   On expédie la politique en `Content-Security-Policy-Report-Only` : elle │
 * │   est calculée pour les origines réelles de l'app (Supabase / Stripe /    │
 * │   Google) mais NE BLOQUE PAS encore (un faux positif ne casse pas l'app   │
 * │   en prod). Next injecte des styles inline (Tailwind) et des scripts      │
 * │   d'hydratation → `'unsafe-inline'` est toléré tant qu'on n'a pas câblé   │
 * │   un nonce par requête. Étape suivante (hors de ce lot) : observer les    │
 * │   rapports, durcir (nonce + retrait de `'unsafe-inline'`), PUIS basculer  │
 * │   l'en-tête en `Content-Security-Policy` (enforce). Voir le ticket CSP.   │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * RUNTIME — Cloudflare Workers (edge). 100 % pur (manipule un objet `Headers`),
 * aucune API Node, aucune dépendance npm.
 */

/** Durée HSTS : 2 ans, sous-domaines inclus, éligible à la preload list. */
const HSTS_VALUE = "max-age=63072000; includeSubDomains; preload";

/**
 * Content-Security-Policy (REPORT-ONLY) calée sur les origines réellement
 * sollicitées par l'app :
 *   - Supabase (auth + REST)          : https://*.supabase.co
 *   - Stripe (redirection checkout)   : https://*.stripe.com (frame + form-action)
 *   - Avatars OAuth Google/Microsoft  : images distantes (Google usercontent, MS)
 *   - Styles/scripts inline de Next   : 'unsafe-inline' (à retirer via nonce plus tard)
 *
 * `frame-ancestors 'none'` interdit l'embarquement dans une iframe tierce
 * (doublon défensif de X-Frame-Options pour les navigateurs modernes).
 */
const CSP_DIRECTIVES: Record<string, string[]> = {
  "default-src": ["'self'"],
  // 'unsafe-inline' nécessaire tant que Next injecte des scripts d'hydratation
  // sans nonce. 'unsafe-eval' VOLONTAIREMENT absent (non requis en prod).
  // analytics-engine = tracker Veridian (chargement du bundle /sdk/v1/tracker.js).
  "script-src": [
    "'self'",
    "'unsafe-inline'",
    "https://analytics-engine.app.veridian.site",
  ],
  // Tailwind + styles inline de composants.
  "style-src": ["'self'", "'unsafe-inline'"],
  // Avatars OAuth (Google/Microsoft) + data: (favicons/SVG inline éventuels).
  "img-src": [
    "'self'",
    "data:",
    "blob:",
    "https://*.googleusercontent.com",
    "https://lh3.googleusercontent.com",
    "https://*.graph.microsoft.com",
  ],
  "font-src": ["'self'", "data:"],
  // Appels XHR/fetch : Supabase (auth + db), Stripe (création de session côté
  // serveur, mais on autorise aussi côté client par sécurité).
  "connect-src": [
    "'self'",
    "https://*.supabase.co",
    "wss://*.supabase.co",
    "https://api.stripe.com",
    // Events du tracker Veridian (POST /api/track).
    "https://analytics-engine.app.veridian.site",
  ],
  // Redirection / POST vers Stripe Checkout.
  "form-action": ["'self'", "https://checkout.stripe.com", "https://*.stripe.com"],
  // Iframe Stripe éventuelle (Stripe.js futur). Sinon strictement self.
  "frame-src": ["'self'", "https://*.stripe.com"],
  // Anti-clickjacking (défense en profondeur avec X-Frame-Options).
  "frame-ancestors": ["'none'"],
  "base-uri": ["'self'"],
  "object-src": ["'none'"],
  // Force les sous-ressources en HTTPS (pas de mixed-content).
  "upgrade-insecure-requests": [],
};

/** Sérialise la politique CSP en une seule ligne d'en-tête. */
export function buildCspReportOnly(): string {
  return Object.entries(CSP_DIRECTIVES)
    .map(([directive, sources]) =>
      sources.length > 0 ? `${directive} ${sources.join(" ")}` : directive,
    )
    .join("; ");
}

/**
 * En-têtes de sécurité statiques (hors CSP, calculée séparément). On ne fait que
 * RENFORCER : si une réponse posait déjà l'un de ces en-têtes, on l'écrase par la
 * valeur durcie (idempotent — appeler deux fois donne le même résultat).
 */
const STATIC_SECURITY_HEADERS: Record<string, string> = {
  // HTTPS strict (le Worker n'est servi qu'en HTTPS derrière Cloudflare).
  "Strict-Transport-Security": HSTS_VALUE,
  // Anti-clickjacking (navigateurs anciens ; les modernes lisent frame-ancestors).
  "X-Frame-Options": "DENY",
  // Pas de MIME sniffing.
  "X-Content-Type-Options": "nosniff",
  // Ne fuite pas l'URL complète (avec `?ref=` / `?redirectTo=`) en cross-origin.
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // Coupe les API navigateur sensibles non utilisées par l'app.
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  // Isolation cross-domaine douce (pas de COEP qui casserait les avatars Google).
  "Cross-Origin-Opener-Policy": "same-origin",
  "X-DNS-Prefetch-Control": "off",
};

/**
 * Applique tous les en-têtes de sécurité sur l'objet `Headers` d'une réponse.
 * Idempotent. À appeler dans le middleware sur la réponse finale.
 *
 * @param headers le `Headers` mutable de la réponse middleware.
 */
export function appliquerHeadersSecurite(headers: Headers): void {
  for (const [name, value] of Object.entries(STATIC_SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  // CSP en REPORT-ONLY (n'applique pas, observe). Bascule en enforce plus tard.
  headers.set("Content-Security-Policy-Report-Only", buildCspReportOnly());
}
