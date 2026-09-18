// Execute actual TS/TSX modules with explicit dependency replacements.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
export function loadReviewModule(filename, mocks = {}) {
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {fileName: filename,
    compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true}, reportDiagnostics: true});
  const errors = (output.diagnostics ?? []).filter(x => x.category === ts.DiagnosticCategory.Error);
  if (errors.length) throw new Error(ts.formatDiagnostics(errors, {getCanonicalFileName: f => f, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n'}));
  const module = {exports:{}};
  const localRequire = createRequire(filename);
  const resolveDep = (name) => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith('@/')) {
      const bare = path.join(srcRoot, name.slice(2));
      if (fs.existsSync(bare) && fs.statSync(bare).isFile()) return localRequire(bare);
      if (fs.existsSync(`${bare}.ts`)) return loadReviewModule(`${bare}.ts`, mocks);
      if (fs.existsSync(`${bare}.tsx`)) return loadReviewModule(`${bare}.tsx`, mocks);
      if (fs.existsSync(`${bare}.mjs`)) return localRequire(`${bare}.mjs`);
      if (fs.existsSync(`${bare}.js`)) return localRequire(`${bare}.js`);
      if (fs.existsSync(`${bare}.json`)) return localRequire(`${bare}.json`);
      if (fs.existsSync(path.join(bare, 'index.ts'))) return loadReviewModule(path.join(bare, 'index.ts'), mocks);
      if (fs.existsSync(path.join(bare, 'index.tsx'))) return loadReviewModule(path.join(bare, 'index.tsx'), mocks);
      if (fs.existsSync(path.join(bare, 'index.js'))) return localRequire(path.join(bare, 'index.js'));
    }
    return localRequire(name);
  };
  new Function('require','module','exports','__filename','__dirname',output.outputText)(
    resolveDep, module,module.exports,filename,path.dirname(filename));
  return module.exports;
}
export function namedImports(filename) {
  const file = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
  return file.statements.filter(ts.isImportDeclaration).flatMap(entry => {
    const clause = entry.importClause;
    if (!clause || clause.isTypeOnly || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) return [];
    return clause.namedBindings.elements.filter(item => !item.isTypeOnly).map(item => ({
      from: entry.moduleSpecifier.text, name: item.propertyName?.text ?? item.name.text,
    }));
  });
}
export function sqliteAdapter(db) {
  let depth = 0;
  return {
    prepare: sql => db.prepare(sql), exec: sql => db.exec(sql),
    transaction: work => (...args) => {
      const level = depth++; const name = `review_${level}`;
      db.exec(level ? `SAVEPOINT ${name}` : 'BEGIN');
      try {
        const result = work(...args);
        db.exec(level ? `RELEASE ${name}` : 'COMMIT');
        return result;
      } catch (error) {
        db.exec(level ? `ROLLBACK TO ${name}; RELEASE ${name}` : 'ROLLBACK');
        throw error;
      } finally { depth--; }
    },
  };
}
