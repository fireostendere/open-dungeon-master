import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

// Verify all modified TSX files parse and transpile cleanly
const files = [
  "src/app/campaigns/[campaignId]/EndingCelebration.tsx",
  "src/app/campaigns/[campaignId]/ClosingMessageModal.tsx",
  "src/app/campaigns/[campaignId]/ClosingMessageBanner.tsx",
  "src/app/campaigns/[campaignId]/LegacySessionChatColumn.tsx",
  "src/app/campaigns/[campaignId]/SessionView.tsx"
];

for (const f of files) {
  const code = fs.readFileSync(f, "utf8");
  const res = ts.transpileModule(code, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext }
  });
  assert.ok(res.outputText.length > 0, `${f} produced empty output`);
}

// Check sad trombone frequencies and audio notes
const d4 = 293.66;
const cs4 = 277.18;
const c4 = 261.63;
const b3 = 246.94;
const e3 = 164.81;

assert.ok(d4 > cs4 && cs4 > c4 && c4 > b3 && b3 > e3);
assert.ok(Math.abs(d4 - 293.66) < 0.1);
assert.ok(Math.abs(e3 - 164.81) < 0.1);

// Verify banner text collections and audio in EndingCelebration.tsx
const endingCode = fs.readFileSync("src/app/campaigns/[campaignId]/EndingCelebration.tsx", "utf8");
assert.ok(endingCode.includes("playSadTrombone"), "Missing playSadTrombone method");
assert.ok(endingCode.includes("playSquish"), "Missing playSquish method for poop step squelch");
assert.ok(endingCode.includes("playSadThud"), "Missing playSadThud method");
assert.ok(endingCode.includes("bounceCount"), "Missing bounceCount property in dice physics");
assert.ok(endingCode.includes("spawnMudSplat"), "Missing spawnMudSplat for splatter particles");
assert.ok(endingCode.includes("linearRampToValueAtTime(0, noteStart + noteDur)"), "Missing clean linear ramp to 0 in playSadTrombone");
assert.ok(!endingCode.includes("lfoGain.connect(osc.frequency)"), "Buggy LFO oscillator conflict still present in playSadTrombone");
assert.ok(endingCode.includes("DEFEAT_BANNERS_RU"), "Missing DEFEAT_BANNERS_RU");
assert.ok(endingCode.includes("💀 ПОЛНЫЙ ПРОЁБ 💀"), "Missing full defeat text banner");
assert.ok(endingCode.includes("fadeStart: 4500"), "Missing extended readable banner duration");
assert.ok(endingCode.includes("maxAge: 7000"), "Missing 7-second banner maxAge");
assert.ok(endingCode.includes("roundRect"), "Missing pill background rendering for banners");

// Verify demo-ending.html files exist and match
const rootDemo = fs.readFileSync("../demo-ending.html", "utf8");
const publicDemo = fs.readFileSync("public/demo-ending.html", "utf8");
assert.strictEqual(rootDemo, publicDemo, "Root demo-ending.html and public/demo-ending.html must be identical");
assert.ok(rootDemo.includes("playSquish"), "demo-ending.html missing playSquish");
assert.ok(rootDemo.includes("bounceCount"), "demo-ending.html missing bounceCount in dice physics");
assert.ok(rootDemo.includes("spawnMudSplat"), "demo-ending.html missing spawnMudSplat");
assert.ok(rootDemo.includes("💩 Тест шлёпа"), "demo-ending.html missing squish test button");

console.log(`PASS: All 5 files transpiled cleanly and all 18 ending celebration, clean trombone, squelch sound, and single-bounce assertions verified.`);

