import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

// The finale and its neighbours parse and transpile cleanly.
const files = [
  "src/components/fx/cinematics/EndingCinematic.tsx",
  "src/components/fx/cinematics/ending-copy.ts",
  "src/app/campaigns/[campaignId]/ClosingMessageModal.tsx",
  "src/app/campaigns/[campaignId]/ClosingMessageBanner.tsx",
  "src/app/campaigns/[campaignId]/LegacySessionChatColumn.tsx",
  "src/app/campaigns/[campaignId]/SessionView.tsx",
];
for (const f of files) {
  const res = ts.transpileModule(fs.readFileSync(f, "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
  });
  assert.ok(res.outputText.length > 0, `${f} produced empty output`);
}

// Banner pools, including the YOLO 21+ table voice, survived the rewrite.
const copy = fs.readFileSync("src/components/fx/cinematics/ending-copy.ts", "utf8");
for (const pool of ["VICTORY_BANNERS_RU", "DEFEAT_BANNERS_RU", "YOLO_VICTORY_BANNERS_RU", "YOLO_DEFEAT_BANNERS_RU", "VICTORY_BANNERS_EN", "YOLO_DEFEAT_BANNERS_EN"]) {
  assert.ok(copy.includes(`export const ${pool}`), `missing ${pool}`);
}
assert.ok(copy.includes("💀 ПОЛНЫЙ ПРОЁБ 💀") || copy.includes("☠️ ПОЛНЫЙ ПРОЁБ ☠️"), "missing the defeat banner");
assert.ok(copy.includes("🔥 ЕБАЛИ И РАЗЪЕБАЛИ! 🔥"), "missing the YOLO victory banner");
assert.ok(copy.includes("☠️ ПОЛНЫЙ ПИЗДЕЦ И ПРОЁБ ☠️"), "missing the YOLO defeat banner");

// The cinematic keeps its controls and plays the right cues.
const ending = fs.readFileSync("src/components/fx/cinematics/EndingCinematic.tsx", "utf8");
assert.ok(ending.includes("sfxSadTrombone"), "YOLO defeat plays the sad trombone");
assert.ok(ending.includes("sfxBrassFanfare"), "victory plays the fanfare");
assert.ok(ending.includes('outcome: defeat ? "fumble" : "crit"'), "the last roll lands on 1 or 20");
assert.ok(ending.includes("copy.dropMoreDice") && ending.includes("copy.moreFireworks"), "both encore buttons remain");
assert.ok(ending.includes("closingMessage") && ending.includes("fx-scroll__paper"), "the DM's closing message opens on a scroll");
assert.ok(ending.includes("onModeChange?.(next)"), "switching victory/defeat is reported up");

// The shared sound kit guards the ears and the trombone's last note wobbles cleanly.
const sound = fs.readFileSync("src/lib/fx/sound.ts", "utf8");
assert.ok(sound.includes("createDynamicsCompressor"), "a compressor sits on the master bus");
assert.ok(sound.includes("export function sfxSadTrombone"));
assert.ok(sound.includes("fxMuted()"), "every cue respects the FX mute");

const session = fs.readFileSync("src/app/campaigns/[campaignId]/SessionView.tsx", "utf8");
assert.ok(session.includes("<EndingCinematic"), "SessionView mounts the new finale");
assert.ok(!session.includes("EndingCelebration"), "the old finale is gone");

console.log("PASS: finale cinematic, banners, cues and wiring verified.");
