// Behavioral test harness: executes the actual TypeScript module, injecting
// named dependencies. It never copies a production decision into the test.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ts = require("typescript");

export function loadReviewModule(filename, mocks = {}) {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    reportDiagnostics: true,
  });
  const errors = (output.diagnostics ?? []).filter((entry) => entry.category === ts.DiagnosticCategory.Error);
  if (errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, {
    getCanonicalFileName: (f) => f, getCurrentDirectory: () => process.cwd(), getNewLine: () => "\n",
  }));
  const module = { exports: {} };
  const localRequire = createRequire(filename);
  const injectedRequire = (name) => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    return localRequire(name);
  };
  new Function("require", "module", "exports", "__filename", "__dirname", output.outputText)(
    injectedRequire, module, module.exports, filename, path.dirname(filename),
  );
  return module.exports;
}

export function namedImports(filename) {
  const file = ts.createSourceFile(filename, fs.readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true);
  return file.statements.filter(ts.isImportDeclaration).flatMap((entry) => {
    const clause = entry.importClause;
    if (!clause || clause.isTypeOnly || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) return [];
    return clause.namedBindings.elements.filter((item) => !item.isTypeOnly).map((item) => ({
      from: entry.moduleSpecifier.text, name: item.propertyName?.text ?? item.name.text,
    }));
  });
}

// A real node:sqlite database with the application's synchronous transaction
// contract, including nested savepoints. No SQL operations are mocked.
export function sqliteAdapter(db) {
  let depth = 0;
  return {
    prepare: (sql) => db.prepare(sql), exec: (sql) => db.exec(sql),
    transaction: (work) => (...args) => {
      const level = depth++; const name = `review_${level}`;
      db.exec(level ? `SAVEPOINT ${name}` : "BEGIN");
      try {
        const result = work(...args);
        db.exec(level ? `RELEASE ${name}` : "COMMIT");
        return result;
      } catch (error) {
        db.exec(level ? `ROLLBACK TO ${name}; RELEASE ${name}` : "ROLLBACK");
        throw error;
      } finally { depth--; }
    },
  };
}
