// Verifies odm_models MCP control actions (status, list, test_and_connect, apply, switch_remote)
// against an isolated database and deterministic mock server.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-mcp-models-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.chdir(dir);

register("./lib/register-alias.mjs", import.meta.url);

const { executeMcpControl, McpControlError } = await import("../src/lib/mcp-control.ts");
const { getGlobalConfig } = await import("../src/lib/db/app-settings.ts");
const { createCampaign } = await import("../src/lib/db/campaigns.ts");
const { createUser } = await import("../src/lib/db/users.ts");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

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

const user = createUser("test_dm_admin", "hash123", { isAdmin: true });
const campaign = createCampaign(user.id, {
  title: "Campaign Alpha",
  description: "",
  theme: "",
  maxPlayers: 5,
  startingLevel: 1,
  difficulty: "normal",
  gameSettings: {},
});

// 1. models.status test
await test("models.status returns global config and profile list", async () => {
  const status = await executeMcpControl("models.status", {});
  assert.ok(status.global, "status.global must exist");
  assert.ok(Array.isArray(status.profiles), "status.profiles must be array");
  assert.equal(status.runtimeDefaults.defaultLocalUrl, "http://127.0.0.1:11434/v1");

  const campaignStatus = await executeMcpControl("models.status", { campaignId: campaign.id });
  assert.ok(campaignStatus.campaign, "status.campaign must exist when requested");
  assert.equal(campaignStatus.campaign.campaignId, campaign.id);
});

// Mock LLM server answering /models and chat/tool_call
const mock = await startMock((req, res, raw) => {
  res.setHeader("Content-Type", "application/json");

  if (req.url.endsWith("/models")) {
    res.end(JSON.stringify({
      data: [
        { id: "qwen2.5:14b-instruct" },
        { id: "llama3.3:70b" },
      ],
    }));
    return;
  }

  if (req.url.includes("/chat/completions")) {
    const body = JSON.parse(raw || "{}");
    const msgs = body.messages || [];
    const last = msgs[msgs.length - 1];

    if (body.tools?.length && msgs.length === 2) {
      // Stage 2: tool call probe
      res.end(JSON.stringify({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_echo_1",
                  type: "function",
                  function: { name: "probe_echo", arguments: '{"word":"куб","n":7}' },
                },
              ],
            },
          },
        ],
      }));
      return;
    }

    if (last?.role === "tool") {
      // Stage 3: tool result consumption
      res.end(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "Проверка завершена успешно." } }],
      }));
      return;
    }

    // Stage 1: plain chat response
    res.end(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "готово." } }],
    }));
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: "Not found" }));
});

const mockBaseUrl = `http://127.0.0.1:${mock.port}/v1`;

// 2. models.list test
await test("models.list fetches model list from endpoint", async () => {
  const result = await executeMcpControl("models.list", {
    provider: "qwen-local",
    baseUrl: mockBaseUrl,
  });
  assert.ok(Array.isArray(result.models));
  assert.equal(result.models.length, 2);
  assert.equal(result.models[0].id, "qwen2.5:14b-instruct");
});

// 3. models.test_and_connect test
await test("models.test_and_connect probes and applies global model", async () => {
  const result = await executeMcpControl("models.test_and_connect", {
    provider: "qwen-local",
    model: "qwen2.5:14b-instruct",
    baseUrl: mockBaseUrl,
    apply: true,
  });

  assert.ok(result.report?.ok, "probe report must be ok");
  assert.equal(result.applied, true);
  assert.equal(result.target, "global");

  const globalCfg = getGlobalConfig();
  assert.equal(globalCfg.text.customModel, "qwen2.5:14b-instruct");
});

// 4. models.switch_remote test
await test("models.switch_remote connects and applies to campaign", async () => {
  const result = await executeMcpControl("models.switch_remote", {
    remoteUrl: mockBaseUrl,
    model: "llama3.3:70b",
    campaignId: campaign.id,
  });

  assert.ok(result.report?.ok, "remote probe must succeed");
  assert.equal(result.campaignApplied, true);
  assert.equal(result.target, "campaign");

  const status = await executeMcpControl("models.status", { campaignId: campaign.id });
  assert.equal(status.campaign.customModel, "llama3.3:70b");
});

// 5. models.apply test
await test("models.apply switches between verified profiles", async () => {
  const status = await executeMcpControl("models.status", {});
  assert.ok(status.profiles.length >= 2);

  const firstProfile = status.profiles[0];
  const applyRes = await executeMcpControl("models.apply", {
    profileId: firstProfile.id,
  });

  assert.equal(applyRes.applied, true);
  assert.equal(applyRes.target, "global");
  assert.equal(getGlobalConfig().text.customModel, firstProfile.model);
});

// 6. Security guard tests
await test("models.test_and_connect rejects blocked metadata IP", async () => {
  await assert.rejects(
    async () => {
      await executeMcpControl("models.test_and_connect", {
        provider: "qwen-local",
        model: "bad-model",
        baseUrl: "http://169.254.169.254/v1",
      });
    },
    McpControlError,
    "Should reject metadata IP"
  );
});

mock.server.close();
removeTempDir(dir);
console.log(`\nAll ${passed} MCP models control tests passed.`);
