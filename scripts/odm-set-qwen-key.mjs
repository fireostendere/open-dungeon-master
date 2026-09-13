// One-command restore of the Qwen (Token Plan) connection in ODM.
//
//   node scripts/odm-set-qwen-key.mjs --from-bl            # key from ~/.bailian/config.json
//   node scripts/odm-set-qwen-key.mjs --from-file PATH     # key from a file
//   cat key.txt | node scripts/odm-set-qwen-key.mjs --stdin
//   node scripts/odm-set-qwen-key.mjs --probe              # + live check after wiring
//
// Upserts the "Qwen Token Plan" LLM profile with the given key and applies it
// as the global DM default. The key is never printed. Typical recovery after
// regenerating the key on the subscription page:
//   bl auth login --config token-plan --api-key 'sk-sp-...'   # fixes bl itself
//   node scripts/odm-set-qwen-key.mjs --from-bl               # fixes ODM
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { fileURLToPath } from "node:url";

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
process.chdir(repo);
register("./lib/register-alias.mjs", import.meta.url);

const args = process.argv.slice(2);
let key = "";
if (args.includes("--from-bl")) {
  const cfgPath = path.join(os.homedir(), ".bailian", "config.json");
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  key = cfg?.["token-plan"]?.api_key || "";
  if (!key) {
    console.error("no token-plan api_key in ~/.bailian/config.json — run: bl auth login --config token-plan --api-key sk-sp-...");
    process.exit(1);
  }
} else if (args.includes("--from-file")) {
  key = fs.readFileSync(path.resolve(args[args.indexOf("--from-file") + 1]), "utf8").trim();
} else if (args.includes("--stdin")) {
  key = fs.readFileSync(0, "utf8").trim();
} else {
  console.error("usage: --from-bl | --from-file PATH | --stdin   (optionally add --probe)");
  process.exit(2);
}
if (!key.startsWith("sk-")) {
  console.error("that does not look like an sk-... key");
  process.exit(1);
}

const { listLlmProfiles, updateLlmProfile, createLlmProfile, applyLlmProfileToGlobal } = await import(
  "../src/lib/db/llm-profiles.ts"
);

const BASE = "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1";
const existing = listLlmProfiles().find((p) => p.baseUrl.startsWith("https://token-plan.") || /qwen token plan/i.test(p.name));
const profile = existing
  ? updateLlmProfile(existing.id, { apiKey: key })
  : createLlmProfile({
      name: "Qwen Token Plan",
      kind: "cloud-preset",
      preset: "dashscope",
      protocol: "openai-compatible",
      baseUrl: BASE,
      model: "qwen3.8-max",
      authMode: "api-key",
      apiKey: key,
    });
if (!profile) {
  console.error("failed to save the profile");
  process.exit(1);
}
applyLlmProfileToGlobal(profile.id);
console.log(`OK: profile "${profile.name}" (${profile.model}) updated and applied as global DM. Key: ${key.slice(0, 6)}...${key.slice(-4)} (masked).`);

if (args.includes("--probe")) {
  const { probeLlmProfile } = await import("../src/lib/llm-probe.ts");
  const report = await probeLlmProfile(
    { baseUrl: BASE, model: profile.model, apiKey: key, protocol: "openai-compatible" },
    { timeoutMs: 180000 },
  );
  for (const [stage, r] of Object.entries(report.stages)) {
    console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${stage}${r.detail ? ` — ${r.detail}` : ""}`);
  }
  console.log(report.ok ? "PROBE: OK — модель готова быть DM" : "PROBE: FAIL — см. детали выше");
  process.exit(report.ok ? 0 : 1);
}
