// A sheet already past its 5e spell count (a hand edit, an old sheet, a DM's
// gift through update_sheet) can still level up as long as the level-up adds
// no spell; adding one past the count is still refused. Runs the real sheet
// route on a throwaway lab table (scripts/lab).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.LAB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "odm-levelup-"));
try {
  const lab = await import("./lab/odm-lab.mjs");
  const { execFileSync } = await import("node:child_process");
  execFileSync(process.execPath, [path.join(import.meta.dirname, "lab/odm-lab.mjs"), "seed"], { env: process.env, stdio: "ignore" });
  const { campaignId, tokens, sheets } = lab.campaignState();
  const { patchSheet, getSheetById } = await import("../src/lib/db/sheets.ts");
  const before = getSheetById(sheets.oleg).spellcasting;
  // Level 1 druid, WIS 16: three prepared. Level 2 allows five; this holds six.
  patchSheet(sheets.oleg, {
    xp: 300,
    spellcasting: { ...before, prepared: [...before.prepared, "Entangle", "Faerie Fire", "Goodberry", "Fog Cloud"] },
  });
  const { sheet } = await lab.route("sheet", "GET", { token: tokens.oleg, campaignId });
  const sc = sheet.spellcasting;

  await assert.rejects(
    lab.route("sheet", "PATCH", { token: tokens.oleg, campaignId, body: { level: 2, spellcasting: { ...sc, prepared: [...sc.prepared, "Healing Word"] } } }),
    /may hold 5 spells prepared/,
  );
  const leveled = await lab.route("sheet", "PATCH", { token: tokens.oleg, campaignId, body: { level: 2, spellcasting: sc } });
  assert.equal(leveled.sheet.level, 2);
  assert.ok(leveled.sheet.spellcasting.prepared.includes("Fog Cloud"));
  console.log("test-levelup-granted-spells: 2 passed");
} finally {
  fs.rmSync(process.env.LAB_DIR, { recursive: true, force: true });
}
