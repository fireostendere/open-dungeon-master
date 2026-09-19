// One synchronous SQLite boundary for native encrypted and Node fallback engines.
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { withStatementCache } from "./statement-cache.mjs";
const localRequire = createRequire(import.meta.url);
type NodeSqlite = typeof import("node:sqlite");
function loadNodeSqlite(): NodeSqlite | null {
  const getBuiltinModule = (process as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule;
  if (typeof getBuiltinModule !== "function") return null;
  try { return (getBuiltinModule.call(process, "node:sqlite") as NodeSqlite | undefined) ?? null; }
  catch { return null; }
}
export interface RunResult { changes: number; lastInsertRowid: number | bigint; }
export interface SqliteStatement {
  run(...params: unknown[]): RunResult;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}
export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  pragma(source: string): unknown;
  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R;
  close(): void;
  readonly engine: "native" | "node";
  readonly encrypted: boolean;
}
export interface OpenOptions { readonly?: boolean; fileMustExist?: boolean; }
type Engine = "native" | "node";
let resolvedEngine: Engine | null = null;
function chooseEngine(): Engine {
  if (resolvedEngine) return resolvedEngine;
  const forced = process.env.ODM_SQLITE_DRIVER;
  if (forced === "node" || forced === "native") { resolvedEngine = forced; return forced; }
  resolvedEngine = loadNative() ? "native" : "node";
  return resolvedEngine;
}
type NativeModule = typeof import("better-sqlite3-multiple-ciphers");
let nativeModule: NativeModule | null | undefined;
function loadNative(): NativeModule | null {
  if (nativeModule !== undefined) return nativeModule;
  try { nativeModule = localRequire("better-sqlite3-multiple-ciphers") as NativeModule; }
  catch { nativeModule = null; }
  return nativeModule;
}
export function sqliteEngine(): Engine { return chooseEngine(); }
export function openDatabase(file: string, options: OpenOptions = {}): SqliteDatabase {
  const engine = chooseEngine();
  if (engine === "native") {
    const Native = loadNative();
    if (!Native) throw new Error("ODM_SQLITE_DRIVER=native but better-sqlite3-multiple-ciphers cannot be loaded.");
    return withStatementCache(wrapNative(new Native(file, options)));
  }
  return withStatementCache(openNode(file, options));
}
function wrapNative(db: import("better-sqlite3-multiple-ciphers").Database): SqliteDatabase {
  return {
    engine: "native", encrypted: true,
    prepare: (sql) => db.prepare(sql),
    exec: (sql) => { db.exec(sql); },
    pragma: (source) => db.pragma(source),
    transaction: (fn) => db.transaction(fn),
    close: () => { db.close(); },
  };
}
function openNode(file: string, options: OpenOptions): SqliteDatabase {
  const sqlite = loadNodeSqlite();
  if (!sqlite) throw new Error("No SQLite engine: the native module did not load and this Node has no built-in node:sqlite (needs Node 22.13 or newer).");
  const { DatabaseSync } = sqlite;
  if (options.fileMustExist && !existsSync(file)) throw new Error(`Database file not found: ${file}`);
  const db = new DatabaseSync(file, {
    readOnly: Boolean(options.readonly), enableForeignKeyConstraints: false, timeout: 5000,
  });
  let depth = 0;
  const transaction = <A extends unknown[], R>(fn: (...args: A) => R) => (...args: A): R => {
    const nested = depth > 0, name = `odm_sp_${depth}`;
    db.exec(nested ? `SAVEPOINT ${name}` : "BEGIN"); depth += 1;
    try {
      const result = fn(...args);
      db.exec(nested ? `RELEASE ${name}` : "COMMIT"); return result;
    } catch (error) {
      try { db.exec(nested ? `ROLLBACK TO ${name}; RELEASE ${name}` : "ROLLBACK"); } catch {}
      throw error;
    } finally { depth -= 1; }
  };
  return {
    engine: "node", encrypted: false,
    prepare: (sql) => {
      const statement = db.prepare(sql);
      return {
        run: (...params) => { const result = statement.run(...(params as never[])); return { changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid }; },
        get: (...params) => statement.get(...(params as never[])),
        all: (...params) => statement.all(...(params as never[])),
      };
    },
    exec: (sql) => { db.exec(sql); },
    pragma: (source) => db.prepare(`PRAGMA ${source}`).all(),
    transaction, close: () => { db.close(); },
  };
}
