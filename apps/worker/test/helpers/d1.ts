import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

/** Every migration in order, as D1 would apply them. */
export function migrationsSql(): string {
  const dir = new URL("../../migrations/", import.meta.url);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(new URL(f, dir), "utf8"))
    .join("\n");
}

/**
 * Enough of D1's API over node:sqlite to run the real SQL: prepare/bind,
 * first, run, all (RETURNING included) and batch. Bound parameters are
 * capped at 100, as D1 caps them.
 */
export function fakeD1(sql = migrationsSql()) {
  const raw = new DatabaseSync(":memory:");
  raw.exec(sql);
  let failing: RegExp | null = null;
  const check = (q: string) => {
    if (failing !== null && failing.test(q)) throw new Error("D1_ERROR: injected failure");
  };
  const prepare = (q: string) => {
    let args: unknown[] = [];
    const stmt = {
      bind(...a: unknown[]) {
        if (a.length > 100) throw new Error("D1_ERROR: too many SQL variables");
        args = a;
        return stmt;
      },
      async first<T>() { check(q); return ((raw.prepare(q).get(...(args as never[])) as T | undefined) ?? null); },
      async run() { check(q); const r = raw.prepare(q).run(...(args as never[])); return { meta: { changes: Number(r.changes) } }; },
      async all<T>() { check(q); return { results: raw.prepare(q).all(...(args as never[])) as T[] }; },
      _run() { check(q); raw.prepare(q).run(...(args as never[])); },
    };
    return stmt;
  };
  const batch = async (stmts: Array<{ _run: () => void }>) => {
    raw.exec("BEGIN");
    try { for (const s of stmts) s._run(); raw.exec("COMMIT"); } catch (e) { raw.exec("ROLLBACK"); throw e; }
    return [];
  };
  return {
    raw,
    db: { prepare, batch } as unknown as D1Database,
    /** Make every query matching this fail, until called with null. */
    fail(re: RegExp | null) { failing = re; },
  };
}
