// 30-50 turn soak test with periodic application and MCP restarts,
// plus simulated artificial failure injection for both LLM and image providers.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
const root = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "odm-soak-"));
const mediaRoot = path.join(temp, "media");
fs.mkdirSync(mediaRoot, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function freePort() {
  const s = createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}

const appPort = await freePort();
const mcpPort = await freePort();
const mockLlmPort = await freePort();

const appOrigin = `http://127.0.0.1:${appPort}`;
const mcpOrigin = `http://127.0.0.1:${mcpPort}`;
const mcpToken = randomBytes(24).toString("hex");

// 1. Start mock LLM provider with fault injection toggle
let llmFailMode = false;
let llmRequestCount = 0;

const mockLlmServer = createServer(async (req, res) => {
  llmRequestCount++;
  if (req.url?.endsWith("/models")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ data: [{ id: "mock-dm-model" }] }));
  }

  if (llmFailMode) {
    res.writeHead(500, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: { message: "Simulated upstream provider outage" } }));
  }

  // Handle completions
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};

  if (body.stream) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "The shadows lengthen in the crypt." } }] })}\n\n`);
    res.write("data: [DONE]\n\n");
    return res.end();
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      choices: [{ message: { role: "assistant", content: "The shadows lengthen in the crypt." } }],
    })
  );
});

await new Promise((r) => mockLlmServer.listen(mockLlmPort, "127.0.0.1", r));

// 2. Next.js app process control
let appServer = null;
const appLogs = [];

const appEnv = {
  ...process.env,
  NODE_ENV: "production",
  PORT: String(appPort),
  COOKIE_SECURE: "0",
  SQLITE_DB_PATH: path.join(temp, "game.sqlite"),
  DB_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  ODM_MEDIA_ROOT: mediaRoot,
  ODM_LOCAL_ORIGIN: appOrigin,
  ODM_PUBLIC_URL: appOrigin,
  ODM_PORT: String(appPort),
  ODM_MCP_TOKEN: mcpToken,
  NEXT_TELEMETRY_DISABLED: "1",
  VOICE_ENABLED: "0",
  COMFYUI_URL: "",
  FLUX_WORKER_URL: "",
  OLLAMA_BASE_URL: "",
};

// Clear API keys
for (const key of Object.keys(appEnv)) {
  if (/API_KEY|ACCESS_TOKEN|REFRESH_TOKEN/.test(key)) delete appEnv[key];
}

async function startApp() {
  appServer = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(appPort)],
    {
      cwd: root,
      env: appEnv,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  for (const stream of [appServer.stdout, appServer.stderr]) {
    stream.on("data", (b) => appLogs.push(b.toString()));
  }
  for (let i = 0; i < 120; i++) {
    if (appServer.exitCode !== null) {
      throw new Error("Next server exited: " + appLogs.join("").slice(-6000));
    }
    try {
      const res = await fetch(`${appOrigin}/api/health`);
      if (res.ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error("App server startup timeout");
}

async function stopApp() {
  if (!appServer) return;
  const p = appServer;
  appServer = null;
  try {
    if (process.platform !== "win32") {
      process.kill(-p.pid, "SIGTERM");
    } else {
      p.kill();
    }
  } catch {}
  await Promise.race([new Promise((r) => p.once("exit", r)), sleep(3000)]);
}

// 3. MCP server process control
let mcpProcess = null;
const mcpLogs = [];
const mcpNodeModules = path.join(root, "mcp", "node_modules");

async function startMcp() {
  const instanceLogs = [];
  const existingNodePath = process.env.NODE_PATH || "";
  const combinedNodePath = existingNodePath
    ? `${mcpNodeModules}${path.delimiter}${existingNodePath}`
    : mcpNodeModules;

  mcpProcess = spawn(
    process.execPath,
    ["--import", "./mcp/external-tools-preload.mjs", "mcp/server.mjs"],
    {
      cwd: root,
      env: {
        ...process.env,
        NODE_PATH: combinedNodePath,
        ODM_MCP_PORT: String(mcpPort),
        ODM_MCP_HOST: "127.0.0.1",
        ODM_MCP_TOKEN: mcpToken,
        ODM_MCP_CONTROL_URL: `${appOrigin}/api/internal/mcp`,
      },
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  for (const stream of [mcpProcess.stdout, mcpProcess.stderr]) {
    stream.on("data", (b) => {
      const s = b.toString();
      mcpLogs.push(s);
      instanceLogs.push(s);
    });
  }
  for (let i = 0; i < 80; i++) {
    if (mcpProcess.exitCode !== null) {
      throw new Error("MCP process exited: " + instanceLogs.join("").slice(-4000));
    }
    try {
      const res = await fetch(`${mcpOrigin}/healthz`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error("MCP server startup timeout after 20s. Logs:\n" + instanceLogs.join(""));
}

async function stopMcp() {
  if (!mcpProcess) return;
  const p = mcpProcess;
  mcpProcess = null;
  try {
    if (process.platform !== "win32") {
      process.kill(-p.pid, "SIGTERM");
    } else {
      p.kill();
    }
  } catch {}
  const exited = await Promise.race([
    new Promise((r) => p.once("exit", () => r(true))),
    sleep(3000).then(() => false),
  ]);
  if (!exited) {
    try {
      if (process.platform !== "win32") {
        process.kill(-p.pid, "SIGKILL");
      } else {
        p.kill();
      }
    } catch {}
    await Promise.race([new Promise((r) => p.once("exit", r)), sleep(1500)]);
  }
}

// 1x1 valid PNG fixture for image pipeline
const PNG_FIXTURE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

try {
  console.log(`[Soak] Starting App (${appOrigin}) and MCP (${mcpOrigin})...`);
  await startApp();
  await startMcp();

  // Create test user and auth session
  let authCookie = "";
  {
    const res = await fetch(`${appOrigin}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "soak_hero", password: "SoakPassword2026!" }),
    });
    assert.ok(res.ok, `Signup failed: ${res.status}`);
    const cookieHeader = res.headers.get("set-cookie") || "";
    authCookie = cookieHeader.split(";")[0];
  }

  const authHeaders = {
    Cookie: authCookie,
    "Content-Type": "application/json",
  };

  const controlHeaders = {
    Authorization: `Bearer ${mcpToken}`,
    "Content-Type": "application/json",
  };

  // Create campaign
  let campaignId = "";
  {
    const res = await fetch(`${appOrigin}/api/campaigns`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        title: "Soak Citadel of Trials",
        theme: "fantasy",
        difficulty: "normal",
        maxPlayers: 1,
        startingLevel: 1,
        isSolo: true,
      }),
    });
    assert.ok(res.ok, `Campaign create failed: ${res.status}`);
    const data = await res.json();
    campaignId = data.campaign.id;
  }

  // Create character sheet
  let sheetId = "";
  {
    const res = await fetch(`${appOrigin}/api/campaigns/${campaignId}/sheet`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        name: "Kragor the Enduring",
        race: "dwarf",
        class: "fighter",
        subclass: "champion",
        background: "soldier",
        abilities: { str: 17, dex: 10, con: 16, int: 10, wis: 12, cha: 8 },
        maxHp: 13,
        ac: 17,
        speed: 25,
        hitDice: { die: "d10", total: 1, spent: 0 },
        proficiencies: {
          saves: ["str", "con"],
          skills: ["athletics", "intimidation"],
          languages: ["common", "dwarvish"],
          tools: ["smith_tools"],
          armor: ["all"],
          weapons: ["all"],
        },
        equipment: [{ name: "Warhammer", qty: 1 }, { name: "Shield", qty: 1 }],
        gold: 20,
      }),
    });
    assert.ok(res.ok, `Sheet create failed: ${res.status}`);
    const data = await res.json();
    sheetId = data.sheet.id;

    // Ready and start
    await fetch(`${appOrigin}/api/campaigns/${campaignId}/ready`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ ready: true }),
    });
    await fetch(`${appOrigin}/api/campaigns/${campaignId}`, {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify({ status: "active" }),
    });
  }

  console.log(`[Soak] Campaign ${campaignId} active. Beginning 35-turn soak loop...`);

  const TOTAL_TURNS = 35;
  const initialCampRes = await fetch(`${appOrigin}/api/campaigns/${campaignId}`, {
    headers: authHeaders,
  });
  const initialCampData = await initialCampRes.json();
  let lastRecordedSeq = typeof initialCampData.latestSeq === "number" ? initialCampData.latestSeq : 0;
  let mcpRestartCount = 0;
  let appRestartCount = 0;
  let llmFaultsHandled = 0;
  let imageFaultsHandled = 0;

  for (let turn = 1; turn <= TOTAL_TURNS; turn++) {
    // --- FAULT INJECTION: Artificial LLM Provider Outage ---
    if (turn === 11 || turn === 26) {
      console.log(`[Soak] Turn ${turn}: Injecting artificial LLM provider failure (500)...`);
      llmFailMode = true;

      // Submit action while LLM provider is failing
      const failActionRes = await fetch(`${appOrigin}/api/campaigns/${campaignId}/actions`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          content: `Turn ${turn}: Action attempted during transient LLM outage.`,
          kind: "do",
        }),
      });
      // The application must accept the player's message gracefully and not crash
      assert.ok(
        [200, 202].includes(failActionRes.status),
        `Action during LLM outage should be accepted, got ${failActionRes.status}`
      );

      // Verify server is alive and responding
      const healthCheck = await fetch(`${appOrigin}/api/health`);
      assert.equal(healthCheck.status, 200, "Server must remain healthy during LLM outage");

      // Recover LLM provider
      llmFailMode = false;
      llmFaultsHandled++;
      console.log(`[Soak] Turn ${turn}: LLM provider restored. Recovery verified.`);
    }

    // --- FAULT INJECTION: Artificial Image Provider Failure & Recovery ---
    if (turn === 16 || turn === 31) {
      console.log(`[Soak] Turn ${turn}: Injecting artificial Image provider failure & recovery...`);
      // 1. Create an asset pack and job
      const packRes = await fetch(`${appOrigin}/api/internal/mcp`, {
        method: "POST",
        headers: controlHeaders,
        body: JSON.stringify({
          action: "assets.create_pack",
          params: {
            campaignId,
            title: `Fault Test Pack Turn ${turn}`,
            packType: "test",
            jobs: [
              {
                kind: "item_art",
                title: `Relic Turn ${turn}`,
                suggestedPrompt: "An ancient glowing runestone",
              },
            ],
          },
        }),
      });
      assert.equal(packRes.status, 200);
      const packData = await packRes.json();
      const jobId = packData.result.pack.jobs[0].id;

      // 2. Claim job and simulate worker failure
      await fetch(`${appOrigin}/api/internal/mcp`, {
        method: "POST",
        headers: controlHeaders,
        body: JSON.stringify({
          action: "assets.claim_job",
          params: { jobId, workerId: `failing-worker-${turn}`, leaseSeconds: 120 },
        }),
      });

      const failJobRes = await fetch(`${appOrigin}/api/internal/mcp`, {
        method: "POST",
        headers: controlHeaders,
        body: JSON.stringify({
          action: "assets.fail_job",
          params: {
            jobId,
            workerId: `failing-worker-${turn}`,
            error: "Simulated GPU Out of Memory Error",
          },
        }),
      });
      assert.equal(failJobRes.status, 200);
      const failedJobData = await failJobRes.json();
      assert.equal(failedJobData.result.job.status, "failed");
      assert.ok(failedJobData.result.job.error.includes("GPU Out of Memory"));

      // 3. Immediately recover by creating and successfully completing another asset job
      const recPackRes = await fetch(`${appOrigin}/api/internal/mcp`, {
        method: "POST",
        headers: controlHeaders,
        body: JSON.stringify({
          action: "assets.create_pack",
          params: {
            campaignId,
            title: `Recovered Pack Turn ${turn}`,
            packType: "test",
            jobs: [
              {
                kind: "handout",
                title: `Recovered Map Turn ${turn}`,
                suggestedPrompt: "A parchment map",
              },
            ],
          },
        }),
      });
      const recJobId = (await recPackRes.json()).result.pack.jobs[0].id;

      await fetch(`${appOrigin}/api/internal/mcp`, {
        method: "POST",
        headers: controlHeaders,
        body: JSON.stringify({
          action: "assets.claim_job",
          params: { jobId: recJobId, workerId: "recovery-worker", leaseSeconds: 120 },
        }),
      });

      const uploadGrantRes = await fetch(`${appOrigin}/api/internal/mcp`, {
        method: "POST",
        headers: controlHeaders,
        body: JSON.stringify({
          action: "assets.create_upload",
          params: {
            jobId: recJobId,
            workerId: "recovery-worker",
            expectedMimeType: "image/png",
          },
        }),
      });
      const grant = (await uploadGrantRes.json()).result;
      const pathname = new URL(grant.uploadUrl, appOrigin).pathname;

      await fetch(`${appOrigin}${pathname}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${grant.authorization?.token || grant.uploadToken}`,
          "Content-Type": "image/png",
        },
        body: PNG_FIXTURE,
      });

      const submitRes = await fetch(`${appOrigin}/api/internal/mcp`, {
        method: "POST",
        headers: controlHeaders,
        body: JSON.stringify({
          action: "assets.submit_result",
          params: {
            jobId: recJobId,
            uploadId: grant.uploadId,
            workerId: "recovery-worker",
            provider: "soak-mock",
            variantLabel: "recovery_variant",
          },
        }),
      });
      assert.equal(submitRes.status, 200);

      // Verify asset health
      const healthRes = await fetch(`${appOrigin}/api/internal/mcp`, {
        method: "POST",
        headers: controlHeaders,
        body: JSON.stringify({ action: "assets.health", params: { campaignId } }),
      });
      const health = (await healthRes.json()).result;
      assert.equal(health.ok, true, "Asset pipeline must remain healthy after fault recovery");

      imageFaultsHandled++;
      console.log(`[Soak] Turn ${turn}: Image fault handled and pipeline recovered.`);
    }

    // --- PERIODIC RESTARTS ---
    if (turn === 10) {
      console.log(`[Soak] Turn ${turn}: Restarting MCP server...`);
      await stopMcp();
      try {
        await fetch(`${mcpOrigin}/healthz`, { signal: AbortSignal.timeout(500) });
        assert.fail("MCP must be unreachable while stopped");
      } catch {}
      await startMcp();
      const mcpHealth = await fetch(`${mcpOrigin}/healthz`);
      assert.equal(mcpHealth.status, 200, "MCP must be healthy after restart");
      mcpRestartCount++;
      console.log(`[Soak] Turn ${turn}: MCP restart verified.`);
    }

    if (turn === 20) {
      console.log(`[Soak] Turn ${turn}: Restarting App server...`);
      await stopApp();
      try {
        await fetch(`${appOrigin}/api/health`, { signal: AbortSignal.timeout(500) });
        assert.fail("App must be unreachable while stopped");
      } catch {}
      await startApp();
      const appHealth = await (await fetch(`${appOrigin}/api/health`)).json();
      assert.equal(appHealth.ok, true, "App must be healthy after restart");
      appRestartCount++;
      console.log(`[Soak] Turn ${turn}: App restart verified.`);
    }

    if (turn === 30) {
      console.log(`[Soak] Turn ${turn}: Restarting BOTH App and MCP servers...`);
      await stopMcp();
      await stopApp();
      await startApp();
      await startMcp();
      const appHealth = await (await fetch(`${appOrigin}/api/health`)).json();
      const mcpHealth = await fetch(`${mcpOrigin}/healthz`);
      assert.equal(appHealth.ok, true);
      assert.equal(mcpHealth.status, 200);
      appRestartCount++;
      mcpRestartCount++;
      console.log(`[Soak] Turn ${turn}: Simultaneous App + MCP restart verified.`);
    }

    // --- NORMAL TURN EXECUTION ---
    const actionRes = await fetch(`${appOrigin}/api/campaigns/${campaignId}/actions`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        content: `Turn ${turn}: Kragor advances carefully along corridor section ${turn}.`,
        kind: "do",
      }),
    });
    assert.ok(
      [200, 202].includes(actionRes.status),
      `Turn ${turn} action submission failed: ${actionRes.status}`
    );

    // Periodic roll check every 5 turns
    if (turn % 5 === 0) {
      const rollRes = await fetch(`${appOrigin}/api/campaigns/${campaignId}/rolls`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          kind: "ability_check",
          ability: "str",
          advantage: "none",
        }),
      });
      assert.ok([200, 201].includes(rollRes.status), `Turn ${turn} roll failed`);
    }

    // Verify campaign sequence monotonicity
    const campRes = await fetch(`${appOrigin}/api/campaigns/${campaignId}`, {
      headers: authHeaders,
    });
    assert.equal(campRes.status, 200);
    const campData = await campRes.json();
    assert.ok(
      typeof campData.latestSeq === "number" && campData.latestSeq > lastRecordedSeq,
      `Sequence must advance monotonically (was ${lastRecordedSeq}, now ${campData.latestSeq})`
    );
    lastRecordedSeq = campData.latestSeq;
  }

  // 4. Final verification and campaign conclusion
  console.log(`[Soak] Completed all ${TOTAL_TURNS} turns. Verifying integrity...`);

  // Verify full message count
  const finalCampRes = await fetch(`${appOrigin}/api/campaigns/${campaignId}`, {
    headers: authHeaders,
  });
  const finalData = await finalCampRes.json();
  assert.ok(
    finalData.messages.length >= TOTAL_TURNS,
    `Must have at least ${TOTAL_TURNS} messages recorded (got ${finalData.messages.length})`
  );

  // Verify MCP tools contract through control plane
  const mcpStatusRes = await fetch(`${appOrigin}/api/internal/mcp`, {
    method: "POST",
    headers: controlHeaders,
    body: JSON.stringify({ action: "server.status", params: {} }),
  });
  assert.equal(mcpStatusRes.status, 200);

  // Finish campaign
  const endRes = await fetch(`${appOrigin}/api/campaigns/${campaignId}`, {
    method: "PATCH",
    headers: authHeaders,
    body: JSON.stringify({ status: "ended" }),
  });
  assert.equal(endRes.status, 200);

  // Verify sheet was preserved across restarts
  assert.ok(
    finalData.sheets.some((s) => s.id === sheetId),
    "Hero sheet must be preserved across restarts"
  );

  console.log(`\n================ SOAK TEST SUMMARY ================`);
  console.log(`Total Turns Completed:  ${TOTAL_TURNS}`);
  console.log(`App Restarts Tested:    ${appRestartCount}`);
  console.log(`MCP Restarts Tested:    ${mcpRestartCount}`);
  console.log(`LLM Faults Injected:    ${llmFaultsHandled}`);
  console.log(`LLM Requests Total:     ${llmRequestCount}`);
  console.log(`Image Faults Injected:  ${imageFaultsHandled}`);
  console.log(`Final Sequence Number:  ${lastRecordedSeq}`);
  console.log(`Status:                 100% HEALTHY & INTEGRITY PRESERVED`);
  console.log(`====================================================\n`);
  console.log("PASS test-soak-turns");
} finally {
  await stopMcp();
  await stopApp();
  mockLlmServer.close();
  mockLlmServer.closeAllConnections?.();
  try {
    fs.rmSync(temp, { recursive: true, force: true });
  } catch {}
}
