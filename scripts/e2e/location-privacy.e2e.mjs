import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function playwrightModule() {
  if (process.env.ODM_PLAYWRIGHT_MODULE) return pathToFileURL(path.resolve(process.env.ODM_PLAYWRIGHT_MODULE)).href;
  const fallback = "/tmp/odm-browser/node_modules/playwright/index.mjs";
  return fs.existsSync(fallback) ? pathToFileURL(fallback).href : "playwright";
}

const required = ["ODM_E2E_BASE_URL", "ODM_E2E_CAMPAIGN_ID", "ODM_E2E_SECRET_MARKER", "ODM_E2E_DM_STATE", "ODM_E2E_A_STATE", "ODM_E2E_B_STATE", "ODM_E2E_OUTSIDER_STATE"];
const missing = required.filter(name => !process.env[name]);
if (missing.length) {
  console.error(`NOT RUN: missing ${missing.join(", ")}. Prepare four test-only storage states and a local campaign.`);
  process.exitCode = 2;
} else {
  const { chromium } = await import(await playwrightModule());
  const browser = await chromium.launch({ headless: true });
  const base = process.env.ODM_E2E_BASE_URL.replace(/\/$/, "");
  const campaign = encodeURIComponent(process.env.ODM_E2E_CAMPAIGN_ID);
  const marker = process.env.ODM_E2E_SECRET_MARKER;
  const roles = ["DM", "A", "B", "outsider"];
  const contexts = new Map();
  try {
    for (const role of roles) {
      const state = process.env[`ODM_E2E_${role.toUpperCase()}_STATE`];
      contexts.set(role, await browser.newContext({ storageState: state }));
    }
    const read = async role => {
      const response = await contexts.get(role).request.get(`${base}/api/campaigns/${campaign}`);
      assert.equal(response.status(), 200, `${role} snapshot HTTP`);
      return response.json();
    };
    const snapshots = Object.fromEntries(await Promise.all(roles.map(async role => [role, await read(role)])));
    assert.ok(JSON.stringify(snapshots.DM).includes(marker));
    assert.ok(JSON.stringify(snapshots.A).includes(marker));
    assert.ok(!JSON.stringify(snapshots.B).includes(marker));
    assert.notEqual((await contexts.get("outsider").request.get(`${base}/api/campaigns/${campaign}`)).status(), 200);

    const aRooms = snapshots.A.spatial?.rooms ?? [];
    const roomId = aRooms.find(room => room.active)?.id;
    assert.ok(roomId, "A has no active room in the prepared fixture");
    const bHistory = await contexts.get("B").request.get(`${base}/api/campaigns/${campaign}/location-chat?roomId=${encodeURIComponent(roomId)}`);
    assert.notEqual(bHistory.status(), 200);
    assert.ok(!(await bHistory.text()).includes(marker));
    console.log("Location privacy Playwright E2E passed with four independent BrowserContexts.");
  } finally {
    await Promise.all([...contexts.values()].map(context => context.close()));
    await browser.close();
  }
}
