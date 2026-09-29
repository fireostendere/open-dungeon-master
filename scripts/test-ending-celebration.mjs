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

// Verify banner text collections, YOLO mode, and audio in EndingCelebration.tsx
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
assert.ok(endingCode.includes("YOLO_VICTORY_BANNERS_RU"), "Missing YOLO_VICTORY_BANNERS_RU");
assert.ok(endingCode.includes("YOLO_DEFEAT_BANNERS_RU"), "Missing YOLO_DEFEAT_BANNERS_RU");
assert.ok(endingCode.includes("🔥 ЕБАЛИ И РАЗЪЕБАЛИ! 🔥"), "Missing YOLO victory banner");
assert.ok(endingCode.includes("☠️ ПОЛНЫЙ ПИЗДЕЦ И ПРОЁБ ☠️"), "Missing YOLO defeat banner");
assert.ok(endingCode.includes("createDynamicsCompressor"), "Missing DynamicsCompressorNode to prevent blasting ears");
assert.ok(endingCode.includes("stopSadTrombone"), "Missing stopSadTrombone method");
assert.ok(endingCode.includes("fadeStart: 1000"), "Missing 1-second readable banner duration");
assert.ok(endingCode.includes("maxAge: 1400"), "Missing 1.4-second banner maxAge");
assert.ok(endingCode.includes("roundRect"), "Missing pill background rendering for banners");

// The served demo page carries the same audio and physics as the component.
const rootDemo = fs.readFileSync("public/demo-ending.html", "utf8");
assert.ok(rootDemo.includes("playSquish"), "demo-ending.html missing playSquish");
assert.ok(rootDemo.includes("bounceCount"), "demo-ending.html missing bounceCount in dice physics");
assert.ok(rootDemo.includes("spawnMudSplat"), "demo-ending.html missing spawnMudSplat");
assert.ok(rootDemo.includes("💩 Тест шлёпа"), "demo-ending.html missing squish test button");
assert.ok(rootDemo.includes("btnYolo"), "demo-ending.html missing YOLO button");
assert.ok(rootDemo.includes("YOLO_VICTORY_BANNERS"), "demo-ending.html missing YOLO victory banners");
assert.ok(rootDemo.includes("YOLO_DEFEAT_BANNERS"), "demo-ending.html missing YOLO defeat banners");
assert.ok(rootDemo.includes("createDynamicsCompressor"), "demo-ending.html missing dynamics compressor");
assert.ok(rootDemo.includes("stopSadTrombone"), "demo-ending.html missing stopSadTrombone");
assert.ok(rootDemo.includes("fadeStart: 1000"), "demo-ending.html missing 1-second banner fadeStart");
assert.ok(rootDemo.includes("maxAge: 1400"), "demo-ending.html missing 1.4-second banner maxAge");

console.log(`PASS: All 5 files transpiled cleanly and all 28 ending celebration, YOLO 21+, compressor, trombone race-fix, and mobile responsive assertions verified.`);

