// LLM connection wizard: profile store, SSRF guard, and the real-probe
// pipeline against a local mock OpenAI-compatible server. Deterministic,
// no external network. The mock answers /v1/models, plain chat, SSE stream
// and a proper tool-call round trip; failure paths (401, 429, text-only
// "tool call", invalid JSON args, timeout) are served on demand.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-llm-profiles-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.chdir(dir);

register("./lib/register-alias.mjs", import.meta.url);

const {
  createLlmProfile,
  getLlmProfile,
  listLlmProfiles,
  updateLlmProfile,
  updateLlmProfileCheck,
  deleteLlmProfile,
  applyLlmProfileToGlobal,
} = await import("../src/lib/db/llm-profiles.ts");
const { maskLlmProfile } = await import("../src/lib/schemas/llm-profile.ts");
const { assertSafeEndpointUrl, SsrfError } = await import("../src/lib/url-guard.ts");
const { probeLlmProfile, fetchModelList } = await import("../src/lib/llm-probe.ts");
const { getGlobalConfig } = await import("../src/lib/db/app-settings.ts");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const profileInput = {
  name: "Локальный Qwen",
  kind: "local-runtime",
  preset: "ollama",
  protocol: "openai-compatible",
  baseUrl: "http://127.0.0.1:11434/v1",
  model: "qwen3.8-dm",
  authMode: "none",
};

// --- Profile store ---

await test("create + list masks the API key", () => {
  const created = createLlmProfile({ ...profileInput, apiKey: "secret-key-123" });
  assert.ok(created.id);
  assert.equal(created.apiKey, "secret-key-123");
  const masked = maskLlmProfile(created);
  assert.equal(masked.apiKey, undefined);
  assert.equal(masked.hasApiKey, true);
  const listed = listLlmProfiles();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].hasApiKey, true);
  assert.ok(!JSON.stringify(listed).includes("secret-key-123"), "key leaked into list");
});

await test("update keeps the key when apiKey is undefined, clears on empty string", () => {
  const existing = listLlmProfiles()[0];
  const kept = updateLlmProfile(existing.id, { name: "Переименован" });
  assert.equal(kept.name, "Переименован");
  assert.equal(kept.apiKey, "secret-key-123", "undefined apiKey must keep the stored key");
  const cleared = updateLlmProfile(existing.id, { apiKey: "" });
  assert.equal(cleared.apiKey, "");
  updateLlmProfile(existing.id, { apiKey: "secret-key-123" });
});

await test("lastCheck persists and delete removes", () => {
  const existing = listLlmProfiles()[0];
  const checked = updateLlmProfileCheck(existing.id, {
    at: new Date().toISOString(),
    ok: true,
    stages: { chat: { ok: true, ms: 5 } },
  });
  assert.equal(checked.lastCheck.ok, true);
  assert.ok(getLlmProfile(existing.id));
  assert.equal(deleteLlmProfile(existing.id), true);
  assert.equal(getLlmProfile(existing.id), null);
  assert.equal(deleteLlmProfile(existing.id), false);
});

await test("apply to global writes the existing config fields (no parallel store)", () => {
  const created = createLlmProfile({ ...profileInput, apiKey: "global-key" });
  assert.equal(applyLlmProfileToGlobal(created.id), true);
  const cfg = getGlobalConfig();
  assert.equal(cfg.text.provider, "custom");
  assert.equal(cfg.text.customBaseUrl, profileInput.baseUrl);
  assert.equal(cfg.text.customModel, profileInput.model);
  assert.equal(cfg.text.customApiKey, "global-key");
  deleteLlmProfile(created.id);
});

// --- SSRF guard ---

await test("url guard blocks dangerous targets and allows local/LAN servers", () => {
  const blocked = [
    "file:///etc/passwd",
    "gopher://127.0.0.1:25/x",
    "http://169.254.169.254/latest/meta-data/",
    "http://[fd00:ec2::254]/metadata",
    "http://169.254.10.20/anything",
    "http://metadata.google.internal/computeMetadata",
    "not a url",
  ];
  for (const raw of blocked) {
    assert.throws(() => assertSafeEndpointUrl(raw), SsrfError, `should block ${raw}`);
  }
  const allowed = [
    "http://127.0.0.1:11434/v1",
    "http://localhost:8080",
    "http://192.168.1.50:1234/v1",
    "https://openrouter.ai/api/v1",
  ];
  for (const raw of allowed) {
    assert.doesNotThrow(() => assertSafeEndpointUrl(raw), `should allow ${raw}`);
  }
});

// --- Probe against a mock server ---

const sseChunk = (obj) => `data: ${JSON.stringify(obj)}\n\n`;

function startMock(handler) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => handler(req, res, raw));
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

const chatBody = (raw) => JSON.parse(raw || "{}");

const toolCallMessage = {
  choices: [
    {
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "probe_echo", arguments: '{"word":"куб","n":7}' },
          },
        ],
      },
    },
  ],
};

const jsonResponse = (res, body) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

await test("probe happy path: all stages pass against a capable mock", async () => {
  const { server, port } = await startMock((req, res, raw) => {
    if (req.url.endsWith("/models")) {
      return jsonResponse(res, { data: [{ id: "mock-model" }] });
    }
    const body = chatBody(raw);
    const last = body.messages?.[body.messages.length - 1];
    if (last?.role === "tool") {
      return jsonResponse(res, {
        choices: [{ message: { role: "assistant", content: "Готово: куб, 7." } }],
      });
    }
    if (body.tools?.length) {
      return jsonResponse(res, toolCallMessage);
    }
    if (body.stream) {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(sseChunk({ choices: [{ delta: { content: "стол" } }] }));
      res.write(sseChunk({ choices: [{ delta: { content: "." } }] }));
      res.write("data: [DONE]\n\n");
      return res.end();
    }
    return jsonResponse(res, {
      choices: [{ message: { role: "assistant", content: "стол" } }],
    });
  });
  try {
    const report = await probeLlmProfile({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      model: "mock-model",
      protocol: "openai-compatible",
    });
    assert.equal(report.ok, true, JSON.stringify(report.stages));
    assert.equal(report.capabilities.tools, true);
    assert.equal(report.capabilities.streaming, true);
    assert.equal(report.capabilities.modelListed, true);
    for (const stage of ["models", "chat", "stream", "tool_call", "tool_result"]) {
      assert.equal(report.stages[stage]?.ok, true, `stage ${stage} failed`);
      assert.ok(report.stages[stage].ms >= 0);
    }
    const list = await fetchModelList(`http://127.0.0.1:${port}/v1`);
    assert.deepEqual(list.models, ["mock-model"]);
  } finally {
    server.close();
  }
});

await test("probe fails honestly when the model only names the tool in text", async () => {
  const { server, port } = await startMock((req, res, raw) => {
    if (req.url.endsWith("/models")) {
      return jsonResponse(res, { data: [{ id: "mock-model" }] });
    }
    const body = chatBody(raw);
    if (body.tools?.length) {
      // The classic fake: prose instead of a real tool_calls payload.
      return jsonResponse(res, {
        choices: [
          { message: { role: "assistant", content: "Я вызову probe_echo со словом куб." } },
        ],
      });
    }
    return jsonResponse(res, {
      choices: [{ message: { role: "assistant", content: "стол" } }],
    });
  });
  try {
    const report = await probeLlmProfile({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      model: "mock-model",
    });
    assert.equal(report.ok, false);
    assert.equal(report.capabilities.tools, false);
    assert.equal(report.stages.tool_call.ok, false);
    assert.match(report.stages.tool_call.detail, /текст|не вызвал/);
  } finally {
    server.close();
  }
});

await test("probe rejects invalid tool-call JSON arguments", async () => {
  const { server, port } = await startMock((req, res, raw) => {
    if (req.url.endsWith("/models")) {
      return jsonResponse(res, { data: [] });
    }
    const body = chatBody(raw);
    if (body.tools?.length) {
      return jsonResponse(res, {
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "c1",
                  type: "function",
                  function: { name: "probe_echo", arguments: "{word: куб,,," },
                },
              ],
            },
          },
        ],
      });
    }
    return jsonResponse(res, {
      choices: [{ message: { role: "assistant", content: "стол" } }],
    });
  });
  try {
    const report = await probeLlmProfile({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      model: "mock-model",
    });
    assert.equal(report.ok, false);
    assert.match(report.stages.tool_call.detail, /невалидные аргументы/);
  } finally {
    server.close();
  }
});

await test("probe maps 401 to an auth message", async () => {
  const { server, port } = await startMock((req, res) => {
    if (req.url.endsWith("/models")) {
      res.writeHead(401).end("{}");
      return;
    }
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "bad key" } }));
  });
  try {
    const report = await probeLlmProfile({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      model: "mock-model",
      apiKey: "wrong-key",
    });
    assert.equal(report.ok, false);
    assert.equal(report.stages.models.ok, false);
    assert.match(report.stages.models.detail, /ключ|доступ/);
    assert.equal(report.stages.chat.ok, false);
  } finally {
    server.close();
  }
});

await test("probe maps 429 to an overload message", async () => {
  const { server, port } = await startMock((req, res) => {
    if (req.url.endsWith("/models")) {
      return jsonResponse(res, { data: [] });
    }
    res.writeHead(429).end("slow down");
  });
  try {
    const report = await probeLlmProfile({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      model: "mock-model",
    });
    assert.equal(report.ok, false);
    assert.match(report.stages.chat.detail, /429|перегружен/i);
  } finally {
    server.close();
  }
});

await test("probe reports a timeout when the backend stalls", async () => {
  const { server, port } = await startMock((req, res) => {
    if (req.url.endsWith("/models")) {
      return jsonResponse(res, { data: [] });
    }
    // Never answer the chat request; the probe's own timeout must fire.
    setTimeout(() => res.end(), 30_000).unref();
  });
  try {
    const report = await probeLlmProfile(
      { baseUrl: `http://127.0.0.1:${port}/v1`, model: "mock-model" },
      { timeoutMs: 700 },
    );
    assert.equal(report.ok, false);
    assert.match(report.stages.chat.detail, /Таймаут/);
  } finally {
    server.close();
    server.closeAllConnections?.();
  }
});

await test("probe refuses SSRF targets without touching the network", async () => {
  const report = await probeLlmProfile({
    baseUrl: "http://169.254.169.254/latest/meta-data",
    model: "whatever",
  });
  assert.equal(report.ok, false);
  assert.match(report.error || "", /Blocked|metadata|SSRF/i);
});

await test("a backend without a /models endpoint still passes (manual model id)", async () => {
  const { server, port } = await startMock((req, res, raw) => {
    if (req.url.endsWith("/models")) {
      res.writeHead(404).end("no list here");
      return;
    }
    const body = chatBody(raw);
    const last = body.messages?.[body.messages.length - 1];
    if (last?.role === "tool") {
      return jsonResponse(res, {
        choices: [{ message: { role: "assistant", content: "куб 7 принято" } }],
      });
    }
    if (body.tools?.length) {
      return jsonResponse(res, toolCallMessage);
    }
    return jsonResponse(res, {
      choices: [{ message: { role: "assistant", content: "стол" } }],
    });
  });
  try {
    const report = await probeLlmProfile({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      model: "hand-typed-model",
    });
    assert.equal(report.ok, true, JSON.stringify(report.stages));
    assert.equal(report.capabilities.modelListed, null);
  } finally {
    server.close();
  }
});

removeTempDir(dir);
console.log(`test-llm-profiles: ${passed} passed`);
