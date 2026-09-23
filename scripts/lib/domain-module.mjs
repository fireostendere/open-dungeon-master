// Execute committed TypeScript modules with a fixture DB and explicitly
// substituted service/auth/embedding adapters. Actual SQL and version logic
// are not replaced. Module caching preserves production-style singleton scope.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
export function domainModules(mocks) {
  const cache = new Map();
  function load(name) {
    if (Object.hasOwn(mocks,name)) return mocks[name];
    let filename = name.startsWith('@/') ? path.join(root,'src',name.slice(2)) : name;
    if (!path.isAbsolute(filename)) return require(name);
    if (!path.extname(filename)) filename += '.ts';
    if (cache.has(filename)) return cache.get(filename).exports;
    if (filename.endsWith('.mjs')) return require(filename);
    const source = fs.readFileSync(filename,'utf8');
    const result = ts.transpileModule(source,{fileName:filename,reportDiagnostics:true,
      compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}});
    const errors=(result.diagnostics??[]).filter(x=>x.category===ts.DiagnosticCategory.Error);
    if(errors.length) throw new Error(ts.formatDiagnostics(errors,{getCanonicalFileName:f=>f,getCurrentDirectory:()=>root,getNewLine:()=> '\n'}));
    const module={exports:{}};cache.set(filename,module);
    const localRequire=dep=>dep.startsWith('.')?load(path.resolve(path.dirname(filename),dep)):load(dep);
    const code = result.outputText.includes('import.meta')
      ? result.outputText.replace(/\bimport\.meta\.url\b/g, JSON.stringify(pathToFileURL(filename).href))
      : result.outputText;
    new Function('require','module','exports',code)(localRequire,module,module.exports);
    return module.exports;
  }
  return load;
}
