/**
 * Open the database, run migrations, and append event rows.
 *
 * The database address lives in an environment variable named by
 * `database_url_env` in config.yml. The address can contain a password, so it
 * is never written into config. A postgres:// or postgresql:// address uses
 * Postgres. If that variable is unset, we use a SQLite file,
 * `plgkit_events.sqlite`, in the current directory.
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";

export const DEFAULT_DATABASE_URL_ENV = "PLGKIT_DATABASE_URL";
export const DEFAULT_DATABASE_URL = "sqlite:///plgkit_events.sqlite";
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MIGRATION_NAME = /^(\d+)_.+\.sql$/;

export class PlgkitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlgkitError";
  }
}

export type SqlDB = {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  close?(): void;
};

let defaultDb: SqlDB | null = null;
let warnedDefault = false;
let silencedSqliteWarning = false;

export function resolveDatabaseURL(
  configPath?: string | null,
  environ?: Record<string, string | undefined>,
): { url: string; usedDefault: boolean } {
  const env = environ ?? process.env;
  const name = envVarName(configPath);
  const value = String(env[name] ?? "").trim();
  if (!value) return { url: DEFAULT_DATABASE_URL, usedDefault: true };
  const scheme = schemeOf(value);
  if (scheme === "sqlite" || scheme === "postgres" || scheme === "postgresql") {
    return { url: value, usedDefault: false };
  }
  throw new PlgkitError(
    `${name} uses the ${JSON.stringify(scheme)} scheme. ` +
      "plgkit supports SQLite (sqlite:///plgkit_events.sqlite) and Postgres (postgres:// or postgresql://). " +
      "Unset the variable to use the local SQLite file.",
  );
}

export function connect(url?: string | null): SqlDB {
  let resolved = url ?? "";
  if (!resolved) {
    const found = resolveDatabaseURL();
    resolved = found.url;
    if (found.usedDefault) warnDefault(envVarName(null));
  }
  const scheme = schemeOf(resolved);
  if (scheme === "sqlite") return openSqlite(resolved);
  if (scheme === "postgres" || scheme === "postgresql") return openPostgres(resolved);
  throw new PlgkitError(
    `Unsupported database scheme ${JSON.stringify(scheme)}. Use a SQLite URL or a Postgres URL (postgres:// or postgresql://).`,
  );
}

function openSqlite(url: string): SqlDB {
  silenceSqliteWarning();
  const db = new DatabaseSync(sqlitePath(url));
  db.exec("PRAGMA busy_timeout = 5000");
  return db as unknown as SqlDB;
}

function openPostgres(url: string): SqlDB {
  const readySab = new SharedArrayBuffer(4);
  const ready = new Int32Array(readySab);
  const worker = new Worker(new URL("./pg-worker.js", import.meta.url), {
    workerData: { url, ready: readySab },
  });
  Atomics.wait(ready, 0, 0, 10000);
  if (Atomics.load(ready, 0) !== 1) {
    worker.terminate();
    throw new PlgkitError("Could not open the database.");
  }
  return postgresDb(worker);
}

function postgresDb(worker: Worker): SqlDB {
  const ask = (sql: string, params: unknown[]): unknown[] => {
    const sab = new SharedArrayBuffer(256 * 1024);
    const view = new Int32Array(sab);
    worker.postMessage({ sql: postgresSQL(sql), params, sab });
    Atomics.wait(view, 0, 0, 30000);
    const status = Atomics.load(view, 0);
    if (status !== 1) throw new PlgkitError("Could not run the database statement.");
    const length = Atomics.load(view, 1);
    const text = Buffer.from(sab).subarray(8, 8 + length).toString("utf8");
    const rows = text ? JSON.parse(text) : [];
    return Array.isArray(rows) ? rows : [];
  };
  return {
    exec(sql: string) {
      ask(sql, []);
    },
    prepare(sql: string) {
      return {
        run(...params: unknown[]) {
          ask(sql, params);
        },
        get(...params: unknown[]) {
          return ask(sql, params)[0];
        },
        all(...params: unknown[]) {
          return ask(sql, params);
        },
      };
    },
    close() {
      worker.terminate();
    },
  };
}

function postgresSQL(sql: string): string {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

export function migrate(db?: SqlDB | null, migrationsDir?: string | null): SqlDB {
  const database = db ?? getDefaultDb();
  const directory = packagedMigrationsDir(migrationsDir);
  database.exec(
    "CREATE TABLE IF NOT EXISTS plgkit_schema_migrations (version TEXT PRIMARY KEY)",
  );
  const applied = new Set(
    (
      database.prepare("SELECT version FROM plgkit_schema_migrations").all() as {
        version: string;
      }[]
    ).map((row) => row.version),
  );
  for (const file of migrationFiles(directory)) {
    if (applied.has(file.version)) continue;
    const statements = sqlStatements(fs.readFileSync(file.path, "utf8"));
    database.exec("BEGIN");
    try {
      for (const statement of statements) database.exec(statement);
      database
        .prepare("INSERT INTO plgkit_schema_migrations (version) VALUES (?)")
        .run(file.version);
      database.exec("COMMIT");
    } catch {
      database.exec("ROLLBACK");
      throw new PlgkitError(`Migration ${file.version} failed.`);
    }
  }
  return database;
}

export function getDefaultDb(): SqlDB {
  if (!defaultDb) defaultDb = connect();
  return defaultDb;
}

export function setDefaultDb(db: SqlDB | null): void {
  defaultDb = db;
}

export function impression(nudgeId: string, event: Record<string, unknown> | null, db?: SqlDB | null): void {
  record("impression", nudgeId, event, db);
}

export function click(nudgeId: string, event: Record<string, unknown> | null, db?: SqlDB | null): void {
  record("click", nudgeId, event, db);
}

export function dismiss(nudgeId: string, event: Record<string, unknown> | null, db?: SqlDB | null): void {
  record("dismiss", nudgeId, event, db);
}

export function undismiss(nudgeId: string, event: Record<string, unknown> | null, db?: SqlDB | null): void {
  record("undismiss", nudgeId, event, db);
}

export function countImpressions(db: SqlDB, userId: string, nudgeId: string): number {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS n FROM plgkit_events WHERE user_id = ? AND nudge_id = ? AND action = 'impression'",
    )
    .get(userId, nudgeId) as { n: number | bigint };
  return Number(row.n);
}

export type ToggleEvent = {
  id: string;
  action: string;
  context: Record<string, unknown>;
  created_at: string;
};

export function dismissToggleEvents(db: SqlDB, userId: string, nudgeId: string): ToggleEvent[] {
  const rows = db
    .prepare(
      "SELECT id, action, context, created_at FROM plgkit_events WHERE user_id = ? AND nudge_id = ? AND action IN ('dismiss', 'undismiss') ORDER BY created_at, id",
    )
    .all(userId, nudgeId) as { id: string; action: string; context: string; created_at: string }[];
  const found: ToggleEvent[] = [];
  for (const row of rows) {
    let context: Record<string, unknown> = {};
    try {
      const data = JSON.parse(row.context);
      if (data && typeof data === "object" && !Array.isArray(data)) context = data;
    } catch {
      context = {};
    }
    found.push({ id: row.id, action: row.action, context, created_at: row.created_at });
  }
  return found;
}

function record(
  action: string,
  nudgeId: string,
  event: Record<string, unknown> | null,
  db?: SqlDB | null,
): void {
  if (typeof nudgeId !== "string" || nudgeId === "" || !event || typeof event !== "object") return;
  const userId = event.user_id;
  if (typeof userId !== "string" || userId === "") return;
  const context: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event)) {
    if (key === "user_id") continue;
    const cleaned = canon(value);
    if (cleaned.ok) context[key] = cleaned.value;
  }
  const database = db ?? getDefaultDb();
  database
    .prepare(
      "INSERT INTO plgkit_events (id, nudge_id, action, user_id, context, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(crypto.randomUUID(), nudgeId, action, userId, dumpContext(context), utcTimestamp());
}

export function canon(value: unknown): { ok: true; value: null | string | number | boolean } | { ok: false } {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return { ok: true, value };
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return { ok: true, value };
  }
  return { ok: false };
}

export function dumpContext(value: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) sorted[key] = value[key];
  return JSON.stringify(sorted);
}

function envVarName(configPath?: string | null): string {
  let file = configPath ?? null;
  if (!file) {
    const candidate = path.join(process.cwd(), "plgkit", "nudges", "config.yml");
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) file = candidate;
  }
  if (!file) return DEFAULT_DATABASE_URL_ENV;
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    throw new PlgkitError(`Could not read config file: ${file}`);
  }
  const parsed = parseDatabaseURLEnv(text);
  if (parsed == null) return DEFAULT_DATABASE_URL_ENV;
  if (!ENV_NAME.test(parsed)) {
    throw new PlgkitError(
      "database_url_env in config.yml must be the name of an environment variable, " +
        "not the database address. The address can contain a password, so put it in the environment. " +
        "Example: database_url_env: PLGKIT_DATABASE_URL",
    );
  }
  return parsed;
}

function parseDatabaseURLEnv(text: string): string | null {
  const found: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (raw.startsWith(" ") || raw.startsWith("\t")) continue;
    const line = raw.split("#", 1)[0].trim();
    if (!line.startsWith("database_url_env:")) continue;
    let value = line.slice("database_url_env:".length).trim();
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value[0] === value[value.length - 1]) {
      value = value.slice(1, -1);
    }
    found.push(value);
  }
  if (found.length === 0) return null;
  if (found.length > 1) throw new PlgkitError("database_url_env is set more than once in config.yml.");
  return found[0];
}

function schemeOf(url: string): string {
  if (url.startsWith("sqlite:")) return "sqlite";
  const mark = url.indexOf("://");
  if (mark >= 0) return url.slice(0, mark).toLowerCase();
  return "unknown";
}

function sqlitePath(url: string): string {
  if (url === "sqlite:///:memory:" || url === "sqlite::memory:") return ":memory:";
  const prefix = "sqlite:///";
  if (!url.startsWith(prefix)) {
    throw new PlgkitError(
      "The SQLite URL must look like sqlite:///plgkit_events.sqlite or sqlite:///:memory:.",
    );
  }
  return url.slice(prefix.length);
}

function migrationFiles(directory: string): { version: string; path: string }[] {
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    throw new PlgkitError(`Migrations folder does not exist: ${directory}`);
  }
  const found = fs
    .readdirSync(directory)
    .map((name) => ({ name, match: MIGRATION_NAME.exec(name) }))
    .filter((item) => item.match)
    .map((item) => ({
      version: item.match![1],
      path: path.join(directory, item.name),
    }))
    .sort((a, b) => Number(a.version) - Number(b.version));
  if (found.length === 0) throw new PlgkitError(`No migration files in ${directory}.`);
  return found;
}

function packagedMigrationsDir(override?: string | null): string {
  const chosen = (override || process.env.PLGKIT_MIGRATIONS_DIR || "").trim();
  if (chosen) {
    if (fs.existsSync(chosen) && fs.statSync(chosen).isDirectory()) return chosen;
    throw new PlgkitError("Migrations folder does not exist: " + chosen);
  }
  return fileURLToPath(new URL("../migrations", import.meta.url));
}

function sqlStatements(text: string): string[] {
  const stripped = text
    .split(/\r?\n/)
    .map((line) => (line.includes("--") ? line.slice(0, line.indexOf("--")) : line))
    .join("\n");
  return stripped
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

function utcTimestamp(): string {
  const now = new Date();
  const micro = Number(process.hrtime.bigint() % 1_000_000n);
  const pad = (value: number, width: number) => String(value).padStart(width, "0");
  return (
    `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1, 2)}-${pad(now.getUTCDate(), 2)}` +
    `T${pad(now.getUTCHours(), 2)}:${pad(now.getUTCMinutes(), 2)}:${pad(now.getUTCSeconds(), 2)}.` +
    `${pad(micro, 6)}Z`
  );
}

function warnDefault(name: string): void {
  if (warnedDefault) return;
  warnedDefault = true;
  console.error(
    `${name} is unset. Using a SQLite file at plgkit_events.sqlite in the current directory.`,
  );
}

function silenceSqliteWarning(): void {
  if (silencedSqliteWarning) return;
  silencedSqliteWarning = true;
  const emit = process.emitWarning.bind(process);
  process.emitWarning = ((warning: unknown, ...rest: unknown[]) => {
    const text = typeof warning === "string" ? warning : (warning as { message?: string })?.message ?? "";
    if (text.includes("SQLite is an experimental feature")) return;
    return (emit as (...args: unknown[]) => void)(warning, ...rest);
  }) as typeof process.emitWarning;
}
