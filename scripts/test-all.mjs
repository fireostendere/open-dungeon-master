// Run all suites, including vm.SourceTextModule suites, without relying on a
// caller's NODE_OPTIONS. A failed or killed child always fails the runner.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const tests = readdirSync(scriptsDir)
  .filter((name) => /^test-.*\.mjs$/.test(name) && name !== "test-all.mjs").sort();
if (!tests.length) { console.error("No test scripts found."); process.exit(1); }
for (const name of tests) {
  console.log(`\n=== ${name} ===`);
  const result = spawnSync(process.execPath, ["--experimental-vm-modules", path.join(scriptsDir, name)], { stdio: "inherit" });
  if (result.error || result.signal || result.status !== 0) {
    console.error(`\n${name} failed.`, result.error?.message ?? result.signal ?? "");
    process.exit(result.status || 1);
  }
}
console.log(`\nAll ${tests.length} test suites passed.`);
