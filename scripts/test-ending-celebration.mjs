import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
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

// The shared sound kit guards the ears and the trombone's last note wobbles cleanly.
const sound = fs.readFileSync("src/lib/fx/sound.ts", "utf8");
assert.ok(sound.includes("createDynamicsCompressor"), "a compressor sits on the master bus");
assert.ok(sound.includes("export function sfxSadTrombone"));
assert.ok(sound.includes("fxMuted()"), "every cue respects the FX mute");

const session = fs.readFileSync("src/app/campaigns/[campaignId]/SessionView.tsx", "utf8");
assert.ok(session.includes("<EndingCinematic"), "SessionView mounts the new finale");
assert.ok(!session.includes("EndingCelebration"), "the old finale is gone");
assert.ok(session.includes("mode={defaultCelebrationMode}"), "the cinematic follows the recorded campaign outcome");

// Render the real controls: the recorded outcome must be the only finale offered.
let locale = "ru";
const jsx = (type, props) => ({ type, props });
const mocks = {
  react: {
    useState: initial => [initial, () => {}], useRef: current => ({ current }),
    useCallback: fn => fn, useEffect() {}, useLayoutEffect() {},
  },
  "react/jsx-runtime": { jsx, jsxs: jsx },
  "@/lib/i18n": { useI18n: () => ({ locale }) },
  "@/lib/i18n/locale-text": { localeText: (language, values) => values[language] },
  "@/lib/cn": { cn: (...values) => values.filter(Boolean).join(" ") },
  "@/lib/fx/particles": { FIREWORK_COLORS: {} },
  "../shared": { useDismissKeys() {}, useFxCanvas: () => ({ current: null }), useFxMuted: () => [true, () => {}], useReducedMotion: () => true },
};
function load(file) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, require: name => mocks[name] ?? new Proxy({}, { get: (_target, key) => key }),
  });
  return exports;
}
mocks["./ending-copy"] = load("src/components/fx/cinematics/ending-copy.ts");
const { ClosingMessageModal } = load("src/app/campaigns/[campaignId]/ClosingMessageModal.tsx");
const { ClosingMessageBanner } = load("src/app/campaigns/[campaignId]/ClosingMessageBanner.tsx");
const { EndingCinematic } = load("src/components/fx/cinematics/EndingCinematic.tsx");
const walk = (tree, predicate) => !tree || typeof tree !== "object" ? []
  : Array.isArray(tree) ? tree.flatMap(child => walk(child, predicate))
  : [...(predicate(tree) ? [tree] : []), ...walk(tree.props?.children, predicate)];
const text = tree => tree == null || typeof tree === "boolean" ? ""
  : Array.isArray(tree) ? tree.map(text).join(" ")
  : typeof tree === "object" ? text(tree.props?.children) : String(tree);
for (locale of ["ru", "en"]) {
  for (const isYolo of [false, true]) {
    for (const mode of ["victory", "defeat"]) {
      const defeat = mode === "defeat";
      const opposite = defeat ? /побед|салют|victory|fireworks|triumph/i : /поражени|про[ёе]б|тромбон|defeat|disaster|trombone|fallen/i;
      const expected = locale === "ru" ? (defeat ? /поражени/i : /побед/i) : (defeat ? /defeat/i : /victory/i);
      const calls = [];
      const modal = ClosingMessageModal({ open: true, campaignTitle: "Campaign", defaultMode: mode, isYolo,
        onOpenChange: value => calls.push(value), onTriggerCelebration: () => calls.push("replay") });
      assert.match(text(walk(modal, node => node.type === "Title")[0]), expected, "the title names the outcome");
      assert.doesNotMatch(text(modal), opposite, "the finale must not offer the opposite result");
      const actions = walk(modal, node => node.type === "button" && expected.test(text(node)));
      assert.equal(actions.length, 1, "exactly one outcome replay is offered");
      actions[0].props.onClick();
      assert.deepEqual(calls, [false, "replay"], "replay closes the message and launches the recorded outcome");
      const banner = ClosingMessageBanner({ campaignTitle: "Campaign", hasOpened: false, defaultMode: mode, isYolo, onOpenClosingMessage() {} });
      assert.match(text(banner), expected);
      assert.doesNotMatch(text(banner), opposite);
      const cinematic = EndingCinematic({ active: true, mode, isYolo, onClose() {} });
      assert.doesNotMatch(text(cinematic), opposite, "the cinematic cannot switch the result");
      const die = walk(cinematic, node => node.type === "HeroDie")[0];
      assert.equal(die.props.throwSpec.dice[0].value, defeat ? 1 : 20);
    }
  }
}

console.log("PASS: outcome-specific finale controls, banners, cues and wiring verified.");
