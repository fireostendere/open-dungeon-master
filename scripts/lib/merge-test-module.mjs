// Executes source modules with an explicit dependency map. No implicit empty mocks.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
export function loadModule(filename, mocks = {}) {
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, { fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    reportDiagnostics: true });
  const errors = (output.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error);
  if (errors.length) throw Error(ts.formatDiagnosticsWithColorAndContext(errors, { getCanonicalFileName: x=>x, getCurrentDirectory: ()=>process.cwd(), getNewLine: ()=>'\n' }));
  const module = { exports: {} };
  const localRequire = createRequire(filename);
  new Function('require', 'module', 'exports', '__filename', '__dirname', output.outputText)(
    name => Object.hasOwn(mocks, name) ? mocks[name] : localRequire(name), module, module.exports, filename, path.dirname(filename));
  return module.exports;
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
