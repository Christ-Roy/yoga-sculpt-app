/**
 * Logger structuré léger — Yoga Sculpt espace client.
 *
 * Remplace la convention `console.error("[scope] message", …)` éparpillée dans
 * `src/` par un logger NOMMÉ par scope qui émet une ligne JSON unique :
 *
 *     { "level": "error", "scope": "cron", "msg": "…", "ts": "2026-…Z", ...ctx }
 *
 * Lisible à l'œil dans `wrangler tail` ET parsable par un collecteur (Grafana /
 * Logpush) le jour où on branche l'observabilité — sans rien changer au transport.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ TRANSPORT — on émet via `console.error/warn/info` (PAS `console.log`).    │
 * │   But : rester visible dans `wrangler tail` et conserver le mapping de    │
 * │   sévérité natif du Worker runtime. Le PAYLOAD, lui, est une seule ligne  │
 * │   JSON (un seul argument string) → un collecteur la parse trivialement.   │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ RUNTIME — Cloudflare Workers (edge). Web standard uniquement :            │
 * │   `console.*`, `JSON.stringify`, `new Date().toISOString()`. Aucune API   │
 * │   Node, aucune dépendance npm. (`toISOString` EST supporté dans le Worker │
 * │   runtime applicatif — l'interdiction `Date.now()` ne vise que le harnais │
 * │   de workflow, pas le code applicatif servi en prod.)                     │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ 🔒 PAS DE PII / SECRET DANS LE PAYLOAD.                                    │
 * │   C'est à l'APPELANT de choisir ce qu'il passe dans `ctx`. Règle : logger │
 * │   des IDENTIFIANTS (user_id, booking_id, session_id, code d'erreur) et    │
 * │   des messages — JAMAIS d'email en clair, de téléphone, de token, de clé  │
 * │   API ni de donnée perso. Le logger ne filtre PAS pour vous : il sérialise │
 * │   ce qu'on lui donne. (Les `Error` sont réduites à `{ name, message }` —  │
 * │   pas de stack — par `serializeError`, pour éviter de fuiter des chemins/  │
 * │   détails internes dans les logs publics de staging.)                     │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ NE THROW JAMAIS. Un échec de log (console qui jette, ctx non sérialisable │
 * │   / circulaire) est avalé silencieusement : journaliser ne doit JAMAIS    │
 * │   casser la requête métier qu'on observe.                                 │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

/** Niveaux supportés, du plus au moins sévère. */
export type LogLevel = "error" | "warn" | "info";

/** Poids de filtrage : un niveau ne s'émet que si son poids ≥ seuil `LOG_LEVEL`. */
const LEVEL_WEIGHT: Record<LogLevel, number> = {
  info: 10,
  warn: 20,
  error: 30,
};

/**
 * Seuil minimal d'émission, piloté par l'env `LOG_LEVEL` (optionnel).
 *   • absent / invalide → "info" (tout passe — comportement par défaut).
 *   • "warn"            → seuls warn + error sont émis.
 *   • "error"          → seuls les error.
 * Lu paresseusement à chaque appel (pas de cache module : un Worker peut être
 * réutilisé entre requêtes, et c'est trivialement rapide).
 */
function seuil(): number {
  const raw = (process.env.LOG_LEVEL ?? "").trim().toLowerCase();
  if (raw === "error" || raw === "warn" || raw === "info") {
    return LEVEL_WEIGHT[raw];
  }
  return LEVEL_WEIGHT.info;
}

/**
 * Réduit une `Error` à un objet plat sérialisable `{ name, message }` (PAS la
 * stack : on évite de fuiter des chemins/détails internes dans des logs qui, en
 * staging, sont sur un environnement public). Exporté pour que les appelants
 * puissent normaliser une erreur attrapée avant de la passer dans `ctx`.
 *
 * @example
 *   } catch (err) {
 *     log.error("insert ticket échoué", { err: serializeError(err) });
 *   }
 */
export function serializeError(err: unknown): { name: string; message: string } {
  if (err instanceof Error) {
    return { name: err.name, message: err.message };
  }
  return { name: "NonError", message: String(err) };
}

/**
 * Construit la ligne JSON `{ level, scope, msg, ts, ...ctx }`.
 *
 * Les `Error` présentes dans `ctx` (à la racine) sont normalisées via
 * `serializeError`. La sérialisation est protégée : si `JSON.stringify` jette
 * (référence circulaire, valeur non sérialisable), on retombe sur une ligne
 * minimale qui n'inclut PAS le `ctx` fautif — on ne perd jamais le message.
 */
function formatLine(
  level: LogLevel,
  scope: string,
  msg: string,
  ctx?: Record<string, unknown>,
): string {
  const base: Record<string, unknown> = {
    level,
    scope,
    msg,
    ts: new Date().toISOString(),
  };

  if (ctx) {
    for (const [key, value] of Object.entries(ctx)) {
      // Ne jamais laisser une clé réservée du contexte écraser le cadre du log.
      if (key === "level" || key === "scope" || key === "msg" || key === "ts") {
        continue;
      }
      base[key] = value instanceof Error ? serializeError(value) : value;
    }
  }

  try {
    return JSON.stringify(base);
  } catch {
    // ctx non sérialisable (circulaire, BigInt, etc.) → on garde au moins le
    // cadre, sans le contexte fautif. Ne jette jamais.
    return JSON.stringify({ level, scope, msg, ts: base.ts });
  }
}

/** API d'un logger nommé. Le `scope` remplace le tag `[scope]` historique. */
export interface Logger {
  /**
   * Émet un log de niveau `error` (console.error).
   * @param msg message humain stable.
   * @param ctx contexte structuré — IDs et codes UNIQUEMENT, jamais de PII/secret.
   */
  error(msg: string, ctx?: Record<string, unknown>): void;
  /**
   * Émet un log de niveau `warn` (console.warn).
   * @param msg message humain stable.
   * @param ctx contexte structuré — IDs et codes UNIQUEMENT, jamais de PII/secret.
   */
  warn(msg: string, ctx?: Record<string, unknown>): void;
  /**
   * Émet un log de niveau `info` (console.info).
   * @param msg message humain stable.
   * @param ctx contexte structuré — IDs et codes UNIQUEMENT, jamais de PII/secret.
   */
  info(msg: string, ctx?: Record<string, unknown>): void;
}

/** Émet une ligne (best-effort, ne throw JAMAIS), en respectant le seuil. */
function emit(
  level: LogLevel,
  scope: string,
  msg: string,
  ctx?: Record<string, unknown>,
): void {
  try {
    if (LEVEL_WEIGHT[level] < seuil()) return;
    const line = formatLine(level, scope, msg, ctx);
    // Mapping niveau → méthode console (visible dans wrangler tail).
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.info(line);
  } catch {
    // Un log raté (console qui jette, etc.) ne casse JAMAIS la requête observée.
  }
}

/**
 * Crée un logger nommé par `scope`. Le `scope` remplace le tag `[scope]` du
 * format historique : `console.error("[cron] x", e)` → `createLogger("cron")`
 * puis `log.error("x", { err: serializeError(e) })`.
 *
 * @param scope nom court du module/route émetteur (ex. "cron", "checkout",
 *              "webhook:stripe", "reserver", "annuler", "auth/callback").
 */
export function createLogger(scope: string): Logger {
  return {
    error(msg, ctx) {
      emit("error", scope, msg, ctx);
    },
    warn(msg, ctx) {
      emit("warn", scope, msg, ctx);
    },
    info(msg, ctx) {
      emit("info", scope, msg, ctx);
    },
  };
}
