// Per-device animation settings, the "fight won" rule, and the stream never
// losing a roll to a snapshot that overtook its event.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import vm from "node:vm";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");

// ------------------------------------------------------------ a fake window
const store = new Map();
const events = [];
let media = {};
const fakeWindow = {
  innerWidth: 1440,
  innerHeight: 900,
  navigator: { hardwareConcurrency: 8, deviceMemory: 8 },
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  matchMedia: (q) => ({ matches: Boolean(media[q]), addEventListener() {}, removeEventListener() {} }),
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent: (e) => events.push(e.type),
};
globalThis.window = fakeWindow;

const bundle = await build({
  stdin: {
    contents: `
      export * from "@/lib/fx/prefs";
      export { fightEnding } from "@/lib/fx/moments";
      export { fxMuted, setFxMuted } from "@/lib/fx/sound";
    `,
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  tsconfig: path.join(root, "tsconfig.json"),
  logLevel: "error",
});
const m = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

const desktop = { compact: false, lowEnd: false, osReducedMotion: false };
const phone = { compact: true, lowEnd: false, osReducedMotion: false };

test("defaults: everything on, full on desktop, lite and compact rolls on a phone", () => {
  const d = m.resolveFxSettings(m.FX_PREF_DEFAULTS, desktop);
  assert.equal(d.dice && d.cinematics && d.particles && d.sound, true);
  assert.equal(d.lite, false);
  assert.equal(d.othersRolls, "full");
  assert.equal(d.reducedMotion, false);
  const p = m.resolveFxSettings(m.FX_PREF_DEFAULTS, phone);
  assert.equal(p.lite, true);
  assert.equal(p.othersRolls, "compact");
  assert.equal(m.resolveFxSettings(m.FX_PREF_DEFAULTS, { ...desktop, lowEnd: true }).lite, true, "weak hardware gets Lite on Auto");
});

test("explicit choices beat the device, and motion follows the system only on Auto", () => {
  const prefs = { ...m.FX_PREF_DEFAULTS, quality: "full", othersRolls: "off", motion: "full" };
  const s = m.resolveFxSettings(prefs, { ...phone, osReducedMotion: true });
  assert.equal(s.lite, false);
  assert.equal(s.othersRolls, "off");
  assert.equal(s.reducedMotion, false, "Off overrides the system");
  assert.equal(m.resolveFxSettings({ ...m.FX_PREF_DEFAULTS, motion: "auto" }, { ...desktop, osReducedMotion: true }).reducedMotion, true);
  assert.equal(m.resolveFxSettings({ ...m.FX_PREF_DEFAULTS, motion: "reduce" }, desktop).reducedMotion, true);
  assert.equal(m.resolveFxSettings({ ...m.FX_PREF_DEFAULTS, quality: "lite" }, desktop).lite, true);
});

test("storage: one JSON key, legacy dice switch ignored, legacy FX mute migrated, junk sanitised", () => {
  store.clear();
  store.set("odm:dice3d", "off");
  store.set("odm:fx-muted", "1");
  const first = m.readFxPrefs();
  assert.equal(first.dice, true, "the old overlay's dice switch no longer silences the new dice");
  assert.equal(first.sound, false, "the old FX mute carries over");
  assert.equal(m.fxMuted(), true);
  m.setFxMuted(false);
  assert.equal(m.fxMuted(), false);
  assert.deepEqual(JSON.parse(store.get("odm:fx-prefs:v1")).sound, true);
  assert.ok(events.includes("odm-fx-prefs"), "a change event reaches this tab");
  m.writeFxPrefs({ quality: "lite", othersRolls: "compact" });
  assert.equal(m.readFxPrefs().quality, "lite");
  assert.equal(m.readFxPrefs(), m.readFxPrefs(), "unchanged storage returns the same object (useSyncExternalStore)");
  store.set("odm:fx-prefs:v1", JSON.stringify({ dice: "yes", quality: "ultra", motion: "reduce" }));
  const junk = m.readFxPrefs();
  assert.equal(junk.dice, true);
  assert.equal(junk.quality, "auto");
  assert.equal(junk.motion, "reduce");
  store.set("odm:fx-prefs:v1", "{not json");
  assert.equal(m.readFxPrefs().dice, true);
});

test("resolved settings follow the viewport and stay referentially stable", () => {
  store.clear();
  fakeWindow.innerWidth = 1440;
  fakeWindow.innerHeight = 900;
  media = {};
  const a = m.readFxSettings();
  assert.equal(a, m.readFxSettings());
  assert.equal(a.compact, false);
  fakeWindow.innerWidth = 390;
  fakeWindow.innerHeight = 844;
  const b = m.readFxSettings();
  assert.equal(b.compact, true);
  assert.equal(b.lite, true);
  fakeWindow.innerWidth = 844;
  fakeWindow.innerHeight = 390;
  assert.equal(m.readFxSettings().compact, true, "a phone on its side is still a phone");
  fakeWindow.innerWidth = 1024;
  fakeWindow.innerHeight = 1366;
  media = { "(pointer: coarse)": true };
  assert.equal(m.readFxSettings().compact, true, "a touch-only tablet");
});

test("fight ending: victory XP, the last foe never seen dead, and a retreat", () => {
  const foes = [
    { id: "a", name: "Goblin", status: "dead" },
    { id: "b", name: "Ogre", status: "alive" },
  ];
  const statusOf = (e) => e.status;
  const won = m.fightEnding({ enemies: foes, statusOf, audit: [{ kind: "award_xp", reason: "encounter victory", seq: 12 }], since: 10 });
  assert.equal(won.victory, true);
  assert.deepEqual(won.lastStanding.map((e) => e.name), ["Ogre"], "the last blow still gets its Slain");
  const fled = m.fightEnding({ enemies: foes, statusOf, audit: [{ kind: "award_xp", reason: "encounter ended: enemies_fled", seq: 12 }], since: 10 });
  assert.equal(fled.victory, false);
  const oldXp = m.fightEnding({ enemies: [...foes, { id: "c", name: "Wolf", status: "alive" }], statusOf, audit: [{ kind: "award_xp", reason: "encounter victory", seq: 3 }], since: 10 });
  assert.equal(oldXp.victory, false, "XP from an earlier fight does not count, and two standing foes are no win");
  assert.equal(m.fightEnding({ enemies: foes, statusOf, audit: [], since: 0 }).victory, true, "no XP: one foe left after losses");
  assert.equal(m.fightEnding({ enemies: foes.map((e) => ({ ...e, status: "alive" })), statusOf, audit: [], since: 0 }).victory, false);
  assert.equal(m.fightEnding({ enemies: foes.map((e) => ({ ...e, status: "dead" })), statusOf, audit: [], since: 0 }).victory, true);
});

// ------------------------------------------------------------ stream reducer
async function loader(stubs = {}) {
  const context = vm.createContext({ console, Date, Intl, setInterval, clearInterval });
  const modules = new Map();
  async function load(name) {
    if (modules.has(name)) return modules.get(name);
    let vmModule;
    const synthetic = (values) =>
      new vm.SyntheticModule(Object.keys(values), function () {
        for (const [key, value] of Object.entries(values)) this.setExport(key, value);
      }, { context, identifier: name });
    if (stubs[name]) vmModule = synthetic(stubs[name]);
    else if (!name.startsWith("@/") && !name.startsWith(".")) vmModule = synthetic({ ...(await import(name)) });
    else {
      let rel = name.startsWith("@/") ? `../src/${name.slice(2)}` : name;
      if (!/\.(?:ts|tsx|mjs)$/.test(rel)) rel += ".ts";
      const source = readFileSync(new URL(rel, import.meta.url), "utf8");
      vmModule = new vm.SourceTextModule(stripTypeScriptTypes(source), { context, identifier: name });
    }
    modules.set(name, vmModule);
    await vmModule.link(load);
    return vmModule;
  }
  return async (name) => {
    const loaded = await load(name);
    await loaded.evaluate();
    return loaded.namespace;
  };
}

const stream = await (await loader({
  react: { useCallback: (f) => f, useEffect() {}, useReducer() {}, useRef: (value) => ({ current: value }) },
  "@/lib/dm/call-tracker-logic": { sortCalls: (calls) => calls },
  "@/lib/ambience/logic": { EMPTY_AMBIENCE: {} },
  "@/lib/dm/viewer": { capsForRole: () => ({}) },
  "@/lib/navigation": { navigateTo() {} },
  "@/lib/i18n": { useI18n: () => ({ locale: "en" }) },
  "@/lib/i18n/session-text": { sessionText: () => "" },
}))("../src/app/campaigns/[campaignId]/useCampaignStream.ts");

const roll = (id, createdAt, extra = {}) => ({ id, createdAt, total: 12, breakdown: { terms: [] }, ...extra });

test("stream: a roll only a snapshot brought still becomes latestRoll; the first snapshot is a baseline", () => {
  const { campaignStreamReducer: reduce, initialCampaignState } = stream;
  const campaign = { id: "c1" };
  let state = reduce(initialCampaignState, { type: "snapshot", payload: { campaign, lastSeq: 10, rolls: [roll("r1", "2026-09-29T10:00:00.000Z")] } });
  assert.equal(state.latestRoll, null, "history is not replayed on load");
  state = reduce(state, { type: "snapshot", payload: { campaign, lastSeq: 14, rolls: [roll("r1", "2026-09-29T10:00:00.000Z"), roll("r2", "2026-09-29T10:01:00.000Z")] } });
  assert.equal(state.latestRoll?.roll.id, "r2");
  assert.equal(state.latestRoll?.seq, 14);
  const same = reduce(state, { type: "snapshot", payload: { campaign, lastSeq: 15, rolls: [roll("r1", "2026-09-29T10:00:00.000Z"), roll("r2", "2026-09-29T10:01:00.000Z")] } });
  assert.equal(same.latestRoll, state.latestRoll, "a known roll is not announced twice");
  // The event for r2 arrives late: covered by the snapshot, already announced.
  const late = reduce(same, { type: "event", eventType: "roll_result", seq: 13, payload: { roll: roll("r2", "2026-09-29T10:01:00.000Z") } });
  assert.equal(late.latestRoll, same.latestRoll);
});

test("stream: a roll_result the snapshot overtook is still announced", () => {
  const { campaignStreamReducer: reduce, initialCampaignState } = stream;
  const campaign = { id: "c1" };
  let state = reduce(initialCampaignState, { type: "snapshot", payload: { campaign, lastSeq: 20, rolls: [] } });
  state = reduce(state, { type: "event", eventType: "roll_result", seq: 21, payload: { roll: roll("a", "2026-09-29T10:00:00.000Z") } });
  assert.equal(state.latestRoll?.roll.id, "a");
  // Reconnect replay: the snapshot moved lastSeq past 23 before the event.
  state = { ...state, lastSeq: 30 };
  const replay = reduce(state, { type: "event", eventType: "roll_result", seq: 23, payload: { roll: roll("b", "2026-09-29T10:02:00.000Z"), pendingRollId: "p1" } });
  assert.equal(replay.latestRoll?.roll.id, "b");
  assert.equal(replay.latestRoll?.seq, 23);
  assert.equal(replay.lastSeq, 30, "the cursor does not move back");
  const older = reduce(replay, { type: "event", eventType: "roll_result", seq: 22, payload: { roll: roll("c", "2026-09-29T10:01:00.000Z") } });
  assert.equal(older.latestRoll?.roll.id, "b", "an older replayed roll never replaces a newer one");
  const other = reduce(replay, { type: "event", eventType: "message_added", seq: 24, payload: { message: { id: "m" } } });
  assert.equal(other, replay, "other covered events still drop");
});
