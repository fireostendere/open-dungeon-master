// Executes source modules with an explicit dependency map. No implicit empty mocks.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
export function loadModule(filename, mocks = {}) {
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, { fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    reportDiagnostics: true });
  const errors = (output.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error);
  if (errors.length) throw Error(ts.formatDiagnosticsWithColorAndContext(errors, { getCanonicalFileName: x=>x, getCurrentDirectory: ()=>process.cwd(), getNewLine: ()=>'\n' }));
  const localModule = { exports: {} };
  const localRequire = createRequire(filename);
  const resolveDep = (name) => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith('@/')) {
      const bare = path.join(srcRoot, name.slice(2));
      if (fs.existsSync(bare) && fs.statSync(bare).isFile()) return localRequire(bare);
      if (fs.existsSync(`${bare}.ts`)) return loadModule(`${bare}.ts`, mocks);
      if (fs.existsSync(`${bare}.mjs`)) return localRequire(`${bare}.mjs`);
      if (fs.existsSync(`${bare}.js`)) return localRequire(`${bare}.js`);
      if (fs.existsSync(`${bare}.json`)) return localRequire(`${bare}.json`);
      if (fs.existsSync(path.join(bare, 'index.ts'))) return loadModule(path.join(bare, 'index.ts'), mocks);
      if (fs.existsSync(path.join(bare, 'index.js'))) return localRequire(path.join(bare, 'index.js'));
    }
    return localRequire(name);
  };
  new Function('require', 'module', 'exports', '__filename', '__dirname', output.outputText)(
    resolveDep, localModule, localModule.exports, filename, path.dirname(filename));
  return localModule.exports;
}
export function sqliteAdapter(db) {
  let depth = 0;
  return { prepare: sql=>db.prepare(sql), exec: sql=>db.exec(sql), transaction: work=>(...args)=>{
    const level=depth++;const save=`merge_test_${level}`;
    db.exec(level?`SAVEPOINT ${save}`:'BEGIN');
    try {const result=work(...args);db.exec(level?`RELEASE ${save}`:'COMMIT');return result;}
    catch(error){db.exec(level?`ROLLBACK TO ${save}; RELEASE ${save}`:'ROLLBACK');throw error;}
    finally{depth--;}
  } };
}
