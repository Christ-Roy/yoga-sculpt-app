import { vi } from "vitest";

/**
 * Helpers de mock pour les clients Supabase utilisés par les routes API.
 *
 * Le client Supabase expose un *query builder* fluide et thenable :
 *
 *   supabase.from("tickets").select("*").eq("user_id", id).order(...).limit(1)
 *
 * où chaque méthode de filtre/tri renvoie le builder (chaînage) et où le résultat
 * `{ data, error }` est obtenu soit par une méthode terminale (`single`,
 * `maybeSingle`), soit en `await`-ant directement le builder (qui est *thenable*).
 *
 * Ce helper fabrique un builder qui :
 *   - encaisse n'importe quelle suite de `.select/.eq/.gt/.or/.in/.order/.limit/...`
 *     (toutes renvoient `this`) ;
 *   - résout vers une réponse PROGRAMMÉE par `(table, op)` lorsqu'on l'`await` ou
 *     qu'on appelle `single()` / `maybeSingle()`.
 *
 * On programme les réponses via `queueResult(table, op, result)`. `op` ∈
 * { select, insert, update, upsert, delete }. Si plusieurs résultats sont mis en
 * file pour le même (table, op), ils sont consommés dans l'ordre (FIFO) — pratique
 * pour simuler une lecture puis une écriture sur la même table.
 */

export interface SupabaseResult<T = unknown> {
  data: T;
  error: { code?: string; message: string } | null;
  /**
   * Nombre de lignes — présent quand le code appelle `.select(col, { count })`
   * (ex. garde de plafond parrainage). Optionnel : la plupart des requêtes ne
   * le renvoient pas.
   */
  count?: number | null;
}

/**
 * Forme du retour des handlers TELLE QU'OBSERVÉE EN TEST : on mocke
 * `NextResponse.json` pour renvoyer `{ body, status }` plain-object. Le type réel
 * inféré du handler est `NextResponse` (extends Response) ; on caste donc le
 * résultat via `asMockResponse()` pour accéder à `body`/`status` sans heurter le
 * typecheck strict (`tsc --noEmit` couvre __tests__/).
 */
export interface MockedResponse {
  body: unknown;
  status: number;
  json?: () => Promise<unknown>;
}

/** Caste le retour d'un handler vers la forme observable mockée. */
export function asMockResponse(res: unknown): MockedResponse {
  return res as unknown as MockedResponse;
}

type Op = "select" | "insert" | "update" | "upsert" | "delete";

/** Une réponse renvoyée par défaut quand rien n'est programmé. */
const DEFAULT_RESULT: SupabaseResult = { data: null, error: null };

export interface MockSupabase {
  client: {
    from: ReturnType<typeof vi.fn>;
    auth: {
      getUser: ReturnType<typeof vi.fn>;
      admin: { getUserById: ReturnType<typeof vi.fn> };
    };
  };
  /** Programme la réponse de la prochaine op `op` sur `table` (FIFO). */
  queueResult: (table: string, op: Op, result: SupabaseResult) => void;
  /**
   * Programme la prochaine réponse de `auth.admin.getUserById` (FIFO). Sert au
   * lookup public du parrain (avatar dans raw_user_meta_data). Sans programmation
   * → renvoie `{ data: { user: null }, error: null }`.
   */
  queueAdminUser: (result: {
    data: { user: unknown } | null;
    error: { message: string } | null;
  }) => void;
  /** Trace de chaque op exécutée (table, op, payload + options éventuels). */
  calls: Array<{ table: string; op: Op; payload?: unknown; options?: unknown }>;
}

/**
 * Construit un client Supabase mocké (service_role ou user-scopé : même surface).
 *
 * @param user  utilisateur renvoyé par `auth.getUser()` (null = non authentifié).
 */
export function makeSupabaseMock(
  user: { id: string; email?: string; user_metadata?: Record<string, unknown> } | null = null,
): MockSupabase {
  const queues = new Map<string, SupabaseResult[]>();
  const calls: MockSupabase["calls"] = [];

  const key = (table: string, op: Op) => `${table}::${op}`;

  function nextResult(table: string, op: Op): SupabaseResult {
    const q = queues.get(key(table, op));
    if (q && q.length > 0) return q.shift() as SupabaseResult;
    return DEFAULT_RESULT;
  }

  function makeBuilder(table: string) {
    // L'op réelle est déterminée par la 1ʳᵉ méthode appelée (select/insert/...).
    let op: Op = "select";
    let payload: unknown;
    let options: unknown;
    let recorded = false;

    const resolve = () => {
      if (!recorded) {
        calls.push({ table, op, payload, options });
        recorded = true;
      }
      return nextResult(table, op);
    };

    // Builder : toutes les méthodes de filtre/tri renvoient `this`.
    const builder: Record<string, unknown> = {};

    const passthrough = [
      "select",
      "eq",
      "neq",
      "gt",
      "gte",
      "lt",
      "lte",
      "or",
      "in",
      "is",
      "not",
      "filter",
      "match",
      "order",
      "limit",
      "range",
      "returns",
      "onConflict",
    ];
    for (const m of passthrough) {
      builder[m] = vi.fn(() => builder);
    }

    // Méthodes qui FIXENT l'op et capturent le payload.
    builder.insert = vi.fn((p: unknown) => {
      op = "insert";
      payload = p;
      return builder;
    });
    builder.update = vi.fn((p: unknown) => {
      op = "update";
      payload = p;
      return builder;
    });
    builder.upsert = vi.fn((p: unknown, opts?: unknown) => {
      op = "upsert";
      payload = p;
      options = opts;
      return builder;
    });
    builder.delete = vi.fn(() => {
      op = "delete";
      return builder;
    });

    // Méthodes terminales : résolvent la réponse programmée.
    builder.single = vi.fn(async () => resolve());
    builder.maybeSingle = vi.fn(async () => resolve());

    // Thenable : `await builder` résout aussi la réponse (cas sans single()).
    builder.then = (
      onFulfilled?: (value: SupabaseResult) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(resolve()).then(onFulfilled, onRejected);

    return builder;
  }

  // File FIFO des réponses de auth.admin.getUserById (lookup avatar parrain).
  const adminUserQueue: Array<{
    data: { user: unknown } | null;
    error: { message: string } | null;
  }> = [];

  const client = {
    from: vi.fn((table: string) => makeBuilder(table)),
    auth: {
      getUser: vi.fn(async () => ({ data: { user }, error: null })),
      admin: {
        getUserById: vi.fn(async () =>
          adminUserQueue.length > 0
            ? adminUserQueue.shift()
            : { data: { user: null }, error: null },
        ),
      },
    },
  };

  return {
    client,
    calls,
    queueResult(table, op, result) {
      const k = key(table, op);
      const q = queues.get(k) ?? [];
      q.push(result);
      queues.set(k, q);
    },
    queueAdminUser(result) {
      adminUserQueue.push(result);
    },
  };
}
