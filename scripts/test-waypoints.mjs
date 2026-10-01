// Waypoints (upstream issue #31): the checklist under a beat that gates its
// completion. Pure: the stored shape, matching tool calls to steps (English
// and Russian names), ticking, which steps gate, and the lead's hand edits.
import assert from "node:assert/strict";
import { normalizeStoryArc } from "../src/lib/dm/arc-logic.ts";
import {
  activeBeat,
  beatGated,
  gatingWaypoints,
  lexicalMatch,
  matchSignal,
  openWaypoints,
  signalFromToolCall,
  stems,
  tickWaypoints,
} from "../src/lib/dm/waypoint-logic.ts";
import { applyBeatEdit } from "../src/lib/dm/arc-edit-logic.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const gatedArc = () =>
  normalizeStoryArc({
    premise: "The heart wakes beneath the drowned cathedral.",
    beats: [
      { text: "Leave Halvord's Reach.", status: "done", act: 1 },
      {
        text: "Cross the glass plain to the drowned cathedral.",
        status: "active",
        act: 1,
        waypoints: [
          { kind: "npc", text: "Speak with Brisca Hale about the safe path" },
          { kind: "place", text: "Reach the Drowned Cathedral of Vael" },
          { kind: "item", text: "Recover the glass fragment" },
          { kind: "narrative", text: "Witness the petrified pilgrims" },
        ],
      },
      { text: "Confront the vicar.", status: "pending", act: 1 },
    ],
  });

test("the stored arc keeps waypoints; an unknown kind or a bare string is a narrative step", () => {
  const arc = normalizeStoryArc({
    premise: "p",
    beats: [
      { text: "a", status: "active", act: 1, waypoints: [{ kind: "sorcery", text: "Speak the words" }, "Bring the fragment", { kind: "PLACE", text: "Reach the seal", done: true }, { text: "" }, "x", "y"] },
      { text: "b", status: "pending", act: 1 },
    ],
  });
  assert.deepEqual(arc.beats[0].waypoints, [
    { kind: "narrative", text: "Speak the words", done: false },
    { kind: "narrative", text: "Bring the fragment", done: false },
    { kind: "place", text: "Reach the seal", done: true },
    { kind: "narrative", text: "x", done: false },
  ]);
  assert.equal(arc.beats[1].waypoints, undefined);
  assert.equal(normalizeStoryArc(arc).beats[0].waypoints.length, 4);
});

test("stems drop the words every waypoint shares, in any script, and survive endings", () => {
  assert.deepEqual(stems("Reach the Drowned Cathedral of Vael"), ["drown", "cathe", "vae"]);
  assert.deepEqual(stems("the cathedrals"), ["cathe"]);
  assert.deepEqual(stems("Добраться до Затонувшего собора Ваэля"), ["затон", "собор", "ваэл"]);
  assert.deepEqual(stems("Ёжик"), stems("ежик"));
});

test("a name matches a waypoint when its distinctive stems all appear, or most stems are shared", () => {
  assert.equal(lexicalMatch("Reach the Drowned Cathedral of Vael", "the drowned cathedral"), true);
  assert.equal(lexicalMatch("Reach the Drowned Cathedral of Vael", "Drowned Cathedral of Vael"), true);
  assert.equal(lexicalMatch("Speak with Brisca Hale about the safe path", "Brisca"), true);
  assert.equal(lexicalMatch("Speak with Brisca Hale about the safe path", "Brisca Hale"), true);
  assert.equal(lexicalMatch("Reach the Drowned Cathedral of Vael", "the ferry landing"), false);
  assert.equal(lexicalMatch("Recover the glass fragment", "Salt-Glass Husk"), false);
  assert.equal(lexicalMatch("Speak with Brisca Hale", "Father Kaelen"), false);
});

test("Russian names match across case endings", () => {
  assert.equal(lexicalMatch("Добраться до Затонувшего собора Ваэля", "Затонувший собор Ваэль"), true);
  assert.equal(lexicalMatch("Добраться до Затонувшего собора Ваэля", "Затонувший собор"), true);
  assert.equal(lexicalMatch("Поговорить с Бриской Хейл", "Бриска Хейл"), true);
  assert.equal(lexicalMatch("Победить солевых стражей", "Солевой страж"), true);
  assert.equal(lexicalMatch("Добраться до Затонувшего собора Ваэля", "Паромная пристань"), false);
  assert.equal(lexicalMatch("Поговорить с Бриской Хейл", "Отец Кайлен"), false);
});

test("tool calls become typed signals with the names the narrator and the server used", () => {
  assert.deepEqual(signalFromToolCall("move_party", '{"name":"The Drowned Cathedral"}', { location: "The Drowned Cathedral" }), { kind: "place", names: ["The Drowned Cathedral"] });
  assert.deepEqual(signalFromToolCall("update_location", '{"layoutDescription":"x"}', { location: "Glass Plain" }), { kind: "place", names: ["Glass Plain"] });
  assert.deepEqual(signalFromToolCall("set_npc", '{"name":"Brisca Hale"}'), { kind: "npc", names: ["Brisca Hale"] });
  assert.deepEqual(signalFromToolCall("npc_reaction", '{"name":"Brisca"}'), { kind: "npc", names: ["Brisca"] });
  assert.deepEqual(signalFromToolCall("social_check", '{"npc":"Brisca","approach":"persuade"}'), { kind: "npc", names: ["Brisca"] });
  assert.deepEqual(signalFromToolCall("grant_item", '{"name":"glass fragment"}'), { kind: "item", names: ["glass fragment"] });
  assert.deepEqual(signalFromToolCall("purchase", '{"item":"rope","action":"buy"}'), { kind: "item", names: ["rope"] });
  assert.equal(signalFromToolCall("purchase", '{"item":"rope","action":"sell"}'), null);
  assert.equal(signalFromToolCall("end_encounter", '{"outcome":"victory"}'), null);
  assert.equal(signalFromToolCall("travel", '{"hours":4}'), null);
  assert.equal(signalFromToolCall("move_party", "not json"), null);
});

test("a signal ticks only open waypoints of its own kind, never a narrative one", () => {
  const { beat } = activeBeat(gatedArc());
  assert.deepEqual(matchSignal(beat, { kind: "place", names: ["the drowned cathedral"] }), [1]);
  assert.deepEqual(matchSignal(beat, { kind: "npc", names: ["Brisca"] }), [0]);
  assert.deepEqual(matchSignal(beat, { kind: "item", names: ["the glass fragment"] }), [2]);
  assert.deepEqual(matchSignal(beat, { kind: "narrative", names: ["the petrified pilgrims"] }), []);
  assert.deepEqual(matchSignal(beat, { kind: "place", names: ["Brisca"] }), []);
});

test("ticks record on the beat; the gate lifts when the tool-checkable steps are done", () => {
  let arc = gatedArc();
  assert.equal(beatGated(activeBeat(arc).beat), true);
  arc = tickWaypoints(arc, 2, [0, 1]);
  assert.deepEqual(gatingWaypoints(activeBeat(arc).beat).map((w) => w.text), ["Recover the glass fragment"]);
  // A stale or repeated tick changes nothing.
  assert.equal(tickWaypoints(arc, 2, [0, 9]), arc);
  arc = tickWaypoints(arc, 2, [2]);
  // The narrative step is still open, but it is the narrator's own call.
  assert.equal(openWaypoints(activeBeat(arc).beat).length, 1);
  assert.equal(beatGated(activeBeat(arc).beat), false);
});

test("a beat without waypoints gates nothing", () => {
  const arc = gatedArc();
  assert.equal(beatGated(arc.beats[2]), false);
  assert.equal(beatGated(null), false);
});

test("the lead ticks and clears waypoints by hand, never on a settled beat", () => {
  const arc = gatedArc();
  const ticked = applyBeatEdit(arc, { op: "waypoint", beat: 2, index: 0, done: true });
  assert.equal(ticked.arc.beats[1].waypoints[0].done, true);
  assert.equal(arc.beats[1].waypoints[0].done, false);
  const cleared = applyBeatEdit(ticked.arc, { op: "waypoint", beat: 2, index: 0, done: false });
  assert.equal(cleared.arc.beats[1].waypoints[0].done, false);
  assert.ok("error" in applyBeatEdit(arc, { op: "waypoint", beat: 1, index: 0, done: true }));
  assert.ok("error" in applyBeatEdit(arc, { op: "waypoint", beat: 2, index: 7, done: true }));
  assert.ok("error" in applyBeatEdit(arc, { op: "waypoint", beat: 3, index: 0, done: true }));
});

console.log(`test-waypoints: ${passed} tests passed`);
