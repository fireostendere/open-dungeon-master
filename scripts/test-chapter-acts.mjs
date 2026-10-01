// Acts at the table (upstream issue #31): chapters carry the act they belong
// to, arc edits announce act endings and beginnings, and the story export
// groups chapters under act headings with the recap the table heard.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-chapter-acts-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");

register("./lib/register-alias.mjs", import.meta.url);

const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, getCampaignById, setStoryArc, allocateSeq } = await import("../src/lib/db/campaigns.ts");
const { closeChapterRow, ensureOpenChapter, getChapter, getOpenChapter, listChapters, setChapterAct } = await import(
  "../src/lib/db/chapters.ts"
);
const { insertCampaignMessage, listAllMessages } = await import("../src/lib/db/messages.ts");
const { normalizeStoryArc, recordActRecap } = await import("../src/lib/dm/arc-logic.ts");
const { commitStoryArc, handleCompleteBeat } = await import("../src/lib/dm/arc.ts");
const { subscribeRaw } = await import("../src/lib/events-core.ts");
const { buildStoryDocument } = await import("../src/lib/export/legacy-story-document.ts");
const { renderStoryHtml } = await import("../src/lib/export/html.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const dm = createUser("dm", "x");
function newCampaign(title) {
  return createCampaign(dm.id, { title, description: "", theme: "", maxPlayers: 4, startingLevel: 1, difficulty: "normal" });
}
const campaign = newCampaign("The Sunken Crown");

function say(campaignId, content) {
  const seq = allocateSeq(campaignId);
  insertCampaignMessage({ campaignId, seq, authorType: "dm", content });
  return seq;
}

const saga = (sketches) => ({ title: "The Sunken Crown", plannedActs: 2, sketches, finaleBoss: null, sagaIndex: 1, priorSagas: [] });

try {
  test("a chapter closes with the act it was in, and the next opens unstamped", () => {
    ensureOpenChapter(campaign.id);
    say(campaign.id, "The marsh stretches before you.");
    const seqEnd = say(campaign.id, "The ferryman waits.");
    const result = closeChapterRow(ensureOpenChapter(campaign.id).id, {
      title: "The Ferryman",
      summary: "You crossed the marsh.",
      highlights: ["You crossed the marsh."],
      seqEnd,
      act: 1,
      saga: 1,
    });
    assert.equal(result.closed.act, 1);
    assert.equal(result.closed.saga, 1);
    assert.equal(result.opened.act, null);
  });

  test("the open chapter is stamped once the arc says which act it is in", () => {
    const open = ensureOpenChapter(campaign.id);
    const stamped = setChapterAct(open.id, 2, 1);
    assert.equal(stamped.act, 2);
    assert.equal(getChapter(open.id).saga, 1);
  });

  test("chapters closed before acts were tracked read back as null", () => {
    say(campaign.id, "A second chapter.");
    const seqEnd = say(campaign.id, "It ends.");
    const result = closeChapterRow(ensureOpenChapter(campaign.id).id, { title: "Old Ways", summary: "", highlights: [], seqEnd });
    assert.equal(result.closed.act, null);
    assert.equal(result.closed.saga, null);
  });

  test("the story export heads each act once, with the recap the table heard", () => {
    // Two more chapters in act 2: one heading for the pair.
    say(campaign.id, "Beneath the reliquary.");
    let seqEnd = say(campaign.id, "The tomb opens.");
    closeChapterRow(ensureOpenChapter(campaign.id).id, { title: "The Tomb", summary: "You found the tomb.", highlights: [], seqEnd, act: 2, saga: 1 });
    say(campaign.id, "Deeper still.");
    seqEnd = say(campaign.id, "The heart beats.");
    closeChapterRow(ensureOpenChapter(campaign.id).id, { title: "The Heart", summary: "You heard it beat.", highlights: [], seqEnd, act: 2, saga: 1 });
    const arc = recordActRecap(
      normalizeStoryArc({
        premise: "The heart wakes.",
        beats: [
          { text: "a", status: "done", act: 1 },
          { text: "b", status: "active", act: 2 },
        ],
        saga: saga([
          { act: 1, milestone: "Reach the drowned city.", status: "detailed", title: "The Drowned Road" },
          { act: 2, milestone: "Find the tomb.", status: "detailed", title: "Beneath the Reliquary" },
        ]),
      }),
      { act: 1, sagaIndex: 1, title: "The Drowned Road", recap: "You crossed the marsh and paid the ferryman." },
    );
    setStoryArc(campaign.id, arc);
    const doc = buildStoryDocument(campaign.id);
    // The word follows the table's language (Russian by default).
    assert.deepEqual(
      doc.chapters.map((chapter) => chapter.actHeading ?? ""),
      ["Акт I: The Drowned Road", "", "Акт II: Beneath the Reliquary", "", ""],
    );
    assert.equal(doc.chapters[0].actRecap, "You crossed the marsh and paid the ferryman.");
    assert.equal(doc.chapters[2].actRecap, undefined);
    const html = renderStoryHtml(doc);
    assert.ok(html.includes("Акт I: The Drowned Road"));
    assert.ok(html.includes("paid the ferryman"));
    // The DM's milestones never reach the document.
    assert.ok(!html.includes("drowned city"));
    assert.ok(!html.includes("Find the tomb"));
  });

  // ---- announcements, through the same calls the narrator makes ----
  const table = newCampaign("The Hollow Throne");
  const cards = [];
  const stop = subscribeRaw(table.id, (chunk) => {
    if (chunk.includes("event: act_card")) cards.push(JSON.parse(chunk.split("data: ")[1]));
  });
  const systemNotes = () => listAllMessages(table.id).filter((message) => message.authorType === "system").map((message) => message.content);
  setStoryArc(
    table.id,
    normalizeStoryArc({
      premise: "The throne is empty.",
      beats: [
        { text: "Reach the capital.", status: "done", act: 1 },
        { text: "Find the regent.", status: "active", act: 1 },
      ],
      saga: saga([
        { act: 1, milestone: "Get to court.", status: "detailed", title: "Ash and Salt" },
        { act: 2, milestone: "Unmask the regent.", status: "sketch", title: "The Glass Court" },
      ]),
    }),
  );
  ensureOpenChapter(table.id);

  test("a beat that finishes its act ends the act with the author's recap, once", () => {
    const outcome = handleCompleteBeat(
      table.id,
      JSON.stringify({ actTitle: "Пепел и соль", actRecap: "Вы добрались до столицы и нашли регента." }),
      false,
    );
    assert.equal(outcome.completed, true);
    assert.deepEqual(cards.map((card) => [card.kind, card.act, card.title]), [["end", 1, "Пепел и соль"]]);
    assert.deepEqual(systemNotes(), ["Акт I «Пепел и соль» подходит к концу. Вы добрались до столицы и нашли регента."]);
    const arc = getCampaignById(table.id).storyArc;
    assert.deepEqual(arc.actRecaps, [{ act: 1, sagaIndex: 1, title: "Пепел и соль", recap: "Вы добрались до столицы и нашли регента." }]);
    assert.equal(getOpenChapter(table.id).act, 1);
  });

  test("an author's next act begins the act, keeps the recap it left out, and restamps the open chapter", () => {
    const stored = getCampaignById(table.id).storyArc;
    const { actRecaps: _dropped, ...rest } = stored;
    commitStoryArc(
      table.id,
      normalizeStoryArc({
        ...rest,
        beats: [...stored.beats, { text: "Unmask the regent.", status: "pending", act: 2 }, { text: "Take the throne.", status: "pending", act: 2 }],
      }),
    );
    assert.deepEqual(cards.map((card) => [card.kind, card.act]), [["end", 1], ["begin", 2]]);
    assert.equal(systemNotes().at(-1), "Начинается акт II «The Glass Court».");
    const arc = getCampaignById(table.id).storyArc;
    assert.equal(arc.actRecaps.length, 1);
    assert.equal(getOpenChapter(table.id).act, 2);
  });

  test("an edit that moves nothing announces nothing", () => {
    commitStoryArc(table.id, getCampaignById(table.id).storyArc);
    assert.equal(cards.length, 2);
  });
  stop();
} finally {
  removeTempDir(dir);
}

console.log(`test-chapter-acts: ${passed} tests passed`);
