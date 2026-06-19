import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Invariant de sécurité RLS — verrou anti-régression (faille monétisation P1).
 *
 * Source : QA sécu 2026-06-19
 *   (todo/2026-06-19-qa-secu-rls-tickets-bookings-insert-libre.md)
 *
 * La clé Supabase `anon` est publique. Les ÉCRITURES sur `tickets`/`bookings`
 * doivent TOUJOURS passer par la `service_role` (côté serveur, bypass RLS),
 * JAMAIS par une policy RLS write exploitable depuis le client anon. Une policy
 * write-client sur ces tables permettrait à un user de s'auto-créditer des
 * tickets / de forger des bookings (auto-résa, falsification de status/attendance).
 *
 * Ce test lit le SQL des migrations (source de vérité du schéma) et vérifie que :
 *   1. La migration corrective 0012 droppe bien les 3 policies write fautives.
 *   2. AUCUNE policy write (insert/update/delete/all) ne SUBSISTE sur
 *      tickets/bookings après application de toutes les migrations (net effect).
 *   3. Les policies SELECT (lecture par le user de SES lignes) sont conservées.
 *
 * Pas de DB live nécessaire : on raisonne sur le DDL déclaratif des migrations,
 * appliqué dans l'ordre lexicographique (= ordre d'exécution Supabase).
 */

const MIGRATIONS_DIR = path.resolve(__dirname, "../../supabase/migrations");

/** Lit toutes les migrations dans l'ordre d'exécution (tri lexicographique). */
function readMigrationsInOrder(): { name: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({
      name,
      sql: readFileSync(path.join(MIGRATIONS_DIR, name), "utf8"),
    }));
}

/**
 * Calcule l'état NET des policies write sur une table après application de
 * toutes les migrations dans l'ordre. Une policy est « vivante » si elle a été
 * créée et pas droppée par une migration ULTÉRIEURE (ou la même, après création).
 *
 * On scanne ligne à ligne les `create policy "<nom>" ... for <verb>` et
 * `drop policy if exists "<nom>"`, en ne retenant que les verbes write
 * (insert/update/delete/all) sur la table cible.
 */
type PolicyKind = "write" | "select";

function livePolicies(table: string, kind: PolicyKind): Set<string> {
  const live = new Set<string>();
  const migrations = readMigrationsInOrder();

  // Regex : `create policy "name" on public.<table> for <verb>` (multi-ligne :
  // le `for <verb>` peut être sur une ligne suivante). On capture le bloc entre
  // un `create policy` et le prochain `;`.
  const createBlockRe =
    /create\s+policy\s+"([^"]+)"\s+on\s+public\.(\w+)\s+for\s+(select|insert|update|delete|all)/gi;
  const dropRe = /drop\s+policy\s+if\s+exists\s+"([^"]+)"\s+on\s+public\.(\w+)/gi;

  for (const m of migrations) {
    // 1) creations de la table, filtrées par catégorie (write vs select)
    for (const match of m.sql.matchAll(createBlockRe)) {
      const [, name, tbl, verb] = match;
      if (tbl !== table) continue;
      const isSelect = verb.toLowerCase() === "select";
      if (kind === "write" && isSelect) continue;
      if (kind === "select" && !isSelect) continue;
      live.add(name);
    }
    // 2) drops (peuvent retirer une policy créée plus tôt OU dans la même
    //    migration en amont — `drop ... if exists` précède souvent le create).
    //    On applique les drops APRÈS les creates de la même migration pour
    //    capturer le pattern Supabase `drop if exists` + `create` (recréation).
    //    Mais ici le but est l'état FINAL : un drop sans recreate ultérieur
    //    retire la policy. On re-scanne donc les drops de cette migration et,
    //    s'ils ne sont PAS suivis d'un create du même nom dans la MÊME migration,
    //    on retire la policy.
    for (const dmatch of m.sql.matchAll(dropRe)) {
      const [, name, tbl] = dmatch;
      if (tbl !== table) continue;
      // Recréée dans la même migration ? (pattern idempotent drop+create)
      const recreatedSameMigration = new RegExp(
        `create\\s+policy\\s+"${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`,
        "is",
      ).test(m.sql);
      if (!recreatedSameMigration) live.delete(name);
    }
  }
  return live;
}

describe("RLS lockdown — écritures tickets/bookings via service_role uniquement", () => {
  it("la migration 0012 existe et droppe les 3 policies write fautives", () => {
    const file = readMigrationsInOrder().find((m) =>
      m.name.startsWith("0012_"),
    );
    expect(file, "migration 0012 introuvable").toBeDefined();
    const sql = file!.sql;
    expect(sql).toMatch(
      /drop\s+policy\s+if\s+exists\s+"tickets_insert_own"\s+on\s+public\.tickets/i,
    );
    expect(sql).toMatch(
      /drop\s+policy\s+if\s+exists\s+"bookings_insert_own"\s+on\s+public\.bookings/i,
    );
    expect(sql).toMatch(
      /drop\s+policy\s+if\s+exists\s+"bookings_update_own"\s+on\s+public\.bookings/i,
    );
    // Ne doit PAS recréer de policy write (sinon la faille revient).
    expect(sql).not.toMatch(/create\s+policy[^;]+for\s+(insert|update|delete|all)/i);
  });

  it("état net : AUCUNE policy write client ne subsiste sur tickets", () => {
    expect([...livePolicies("tickets", "write")]).toEqual([]);
  });

  it("état net : AUCUNE policy write client ne subsiste sur bookings", () => {
    expect([...livePolicies("bookings", "write")]).toEqual([]);
  });

  it("état net : les policies SELECT (lecture de SES lignes) restent vivantes", () => {
    // 0002 les droppe puis recrée (pattern idempotent), 0012 ne les touche pas
    // → elles doivent rester dans l'état final du schéma.
    expect([...livePolicies("tickets", "select")]).toContain("tickets_select_own");
    expect([...livePolicies("bookings", "select")]).toContain(
      "bookings_select_own",
    );
  });
});
