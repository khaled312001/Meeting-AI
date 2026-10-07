/** Cloudflare bindings (D1, KV, rate limiter) re-implemented on Node's
 *  built-in SQLite, so the unchanged worker can run on a plain Node host.
 *  Only the surface the worker actually uses is implemented. */

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";

type SqlValue = null | number | bigint | string | Uint8Array;

function toSql(v: unknown): SqlValue {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof Date) return Math.floor(v.getTime() / 1000);
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (typeof v === "number" || typeof v === "bigint" || typeof v === "string" || v instanceof Uint8Array) {
    return v;
  }
  return JSON.stringify(v);
}

export function openDatabase(file: string): DatabaseSync {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  return db;
}

/** D1 supports numbered params (?1 … ?N, reusable). Node 22's node:sqlite
 *  mis-binds those positionally ("column index out of range"), so rewrite
 *  them to plain `?` and expand the values in order of appearance. */
function expandNumberedParams(sql: string): { sql: string; order: number[] | null } {
  if (!/\?\d+/.test(sql)) return { sql, order: null };
  const order: number[] = [];
  const rewritten = sql.replace(/\?(\d+)/g, (_, n: string) => {
    order.push(Number(n) - 1);
    return "?";
  });
  return { sql: rewritten, order };
}

class PreparedStatement {
  private readonly sql: string;
  private readonly order: number[] | null;

  constructor(
    private readonly db: DatabaseSync,
    private readonly cache: Map<string, StatementSync>,
    rawSql: string,
    private readonly params: SqlValue[] = [],
  ) {
    const { sql, order } = expandNumberedParams(rawSql);
    this.sql = sql;
    this.order = order;
  }

  private stmt(): StatementSync {
    let s = this.cache.get(this.sql);
    if (!s) {
      s = this.db.prepare(this.sql);
      if (this.cache.size > 500) this.cache.clear();
      this.cache.set(this.sql, s);
    }
    return s;
  }

  bind(...values: unknown[]): PreparedStatement {
    const converted = values.map(toSql);
    const params = this.order ? this.order.map((i) => converted[i] ?? null) : converted;
    // this.sql is already rewritten; expandNumberedParams is a no-op on it.
    return new PreparedStatement(this.db, this.cache, this.sql, params);
  }

  async all<T = Record<string, unknown>>() {
    const results = this.stmt().all(...this.params) as T[];
    return { results, success: true as const, meta: this.meta(0) };
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = this.stmt().get(...this.params) as Record<string, unknown> | undefined;
    if (!row) return null;
    return (column ? (row[column] ?? null) : row) as T;
  }

  async run() {
    const r = this.stmt().run(...this.params);
    return { results: [], success: true as const, meta: this.meta(Number(r.changes), Number(r.lastInsertRowid)) };
  }

  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]> {
    const s = this.stmt();
    s.setReturnArrays(true);
    try {
      const rows = s.all(...this.params) as T[];
      if (options?.columnNames) return [s.columns().map((c) => c.name) as T, ...rows];
      return rows;
    } finally {
      s.setReturnArrays(false);
    }
  }

  private meta(changes: number, lastRowId = 0) {
    return {
      duration: 0,
      changes,
      last_row_id: lastRowId,
      changed_db: changes > 0,
      rows_read: 0,
      rows_written: changes,
      size_after: 0,
    };
  }
}

/** D1Database-compatible wrapper (prepare / batch / exec). */
export function createD1(db: DatabaseSync) {
  const cache = new Map<string, StatementSync>();
  return {
    prepare: (sql: string) => new PreparedStatement(db, cache, sql),
    async batch(statements: PreparedStatement[]) {
      db.exec("BEGIN");
      try {
        const out = [];
        for (const s of statements) out.push(await s.all());
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    async exec(sql: string) {
      db.exec(sql);
      return { count: 0, duration: 0 };
    },
  };
}

/** KVNamespace-compatible store (get / put / delete / list) in the same DB. */
export function createKv(db: DatabaseSync) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS _kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER)",
  );
  const nowSec = () => Math.floor(Date.now() / 1000);
  const getStmt = db.prepare("SELECT value, expires_at FROM _kv WHERE key = ?");
  const putStmt = db.prepare(
    "INSERT INTO _kv (key, value, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at",
  );
  const delStmt = db.prepare("DELETE FROM _kv WHERE key = ?");

  return {
    async get(key: string, type?: string | { type?: string }) {
      const row = getStmt.get(key) as { value: string; expires_at: number | null } | undefined;
      if (!row) return null;
      if (row.expires_at !== null && row.expires_at <= nowSec()) {
        delStmt.run(key);
        return null;
      }
      const t = typeof type === "string" ? type : type?.type;
      return t === "json" ? JSON.parse(row.value) : row.value;
    },
    async put(key: string, value: string, opts?: { expirationTtl?: number; expiration?: number }) {
      const expires = opts?.expiration ?? (opts?.expirationTtl ? nowSec() + opts.expirationTtl : null);
      putStmt.run(key, String(value), expires);
    },
    async delete(key: string) {
      delStmt.run(key);
    },
    async list(opts?: { prefix?: string; limit?: number }) {
      const rows = db
        .prepare("SELECT key FROM _kv WHERE key LIKE ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY key LIMIT ?")
        .all(`${(opts?.prefix ?? "").replace(/[%_]/g, "\\$&")}%`, nowSec(), opts?.limit ?? 1000) as { key: string }[];
      return { keys: rows.map((r) => ({ name: r.key })), list_complete: true, cursor: "" };
    },
    /** Drop expired rows (called from the hourly maintenance tick). */
    purgeExpired() {
      db.prepare("DELETE FROM _kv WHERE expires_at IS NOT NULL AND expires_at <= ?").run(nowSec());
    },
  };
}

/** Workers rate-limit binding: fixed window per key, shared across processes. */
export function createRateLimiter(db: DatabaseSync, limit: number, periodSec: number) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS _rate_limit (key TEXT NOT NULL, window INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (key, window))",
  );
  const bump = db.prepare(
    "INSERT INTO _rate_limit (key, window, count) VALUES (?, ?, 1) ON CONFLICT(key, window) DO UPDATE SET count = count + 1 RETURNING count",
  );
  const purge = db.prepare("DELETE FROM _rate_limit WHERE window < ?");
  return {
    async limit({ key }: { key: string }) {
      const window = Math.floor(Date.now() / 1000 / periodSec);
      const row = bump.get(key, window) as { count: number };
      if (Math.random() < 0.01) purge.run(window - 1);
      return { success: row.count <= limit };
    },
  };
}

/** Apply drizzle/*.sql in order, tracked in d1_migrations like wrangler. */
export function applyMigrations(db: DatabaseSync, dir: string): string[] {
  db.exec(
    "CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)",
  );
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const applied = new Set(
    (db.prepare("SELECT name FROM d1_migrations").all() as { name: string }[]).map((r) => r.name),
  );
  const done: string[] = [];
  const pending = files.filter((f) => !applied.has(f));
  if (pending.length === 0) return done;

  // Table rebuilds must not cascade; re-enable and verify afterwards.
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    for (const file of pending) {
      db.exec("BEGIN IMMEDIATE");
      try {
        // Another process may have applied it while we waited for the lock.
        if (db.prepare("SELECT 1 FROM d1_migrations WHERE name = ?").get(file)) {
          db.exec("COMMIT");
          continue;
        }
        db.exec(fs.readFileSync(path.join(dir, file), "utf8"));
        db.prepare("INSERT INTO d1_migrations (name) VALUES (?)").run(file);
        db.exec("COMMIT");
        done.push(file);
      } catch (e) {
        db.exec("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${e instanceof Error ? e.message : e}`);
      }
    }
    const broken = db.prepare("PRAGMA foreign_key_check").all();
    if (broken.length) throw new Error(`foreign_key_check failed after migrations: ${JSON.stringify(broken.slice(0, 5))}`);
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
  return done;
}
