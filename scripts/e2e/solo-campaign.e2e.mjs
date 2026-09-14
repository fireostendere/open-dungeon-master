// Playwright end-to-end test for solo campaign lifecycle:
// clean install / bootstrap -> campaign creation -> hero creation -> 5-10 game actions ->
// skill check -> combat -> HP/XP/inventory change -> art generation ->
// app restart -> continue same campaign -> campaign finish and sync.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";

function resolvePlaywrightModule() {
  if (process.env.ODM_PLAYWRIGHT_MODULE) {
    return pathToFileURL(path.resolve(process.env.ODM_PLAYWRIGHT_MODULE)).href;
  }
  const fallbackPath = "/tmp/odm-browser/node_modules/playwright/index.mjs";
  if (fs.existsSync(fallbackPath)) {
    return pathToFileURL(fallbackPath).href;
  }
  return "playwright";
}

const { chromium } = await import(resolvePlaywrightModule());
const root = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "odm-solo-e2e-"));
const mediaRoot = path.join(temp, "media");
fs.mkdirSync(mediaRoot, { recursive: true });

const artifacts = path.join(root, "provider-test-results");
fs.mkdirSync(artifacts, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let server, browser, context, page;
let passed = 0;
const logs = [];

async function check(name, fn) {
  await fn();
  passed++;
  console.log(`PASS ${name}`);
}

async function freePort() {
  const s = createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}

const port = await freePort();
const origin = `http://127.0.0.1:${port}`;
const mcpToken = randomBytes(24).toString("hex");

const env = {
  ...process.env,
  NODE_ENV: "production",
  PORT: String(port),
  COOKIE_SECURE: "0",
  SQLITE_DB_PATH: path.join(temp, "game.sqlite"),
  DB_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  ODM_MEDIA_ROOT: mediaRoot,
  ODM_LOCAL_ORIGIN: origin,
  ODM_PUBLIC_URL: origin,
  ODM_PORT: String(port),
  ODM_MCP_TOKEN: mcpToken,
  NEXT_TELEMETRY_DISABLED: "1",
  VOICE_ENABLED: "0",
  COMFYUI_URL: "",
  FLUX_WORKER_URL: "",
  OLLAMA_BASE_URL: "",
};

// Clear any accidental API keys from host environment
for (const key of Object.keys(env)) {
  if (/API_KEY|ACCESS_TOKEN|REFRESH_TOKEN/.test(key)) delete env[key];
}

async function start() {
  const instanceLogs = [];
  server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)],
    {
      cwd: root,
      env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  for (const stream of [server.stdout, server.stderr]) {
    stream.on("data", (b) => {
      const s = b.toString();
      logs.push(s);
      instanceLogs.push(s);
    });
  }
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) {
      throw new Error("Next server exited unexpectedly (" + server.exitCode + "):\n" + instanceLogs.join(""));
    }
    try {
      const res = await fetch(origin + "/api/health", { signal: AbortSignal.timeout(1500) });
      if (res.ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error("Server startup timed out after 60s. Logs:\n" + instanceLogs.join(""));
}

async function stop() {
  if (!server) return;
  const p = server;
  server = null;
  try {
    if (process.platform !== "win32") {
      process.kill(-p.pid, "SIGTERM");
    } else {
      p.kill();
    }
  } catch {}
  const exited = await Promise.race([
    new Promise((r) => p.once("exit", () => r(true))),
    sleep(4000).then(() => false),
  ]);
  if (!exited) {
    try {
      if (process.platform !== "win32") {
        process.kill(-p.pid, "SIGKILL");
      } else {
        p.kill();
      }
    } catch {}
    await Promise.race([new Promise((r) => p.once("exit", r)), sleep(2000)]);
  }
  await sleep(500);
}

// 1x1 valid PNG fixture
const PNG_FIXTURE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

try {
  console.log(`Starting production Next.js server on ${origin}...`);
  await start();

  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ baseURL: origin });
  page = await context.newPage();

  let user = null;
  let campaignId = null;
  let sheetId = null;

  // 1. Clean install / registration
  await check("1. Clean install / account registration", async () => {
    const res = await context.request.post("/api/auth/register", {
      data: {
        username: "soloing_hero",
        password: "HeroPassword2026!",
      },
    });
    assert.ok(res.ok(), `Registration failed: ${res.status()} ${await res.text()}`);
    const body = await res.json();
    assert.ok(body.user?.id, "User registration must succeed and return user id");
    user = body.user;

    const meRes = await context.request.get("/api/auth/me");
    assert.ok(meRes.ok());
    const me = await meRes.json();
    assert.equal(me.user.id, user.id);
  });

  // 2. Campaign creation
  await check("2. Solo campaign creation", async () => {
    const res = await context.request.post("/api/campaigns", {
      data: {
        title: "Crypt of the Lost Emperor",
        theme: "dungeon",
        difficulty: "normal",
        maxPlayers: 1,
        startingLevel: 1,
        isSolo: true,
      },
    });
    assert.ok(res.ok(), `Campaign creation failed: ${res.status()} ${await res.text()}`);
    const body = await res.json();
    assert.ok(body.campaign?.id, "Campaign created with ID");
    campaignId = body.campaign.id;
    assert.equal(body.campaign.title, "Crypt of the Lost Emperor");
    assert.equal(body.campaign.status, "lobby");
  });

  // 3. Hero creation and campaign start
  await check("3. Hero character creation & campaign activation", async () => {
    const sheetPayload = {
      name: "Valerius the Bold",
      race: "human",
      class: "fighter",
      subclass: "champion",
      background: "soldier",
      abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 12, cha: 8 },
      maxHp: 12,
      ac: 16,
      speed: 30,
      hitDice: { die: "d10", total: 1, spent: 0 },
      proficiencies: {
        saves: ["str", "con"],
        skills: ["athletics", "perception"],
        languages: ["common"],
        tools: [],
        armor: ["all"],
        weapons: ["all"],
      },
      equipment: [{ name: "Steel Longsword", qty: 1 }, { name: "Heavy Shield", qty: 1 }],
      gold: 15,
    };

    const sheetRes = await context.request.post(`/api/campaigns/${campaignId}/sheet`, {
      data: sheetPayload,
    });
    assert.ok(sheetRes.ok(), `Sheet creation failed: ${sheetRes.status()} ${await sheetRes.text()}`);
    const sheetData = await sheetRes.json();
    assert.ok(sheetData.sheet?.id, "Hero sheet created");
    sheetId = sheetData.sheet.id;
    assert.equal(sheetData.sheet.name, "Valerius the Bold");

    // Mark ready and start campaign
    const readyRes = await context.request.post(`/api/campaigns/${campaignId}/ready`, {
      data: { ready: true },
    });
    assert.ok(readyRes.ok(), `Ready failed: ${readyRes.status()} ${await readyRes.text()}`);

    const startRes = await context.request.patch(`/api/campaigns/${campaignId}`, {
      data: { status: "active" },
    });
    assert.ok(startRes.ok(), `Start campaign failed: ${startRes.status()} ${await startRes.text()}`);
    const startData = await startRes.json();
    assert.equal(startData.status, "active");

    // Verify browser UI loads active session with hero
    await page.goto(`/campaigns/${campaignId}`);
    await page.waitForLoadState("networkidle");
    await page.getByText("Valerius the Bold", { exact: false }).first().waitFor({ timeout: 10000 });
  });

  // 4. 5-10 game actions
  await check("4. Execute 8 distinct gameplay actions", async () => {
    const actions = [
      "I light my hooded lantern and examine the granite archway.",
      "I sweep the lantern beam across the mossy floor, checking for pressure plates.",
      "I draw my steel longsword and cautiously advance ten paces.",
      "I pause and listen carefully for any breathing or shifting gravel in the dark.",
      "I inspect the carved relief on the north wall depicting an imperial sarcophagus.",
      "I wedge my iron crowbar under the heavy stone door and heave with all my strength.",
      "I enter the vault room with my shield held high in front of me.",
      "I scan the room corners and examine the ornate altar in the center.",
    ];

    for (let i = 0; i < actions.length; i++) {
      const actionText = actions[i];
      const res = await context.request.post(`/api/campaigns/${campaignId}/actions`, {
        data: {
          content: actionText,
          kind: "do",
        },
      });
      assert.ok(res.ok(), `Action ${i + 1} failed: ${res.status()} ${await res.text()}`);
    }

    // Verify actions appear in campaign message feed
    const msgsRes = await context.request.get(`/api/campaigns/${campaignId}`);
    assert.ok(msgsRes.ok());
    const campaignData = await msgsRes.json();
    assert.ok(campaignData.messages.length >= 8, "All gameplay actions must be present in messages");

    const recentAction = campaignData.messages.find((m) =>
      m.content.includes("sarcophagus")
    );
    assert.ok(recentAction, "Action content must be faithfully persisted in game history");
  });

  // 5. Skill check
  await check("5. Execute skill check", async () => {
    const rollRes = await context.request.post(`/api/campaigns/${campaignId}/rolls`, {
      data: {
        kind: "skill_check",
        skill: "perception",
        advantage: "none",
      },
    });
    assert.ok(rollRes.ok(), `Roll failed: ${rollRes.status()} ${await rollRes.text()}`);
    const rollData = await rollRes.json();
    assert.ok(rollData.roll, "Roll must succeed");
    assert.equal(rollData.roll.kind, "skill_check");
    assert.equal(rollData.roll.detail, "perception");
    assert.ok(typeof rollData.roll.total === "number", "Roll total must be numeric");

    // Verify in roll log
    const rollsListRes = await context.request.get(`/api/campaigns/${campaignId}/rolls`);
    assert.ok(rollsListRes.ok());
    const rollsList = await rollsListRes.json();
    assert.ok(
      rollsList.rolls.some((r) => r.detail === "perception"),
      "Perception check must appear in visible rolls list"
    );
  });

  // 6. Combat roll
  await check("6. Execute combat attack roll", async () => {
    const combatRollRes = await context.request.post(`/api/campaigns/${campaignId}/rolls`, {
      data: {
        expression: "1d20+5",
      },
    });
    assert.ok(combatRollRes.ok(), `Combat roll failed: ${combatRollRes.status()} ${await combatRollRes.text()}`);
    const combatData = await combatRollRes.json();
    assert.ok(combatData.roll, "Combat roll must succeed");
    assert.equal(combatData.roll.expression, "1d20+5");
    assert.ok(combatData.roll.total >= 6 && combatData.roll.total <= 25);
  });

  // 7. Change HP / XP / inventory
  await check("7. Apply HP damage, XP gain, and inventory change", async () => {
    const updatedEquipment = [
      { name: "Steel Longsword", qty: 1 },
      { name: "Heavy Shield", qty: 1 },
      { name: "Ancient Bronze Key", qty: 1 },
      { name: "Potion of Healing", qty: 1 },
    ];

    const patchRes = await context.request.patch(`/api/campaigns/${campaignId}/sheets/${sheetId}`, {
      data: {
        currentHp: 8, // took 4 damage (12 -> 8)
        xp: 250,      // gained 250 XP
        equipment: updatedEquipment,
        reason: "Combat encounter damage and loot",
      },
    });
    assert.ok(patchRes.ok(), `Sheet patch failed: ${patchRes.status()} ${await patchRes.text()}`);
    const patchedSheet = (await patchRes.json()).sheet;
    assert.equal(patchedSheet.currentHp, 8);
    assert.equal(patchedSheet.xp, 250);
    assert.equal(patchedSheet.equipment.length, 4);
    assert.ok(patchedSheet.equipment.some((it) => it.name === "Ancient Bronze Key"));

    // Verify in UI
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.getByText("8/12", { exact: false }).first().waitFor({ timeout: 10000 });
  });

  // 8. Art generation via external asset pipeline
  await check("8. Art generation and attachment via external asset pipeline", async () => {
    // Call internal control plane to create an asset pack and job
    const controlHeaders = {
      Authorization: `Bearer ${mcpToken}`,
      "Content-Type": "application/json",
    };

    const packRes = await fetch(`${origin}/api/internal/mcp`, {
      method: "POST",
      headers: controlHeaders,
      body: JSON.stringify({
        action: "assets.create_pack",
        params: {
          campaignId,
          title: "Solo Hero Art Pack",
          packType: "character",
          jobs: [
            {
              kind: "character_portrait",
              title: "Valerius Portrait",
              target: { type: "character", id: sheetId },
              suggestedPrompt: "Heroic portrait of a battle-tested warrior",
            },
          ],
        },
      }),
    });
    const packBody = await packRes.json();
    assert.equal(packRes.status, 200, JSON.stringify(packBody));
    const packResult = packBody.result;
    const jobId = packResult.pack.jobs[0].id;

    // Claim the job
    const claimRes = await fetch(`${origin}/api/internal/mcp`, {
      method: "POST",
      headers: controlHeaders,
      body: JSON.stringify({
        action: "assets.claim_job",
        params: { jobId, workerId: "playwright-e2e-worker", leaseSeconds: 300 },
      }),
    });
    const claimBody = await claimRes.json();
    assert.equal(claimRes.status, 200, JSON.stringify(claimBody));

    // Request upload grant
    const uploadGrantRes = await fetch(`${origin}/api/internal/mcp`, {
      method: "POST",
      headers: controlHeaders,
      body: JSON.stringify({
        action: "assets.create_upload",
        params: {
          jobId,
          workerId: "playwright-e2e-worker",
          expectedMimeType: "image/png",
          expectedMaxBytes: 1024 * 1024,
        },
      }),
    });
    const uploadGrantBody = await uploadGrantRes.json();
    assert.equal(uploadGrantRes.status, 200, JSON.stringify(uploadGrantBody));
    const grant = uploadGrantBody.result;
    assert.ok(grant.uploadUrl && grant.uploadId);
    const token = grant.authorization?.token || grant.uploadToken;

    // Upload the PNG binary using PUT as specified in grant
    const pathname = new URL(grant.uploadUrl, origin).pathname;
    const uploadUrl = `${origin}${pathname}`;

    const uploadBinaryRes = await fetch(uploadUrl, {
      method: grant.method || "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "image/png",
      },
      body: PNG_FIXTURE,
    });
    const uploadBinaryBody = await uploadBinaryRes.json().catch(() => ({}));
    assert.ok(
      [200, 201].includes(uploadBinaryRes.status),
      `Upload failed with ${uploadBinaryRes.status}: ${JSON.stringify(uploadBinaryBody)}`
    );

    // Submit generation result
    const submitRes = await fetch(`${origin}/api/internal/mcp`, {
      method: "POST",
      headers: controlHeaders,
      body: JSON.stringify({
        action: "assets.submit_result",
        params: {
          jobId,
          uploadId: grant.uploadId,
          workerId: "playwright-e2e-worker",
          provider: "playwright-mock",
          model: "e2e-art-v1",
          promptUsed: "Heroic portrait of a battle-tested warrior",
          variantLabel: "portrait_primary",
          setPrimary: true,
        },
      }),
    });
    const submitBody = await submitRes.json();
    assert.equal(submitRes.status, 200, JSON.stringify(submitBody));
    const submitResult = submitBody.result;
    assert.ok(submitResult.asset?.id, "Asset created and linked to character");

    // Verify asset health
    const healthRes = await fetch(`${origin}/api/internal/mcp`, {
      method: "POST",
      headers: controlHeaders,
      body: JSON.stringify({
        action: "assets.health",
        params: { campaignId },
      }),
    });
    const healthBody = await healthRes.json();
    assert.equal(healthRes.status, 200, JSON.stringify(healthBody));
    const health = healthBody.result;
    assert.equal(health.ok, true);
    assert.ok(health.assets >= 1);
  });

  // 9. Restart application
  await check("9. Restart application and verify persistence across process restart", async () => {
    console.log("Stopping Next.js server...");
    await stop();

    // Verify port is dead
    let stillUp = false;
    try {
      const res = await fetch(origin + "/api/health", { signal: AbortSignal.timeout(1000) });
      if (res.ok) stillUp = true;
    } catch {}
    assert.equal(stillUp, false, "Server should be unreachable while stopped");

    console.log("Restarting Next.js server with existing persistent state...");
    await start();

    const health = await (await fetch(origin + "/api/health")).json();
    assert.equal(health.ok, true);
  });

  // 10. Continue same campaign after restart
  await check("10. Continue same campaign: state, sheet, art, and new action preserved", async () => {
    await page.goto(`/campaigns/${campaignId}`);
    await page.waitForLoadState("networkidle");

    // Verify character and HP display preserved
    await page.getByText("Valerius the Bold", { exact: false }).first().waitFor({ timeout: 10000 });
    await page.getByText("8/12", { exact: false }).first().waitFor({ timeout: 10000 });

    // Verify sheet data via API
    const sheetRes = await context.request.get(`/api/campaigns/${campaignId}/sheet`);
    assert.equal(sheetRes.status(), 200);
    const currentSheet = (await sheetRes.json()).sheet;
    assert.equal(currentSheet.currentHp, 8);
    assert.equal(currentSheet.xp, 250);
    assert.ok(
      currentSheet.equipment.some((i) => i.name === "Ancient Bronze Key"),
      "Equipment item must survive app restart"
    );

    // Perform turn 9 action
    const actionRes = await context.request.post(`/api/campaigns/${campaignId}/actions`, {
      data: {
        content: "I fit the Ancient Bronze Key into the locked crypt gate and turn it clockwise.",
        kind: "do",
      },
    });
    assert.ok(actionRes.ok(), `Turn 9 failed: ${actionRes.status()} ${await actionRes.text()}`);

    // Verify turn 9 is in message list
    const campRes = await context.request.get(`/api/campaigns/${campaignId}`);
    assert.ok(campRes.ok());
    const campData = await campRes.json();
    const lastAction = campData.messages.find((m) => m.content.includes("Ancient Bronze Key"));
    assert.ok(lastAction, "Turn 9 action must be recorded after restart");
  });

  // 11. Complete / finish campaign
  await check("11. Finish campaign and synchronize durable progression", async () => {
    // Finish campaign via API
    const endRes = await context.request.patch(`/api/campaigns/${campaignId}`, {
      data: { status: "ended" },
    });
    assert.ok(endRes.ok(), `End campaign failed: ${endRes.status()} ${await endRes.text()}`);
    const endData = await endRes.json();
    assert.equal(endData.status, "ended");

    // Verify campaign status is ended
    const campRes = await context.request.get(`/api/campaigns/${campaignId}`);
    assert.equal((await campRes.json()).campaign.status, "ended");
  });

  console.log(`\nAll ${passed} solo campaign E2E stages passed successfully.`);
} finally {
  if (browser) await browser.close().catch(() => {});
  await stop();
  try {
    fs.rmSync(temp, { recursive: true, force: true });
  } catch {}
}
