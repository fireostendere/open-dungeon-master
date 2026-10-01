// Waypoints against a real campaign (upstream issue #31): the narrator's
// tool calls tick the [NOW] beat's steps through the one dispatch every
// adjudication takes, and complete_beat is refused until the place, person,
// item and fight steps are done.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-waypoint-tick-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");

register("./lib/register-alias.mjs", import.meta.url);

const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, getCampaignById, setStoryArc } = await import("../src/lib/db/campaigns.ts");
const { normalizeStoryArc } = await import("../src/lib/dm/arc-logic.ts");
const { tickWaypointsFromCall } = await import("../src/lib/dm/waypoint-tick.ts");
const { createEncounter, insertEnemy } = await import("../src/lib/db/encounters.ts");
const { dispatchSynchronousAdjudication } = await import("../src/lib/dm/invoke-dispatch.ts");
const { handleCompleteBeat } = await import("../src/lib/dm/arc.ts");
const { activeBeat, openWaypoints } = await import("../src/lib/dm/waypoint-logic.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const dm = createUser("dm", "x");
const campaign = createCampaign(dm.id, {
  title: "Затонувшая корона",
  description: "",
  theme: "",
  maxPlayers: 4,
  startingLevel: 1,
  difficulty: "normal",
});

setStoryArc(
  campaign.id,
  normalizeStoryArc({
    premise: "Сердце просыпается под затонувшим собором.",
    beats: [
      { text: "Покинуть Халворд.", status: "done", act: 1 },
      {
        text: "Пересечь стеклянную равнину до собора.",
        status: "active",
        act: 1,
        waypoints: [
          { kind: "npc", text: "Поговорить с Бриской Хейл о безопасной тропе" },
          { kind: "place", text: "Добраться до Затонувшего собора Ваэля" },
          { kind: "fight", text: "Победить солевых стражей" },
          { kind: "narrative", text: "Увидеть окаменевших паломников" },
        ],
      },
      { text: "Встретиться с викарием.", status: "pending", act: 1 },
    ],
  }),
);

const open = () => openWaypoints(activeBeat(getCampaignById(campaign.id).storyArc).beat).map((w) => w.text);
const context = () => ({
  campaign: getCampaignById(campaign.id),
  turn: { id: "test-turn", campaignId: campaign.id, rollIds: [] },
  sheets: [],
  sheetsById: new Map(),
  realDiceUserIds: new Set(),
});

try {
  test("complete_beat is refused while the checklist is open, naming the steps that gate it", () => {
    const outcome = handleCompleteBeat(campaign.id, "{}", false);
    assert.equal(outcome.completed, false);
    assert.match(String(outcome.result.error), /open waypoints: Поговорить с Бриской Хейл/);
    // The narrative step is listed in the arc, but it is the narrator's call.
    assert.equal(outcome.result.openWaypoints.length, 3);
  });

  test("the narrator's move_party ticks the place step and says so in its result", () => {
    const result = dispatchSynchronousAdjudication("move_party", JSON.stringify({ name: "Затонувший собор Ваэля", layoutDescription: "Залитый неф." }), context());
    assert.equal(result.ok, true);
    assert.deepEqual(result.waypointsTicked, ["Добраться до Затонувшего собора Ваэля"]);
    assert.deepEqual(open(), ["Поговорить с Бриской Хейл о безопасной тропе", "Победить солевых стражей", "Увидеть окаменевших паломников"]);
  });

  test("a refused call ticks nothing, and neither does a tool of the wrong kind", () => {
    assert.ok("error" in dispatchSynchronousAdjudication("move_party", "{}", context()));
    assert.deepEqual(tickWaypointsFromCall(campaign.id, "grant_item", JSON.stringify({ name: "Бриска Хейл" }), {}), []);
    assert.equal(open().length, 3);
  });

  test("an NPC tool ticks its step by name", () => {
    assert.deepEqual(tickWaypointsFromCall(campaign.id, "set_npc", JSON.stringify({ name: "Бриска Хейл", attitude: "friendly" }), { ok: true }), [
      "Поговорить с Бриской Хейл о безопасной тропе",
    ]);
  });

  test("a won fight ticks the step naming its foes, wherever the encounter ends", () => {
    const encounter = createEncounter(campaign.id, "Засада у собора");
    const stats = { maxHp: 5, ac: 12, cr: 0, xp: 0, dexMod: 0, speed: "30", attacks: [], traits: [], resist: "", immune: "", vulnerable: "", conditionImmune: "" };
    for (const name of ["Солевой страж", "Солевой страж 2"]) {
      insertEnemy({ encounterId: encounter.id, campaignId: campaign.id, slug: "guard", displayName: name, initiative: 1, stats });
    }
    const result = dispatchSynchronousAdjudication("end_encounter", JSON.stringify({ outcome: "victory" }), context());
    assert.equal(result.encounterOver, true);
    assert.deepEqual(result.waypointsTicked, ["Победить солевых стражей"]);
    assert.deepEqual(open(), ["Увидеть окаменевших паломников"]);
  });

  test("with the gating steps clear the beat completes", () => {
    const outcome = handleCompleteBeat(campaign.id, "{}", false);
    assert.equal(outcome.completed, true);
    assert.equal(getCampaignById(campaign.id).storyArc.beats[1].status, "done");
    // The next beat has no checklist and gates nothing.
    assert.equal(handleCompleteBeat(campaign.id, "{}", false).completed, true);
  });
} finally {
  removeTempDir(dir);
}

console.log(`test-waypoint-tick: ${passed} tests passed`);
