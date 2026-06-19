# [P2] Observabilité — logs structurés légers (prêts pour un collecteur plus tard)

**Statut** : à faire · **Qui** : agent · **Source** : demande Robert 2026-06-19

## Besoin
Aujourd'hui : ~127 `console.error/warn/info/log` dans `src/`, tous avec une convention
de tag cohérente `console.error("[scope] message", ...)`. C'est lisible via
`wrangler tail` mais NON structuré → pas exploitable par un collecteur (pas de niveau
machine-lisible, pas de contexte JSON, pas de corrélation).

Objectif : un **logger structuré léger** (zéro dépendance externe, edge-safe) qui émet
des lignes JSON `{ level, scope, msg, ...ctx, ts }` — lisibles à l'œil en dev ET
parsables par un collecteur (Grafana/Logpush) le jour où on branche l'obs. PAS de mail,
PAS de service externe maintenant (env staging public → jamais de secret/OAuth dessus).

## API imposée (ne pas réinventer)
`src/lib/log.ts` :
```ts
// Un logger nommé par scope. Le scope remplace le tag "[scope]" actuel.
export function createLogger(scope: string): {
  error(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
};
```
- Émet en `console.error/warn/info` (pour rester visible dans `wrangler tail` + ne rien
  changer au transport). Le PAYLOAD devient un JSON : `{level,scope,msg,ts,...ctx}`.
- `ts` : timestamp ISO. ⚠️ edge : `Date.now()`/`new Date()` OK dans le Worker runtime
  (c'est le harnais de workflow Claude qui les interdit, pas le code applicatif) — vérifier.
- JAMAIS de secret/PII brut dans `ctx` : pas d'email en clair, pas de token, pas de clé.
  Logger des ids (user_id, booking_id, session_id) et des messages, pas des données perso.
- Ne JAMAIS throw (un échec de log ne casse jamais la requête).

## Migration (par priorité, pas tout d'un coup)
1. Créer `src/lib/log.ts` + son test unitaire (format JSON, niveaux, pas de throw, ctx).
2. Migrer EN PRIORITÉ les chemins critiques (obs utile) : `api/webhooks/stripe`,
   `api/checkout`, `api/annuler`, `api/reserver`, `api/cron`, `auth/callback`,
   `lib/brevo`, `lib/notify-alice`, `lib/referral`. Remplacer `console.error("[scope] x", e)`
   par `log.error("x", { err: ... })` avec `const log = createLogger("scope")`.
3. Le reste (admin/*, data) peut suivre progressivement — pas bloquant.
4. NE PAS casser les tests : certains tests asservissent `console.error` (ex. vérifient
   qu'un fail-safe logge). Adapter ces tests au nouveau format si besoin, garder 507 verts.

## Garde-fous
- Edge runtime, pas de Node API. Pas de dépendance npm.
- `tsc --noEmit` + `vitest run` verts. `check-env-sync` (si une var LOG_LEVEL est ajoutée,
  la documenter dans `.env.example`).
- Optionnel : `LOG_LEVEL` (env) pour filtrer (defaut: tout). Documenter si ajouté.

## Hors scope (décidé avec Robert)
- PAS de branchement Grafana/collecteur maintenant (juste rendre les logs prêts).
- PAS de rappels mail en staging (anti-spam, env public).
