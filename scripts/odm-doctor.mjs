// ODM doctor: one-shot health check of everything the table depends on.
// Prints PASS/FAIL per component with endpoints, never prints secrets.
//
//   node scripts/odm-doctor.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const results = [];

function readEnvFile(file) {
  const p = path.join(repo, file);
  if (!fs.existsSync(p)) return {};
  const out = {};
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
const envLocal = readEnvFile(".env.local");
const envServer = readEnvFile(".env.server");

async function probe(name, url, check) {
  const t0 = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    const ms = Date.now() - t0;
    const okStatus = resp.ok || resp.status === 401; // 401 = alive but gated
    const detail = check ? await check(resp) : `HTTP ${resp.status}`;
    results.push({
      name,
      ok: okStatus && (check ? detail !== null : true),
      detail: typeof detail === "string" ? detail : `HTTP ${resp.status}`,
      ms,
    });
  } catch (err) {
    results.push({ name, ok: false, detail: err.message?.slice(0, 120) || "unreachable", ms: Date.now() - t0 });
  }
}

function fileCheck(name, rel, hint) {
  const p = path.join(repo, rel);
  const exists = fs.existsSync(p);
  results.push({
    name,
    ok: exists,
    detail: exists ? `${rel} (${(fs.statSync(p).size / 2 ** 20).toFixed(1)} MB)` : `missing: ${rel} — ${hint}`,
  });
}

const appPort = 3005;
await probe("ODM server", `http://127.0.0.1:${appPort}/api/health`, async (r) => {
  const d = await r.json().catch(() => null);
  return d?.ok ? "healthy" : null;
});

fileCheck("App database", "data/local-roleplay.sqlite", "created on first server start");
fileCheck("Content pack (Open5e SRD)", "data/content/open5e.sqlite", "node scripts/fetch-content-pack.mjs");
results.push({
  name: "DB encryption key",
  ok: Boolean(envServer.DB_ENCRYPTION_KEY),
  detail: envServer.DB_ENCRYPTION_KEY ? ".env.server present (value hidden)" : "DB_ENCRYPTION_KEY missing in .env.server",
});

const ollamaBase = envLocal.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
await probe("Ollama (local text)", `${ollamaBase}/api/tags`, async (r) => {
  const d = await r.json().catch(() => null);
  const models = (d?.models || []).map((m) => m.name).slice(0, 5).join(", ");
  return models ? `models: ${models}` : "no models installed";
});

const textBase = envLocal.OPENAI_COMPAT_BASE_URL || "(not set — built-in default :8001)";
results.push({
  name: "Configured text backend",
  ok: Boolean(envLocal.OPENAI_COMPAT_BASE_URL),
  detail: `${textBase}${envLocal.OPENAI_COMPAT_MODEL ? ` model=${envLocal.OPENAI_COMPAT_MODEL}` : ""}`,
});
if (envLocal.OPENAI_COMPAT_BASE_URL) {
  await probe("Text backend reachable", envLocal.OPENAI_COMPAT_BASE_URL.replace(/\/+$/, "") + "/models");
}

const comfyBase = envLocal.COMFYUI_URL || "http://127.0.0.1:8188";
await probe("ComfyUI (images)", `${comfyBase}/system_stats`, async (r) => {
  const d = await r.json().catch(() => null);
  const dev = d?.devices?.[0]?.name;
  return dev ? `device: ${dev}` : "reachable";
});
if (fs.existsSync("/home/devil/ai/comfyui/models/checkpoints")) {
  const ckpts = fs
    .readdirSync("/home/devil/ai/comfyui/models/checkpoints")
    .filter((f) => f.endsWith(".safetensors"));
  results.push({ name: "ComfyUI checkpoints", ok: ckpts.length > 0, detail: ckpts.join(", ") || "none" });
}

// LAN / VPN addresses the owner can hand to friends.
const ifaces = os.networkInterfaces();
const addrs = [];
for (const [name, list] of Object.entries(ifaces)) {
  if (name === "lo") continue;
  for (const iface of list || []) {
    if (
      iface.family === "IPv4" &&
      !iface.address.startsWith("127.") &&
      !iface.address.startsWith("172.") &&
      iface.address !== "10.255.255.254" // WSL-internal DNS relay, not joinable
    ) {
      addrs.push(iface.address);
    }
  }
}
results.push({
  name: "Join addresses",
  ok: addrs.length > 0,
  detail: addrs.map((a) => `http://${a}:${appPort}`).join("  |  "),
});

let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ms !== undefined ? ` (${r.ms}ms)` : ""}: ${r.detail}`);
}
console.log(failed === 0 ? "\ndoctor: all green" : `\ndoctor: ${failed} problem(s)`);
process.exit(failed === 0 ? 0 : 1);
