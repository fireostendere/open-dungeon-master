/** Bounded per-connection statement reuse. Cache programs, never row values.
 * The wrapper exposes no mutable statement binding/configuration API. DDL,
 * transaction rollback, PRAGMA changes and close invalidate prepared handles.
 */
export function withStatementCache(db, capacity = 128) {
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 1024) throw new Error('Invalid statement cache capacity');
  const statements = new Map();
  const clear = () => statements.clear();
  return {
    engine: db.engine, encrypted: db.encrypted,
    prepare(sql) {
      const hit = statements.get(sql);
      if (hit) { statements.delete(sql); statements.set(sql,hit); return hit; }
      const prepared = db.prepare(sql);
      const statement = {
        run: (...args) => prepared.run(...args),
        get: (...args) => prepared.get(...args),
        all: (...args) => prepared.all(...args),
      };
      if (statements.size >= capacity) statements.delete(statements.keys().next().value);
      statements.set(sql,statement); return statement;
    },
    exec(sql) { try { return db.exec(sql); } finally { clear(); } },
    pragma(sql) { try { return db.pragma(sql); } finally { clear(); } },
    transaction(fn) {
      const run = db.transaction(fn);
      return (...args) => { try { return run(...args); } catch(error) { clear(); throw error; } };
    },
    close() { clear(); return db.close(); },
  };
}
