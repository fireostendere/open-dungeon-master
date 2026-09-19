import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

// Resolve the pinned test workspace, not an unrelated /tmp installation.
export async function loadPlaywright(override = process.env.ODM_PLAYWRIGHT_MODULE) {
  if (override) return import(pathToFileURL(path.resolve(override)).href);
  const require = createRequire(new URL("../../tests/ui-mcp/package.json", import.meta.url));
  try { return await import(pathToFileURL(require.resolve("playwright")).href); }
  catch (cause) { throw new Error("Install the pinned browser dependencies with npm ci --prefix tests/ui-mcp.", { cause }); }
}

export function assertLocalTarget(baseUrl) {
  const url = new URL(baseUrl);
  assert.ok(["http:", "https:"].includes(url.protocol) && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash,
  "This smoke accepts a local test-server origin only, never production.");
  return url.origin;
}

// This is deliberately named a prepared-fixture smoke, NOT complete R11
// acceptance. It proves the selected read paths and native page tool, not
// independent combat, v1/v2 maps, the MCP transport, rewind or all UI actions.
export async function runPreparedLocationSmoke({ browser, baseUrl, campaignId, marker, states, requireNativeWebMcp = true }) {
  const base = assertLocalTarget(baseUrl);
  assert.ok(campaignId && typeof marker === "string" && marker.length > 0, "Missing test campaign or marker.");
  const endpoint = `${base}/api/campaigns/${encodeURIComponent(campaignId)}`;
  const contexts = new Map();
  const checks = [];
  try {
    for (const role of ["DM", "A", "B", "OUTSIDER"]) {
      assert.ok(states[role], `Missing ${role} test-only storage state.`);
      contexts.set(role, await browser.newContext({ storageState: states[role] }));
    }
    const get = (role, suffix = "") => contexts.get(role).request.get(endpoint + suffix);
    // A post-split location message is not in the old campaign_messages table.
    // Query the actual location history rather than requiring it in snapshot.
    for (const role of ["DM", "A", "B"]) assert.equal((await get(role)).status(), 200, `${role} campaign membership`);
    const outsider = await get("OUTSIDER");
    assert.ok([401, 403, 404].includes(outsider.status()), "Outsider must be denied, not redirected or given a successful snapshot.");
    assert.equal((await outsider.text()).includes(marker), false, "Outsider response contains private text.");
    checks.push("separate membership and outsider expectations");
    const positions = {};
    for (const role of ["A", "B"]) {
      const response = await get(role, "/location-chat"); assert.equal(response.status(), 200);
      positions[role] = await response.json();
    }
    const roomId = positions.A.current?.roomId;
    assert.ok(roomId && positions.A.enabled && positions.B.enabled, "Fixture must have location mode and A's current room.");
    assert.notEqual(positions.B.current?.roomId, roomId, "Fixture B must be outside A's scene.");
    const history = `/location-chat?roomId=${encodeURIComponent(roomId)}`;
    for (const role of ["A", "DM"]) {
      const response = await get(role, history); assert.equal(response.status(), 200);
      assert.ok(JSON.stringify(await response.json()).includes(marker), `${role} positive control: marker must actually exist in authorized history.`);
    }
    const bHistory = await get("B", history);
    // B may have an archived tab. A 200 with only witnessed old messages is
    // correct; a guessed never-visited room normally returns 404.
    assert.ok([200, 403, 404].includes(bHistory.status()), "Unexpected B history status.");
    assert.equal((await bHistory.text()).includes(marker), false, "B's history contains an unwitnessed marker.");
    assert.equal((await (await get("B")).text()).includes(marker), false, "B's campaign snapshot contains a private marker.");
    checks.push("correct history endpoint with positive and negative controls");

    if (requireNativeWebMcp) {
      const page = await contexts.get("A").newPage();
      await page.goto(`${base}/campaigns/${encodeURIComponent(campaignId)}`);
      await page.getByTestId("location-chat").waitFor({ state: "visible" });
      const result = await page.evaluate(async () => {
        const context = document.modelContext;
        if (!context || typeof context.getTools !== "function" || typeof context.executeTool !== "function") {
          throw new Error("NOT RUN: native document.modelContext getTools/executeTool is unavailable; no polyfill counts as native acceptance.");
        }
        const tools = await context.getTools();
        const tool = tools.find(item => item.name === "odm_list_visible_locations");
        if (!tool) throw new Error("Native location tool was not registered.");
        return JSON.parse(await context.executeTool(tool, {}));
      });
      assert.equal(result.current?.roomId, roomId, "Native WebMCP must run with A's authorized identity.");
      checks.push("real page native WebMCP list and authorized read");
    }
    return { suite: "prepared-location-read-smoke", checks, fullAcceptance: false,
      notCovered: ["dynamic movement and scene mechanics", "object update/deletion and rewind", "MCP transport tool calls", "full independent-scene browser acceptance"] };
  } finally { await Promise.all([...contexts.values()].map(context => context.close())); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const required = ["ODM_E2E_BASE_URL", "ODM_E2E_CAMPAIGN_ID", "ODM_E2E_SECRET_MARKER", "ODM_E2E_DM_STATE", "ODM_E2E_A_STATE", "ODM_E2E_B_STATE", "ODM_E2E_OUTSIDER_STATE"];
  const missing = required.filter(name => !process.env[name]);
  if (missing.length) {
    console.error(`NOT RUN: missing ${missing.join(", ")}. Use four independent test-only sessions and a local fixture.`);
    process.exitCode = 2;
  } else {
    let browser;
    try {
      assertLocalTarget(process.env.ODM_E2E_BASE_URL);
      const states = Object.fromEntries(["DM", "A", "B", "OUTSIDER"].map(role => [role, process.env[`ODM_E2E_${role}_STATE`]]));
      for (const file of Object.values(states)) assert.ok(fs.statSync(file).isFile(), "Storage state does not exist.");
      const { chromium } = await loadPlaywright();
      browser = await chromium.launch({ headless: true });
      const result = await runPreparedLocationSmoke({ browser, baseUrl: process.env.ODM_E2E_BASE_URL,
        campaignId: process.env.ODM_E2E_CAMPAIGN_ID, marker: process.env.ODM_E2E_SECRET_MARKER, states,
        requireNativeWebMcp: process.env.ODM_E2E_READ_ONLY_SMOKE !== "1" });
      console.log(JSON.stringify(result));
      console.log("Prepared read smoke passed. Full R11 acceptance is NOT established by this subset.");
    } catch (error) { console.error(error instanceof Error ? error.message : "Location smoke failed."); process.exitCode = 1; }
    finally { await browser?.close(); }
  }
}
