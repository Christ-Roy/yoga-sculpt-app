/**
 * Rate-limiter EDGE-SAFE, best-effort, SANS dépendance ni binding Cloudflare.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ POURQUOI / LIMITES — À LIRE AVANT DE S'Y FIER                              │
 * │                                                                           │
 * │ Sur Cloudflare Workers (OpenNext), un rate-limiter À ÉTAT PARTAGÉ propre   │
 * │ exige une infra dédiée : binding « Rate Limiting » Cloudflare, KV, ou      │
 * │ Durable Object → nouvelle ressource + binding wrangler + déploiement.      │
 * │ Hors périmètre d'une passe code (pas de nouvelle dépendance/binding).      │
 * │                                                                           │
 * │ Ce module est le MINIMUM FAISABLE sans rien de tout ça : un compteur       │
 * │ fixed-window EN MÉMOIRE de l'isolate courant. Conséquences ASSUMÉES :      │
 * │   - l'état n'est PAS partagé entre isolates (Cloudflare en spawn plusieurs │
 * │     et les recycle) → un attaquant réparti sur plusieurs isolates peut     │
 * │     dépasser la limite globale ;                                           │
 * │   - l'état est volatil (perdu au recyclage de l'isolate).                  │
 * │                                                                           │
 * │ MALGRÉ ÇA, c'est utile et à coût ~nul : ça casse un flood NAÏF rapide      │
 * │ depuis une même IP frappant le même isolate (le cas courant d'un brute-    │
 * │ force de codes), et ça ne coûte ni I/O, ni dépendance, ni binding.         │
 * │                                                                           │
 * │ ⚠️ La VRAIE défense durable d'une route publique = une règle Cloudflare    │
 * │    « Rate Limiting » / WAF au niveau du dashboard (Option A du ticket      │
 * │    2026-06-19-qa-secu-invitation-rate-limit) OU un binding Rate Limiting.  │
 * │    Ce module ne la remplace PAS ; il comble le vide en attendant.          │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * RUNTIME — edge (Workers) : aucune dépendance, juste une Map en mémoire.
 */

/** Fenêtre courante d'une clé : compte de hits + horodatage d'expiration. */
interface Bucket {
  count: number;
  /** Epoch ms auquel la fenêtre courante expire (et le compteur se réinitialise). */
  resetAt: number;
}

/**
 * Compteurs par clé, locaux à l'isolate. Borné en taille (cf. MAX_KEYS) pour ne
 * pas fuir de mémoire si beaucoup d'IP distinctes frappent (purge opportuniste
 * des entrées expirées + cap dur).
 */
const buckets = new Map<string, Bucket>();

/** Cap dur du nombre de clés gardées en mémoire (anti-fuite mémoire isolate). */
const MAX_KEYS = 5000;

/** Résultat d'une vérification de rate-limit. */
export interface RateLimitResult {
  /** `true` si la requête est AUTORISÉE (sous la limite), `false` si à bloquer. */
  allowed: boolean;
  /** Nb de hits restants dans la fenêtre courante (0 quand bloqué). */
  remaining: number;
  /** Secondes avant réinitialisation de la fenêtre (pour l'en-tête Retry-After). */
  retryAfterSec: number;
}

/**
 * Purge opportuniste : retire les buckets expirés. Appelée quand la Map dépasse
 * le cap, pour éviter d'évincer des entrées encore actives tant que possible.
 */
function purgeExpired(now: number): void {
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
  }
}

/**
 * Vérifie ET incrémente le compteur d'une clé sur une fenêtre fixe.
 *
 * Fixed window simple (pas de sliding window) : suffisant pour un anti-flood
 * best-effort, et déterministe/sans dépendance. La 1re requête d'une fenêtre
 * arme l'horloge ; chaque requête suivante incrémente jusqu'à `limit`.
 *
 * @param key       identifiant du seau (ex. `invitation:<ip>`). Une clé `null`/
 *                  vide → on n'applique PAS de limite (allowed:true) : on ne
 *                  bloque jamais faute d'IP exploitable (fail-open volontaire ici
 *                  car le rate-limit est une protection DoS, pas un contrôle
 *                  d'accès ; la vraie défense métier est ailleurs).
 * @param limit     nb max de hits autorisés par fenêtre (> 0).
 * @param windowMs  durée de la fenêtre en ms (> 0).
 * @param now       instant courant (injecté pour testabilité).
 */
export function checkRateLimit(
  key: string | null | undefined,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  // Pas de clé exploitable (IP absente) → on n'applique pas la limite.
  if (!key) {
    return { allowed: true, remaining: limit, retryAfterSec: 0 };
  }

  const existing = buckets.get(key);

  // Fenêtre absente ou expirée → on (ré)arme une nouvelle fenêtre.
  if (!existing || existing.resetAt <= now) {
    // Garde-fou mémoire : purge les expirés, et si toujours plein, on n'ajoute
    // pas de nouvelle clé (fail-open) plutôt que de grossir sans limite.
    if (buckets.size >= MAX_KEYS) {
      purgeExpired(now);
      if (buckets.size >= MAX_KEYS) {
        return { allowed: true, remaining: limit, retryAfterSec: 0 };
      }
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return {
      allowed: true,
      remaining: Math.max(0, limit - 1),
      retryAfterSec: Math.ceil(windowMs / 1000),
    };
  }

  // Fenêtre en cours → on incrémente.
  existing.count += 1;
  const retryAfterSec = Math.max(0, Math.ceil((existing.resetAt - now) / 1000));

  if (existing.count > limit) {
    return { allowed: false, remaining: 0, retryAfterSec };
  }
  return {
    allowed: true,
    remaining: Math.max(0, limit - existing.count),
    retryAfterSec,
  };
}

/** Réinitialise tout l'état (tests uniquement). */
export function __resetRateLimitStore(): void {
  buckets.clear();
}
