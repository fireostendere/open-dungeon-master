// Real party projections, campaign close, baseline guards and notifications;
// only HTTP authentication is replaced. No live server or model calls.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";
import { loadReviewModule, namedImports } from "./lib/review-module.mjs";

const directory = mkdtempSync(path.join(os.tmpdir(), "odm-dm-seats-"));
const cwd = process.cwd();
const repo = path.resolve(import.meta.dirname, "..");
process.env.SQLITE_DB_PATH = path.join(directory, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.chdir(directory);
register("./lib/register-alias.mjs", import.meta.url);
const campaigns = await import("../src/lib/db/campaigns.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { createCharacter, getCharacter, instantiateIntoCampaign } = await import("../src/lib/db/characters.ts");
const { getSheetById } = await import("../src/lib/db/sheets.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { closeCampaignNow } = await import("../src/lib/dm/campaign-ending.ts");
const { createEncounter, listActiveEncounters } = await import("../src/lib/db/encounters.ts");
const { listNotifications, notifyUsers } = await import("../src/lib/db/notifications.ts");
const { withCommittedEffects } = await import("../src/lib/db/commit-effects.ts");
const { subscribeUser } = await import("../src/lib/user-events.ts");
const { publishPersisted } = await import("../src/lib/events.ts");
const db = getDatabase();
const nativeFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error("Unexpected network request"); };

try {
  const dm = createUser("seat-dm", "hash"), assistant = createUser("seat-assistant", "hash");
  const players = [createUser("seat-player-one", "hash"), createUser("seat-player-two", "hash")];
  const campaign = campaigns.createCampaign(dm.id, {
    title: "Party seats", description: "", theme: "", maxPlayers: 2, startingLevel: 1, difficulty: "normal",
    gameSettings: { dmMode: "human", ttsEnabled: false, mapsEnabled: false },
  });
  assert.ok(campaigns.joinByInviteCode(assistant.id, campaign.inviteCode).campaign);
  assert.ok(campaigns.setAssistantDm(campaign.id, assistant.id));
  for (const player of players) assert.ok(campaigns.joinByInviteCode(player.id, campaign.inviteCode).campaign);
  assert.equal(campaigns.listMembers(campaign.id).length, 4, "DM seats retain authenticated table membership");
  assert.equal(campaigns.getCampaignById(campaign.id).playerCount, 2, "DM and assistant consume no player slots");
  assert.equal(campaigns.getCampaignForUser(campaign.id, dm.id).playerCount, 2);
  assert.equal(campaigns.listCampaignsForUser(players[0].id)[0].playerCount, 2);
  assert.equal(campaigns.countPartySlots(campaign.id), 2);
  const lobby = loadReviewModule(path.join(repo, "src/app/campaigns/[campaignId]/LobbyParty.tsx"), {
    "@/lib/i18n": { useI18n: () => ({ locale: "ru" }) },
    "@/lib/ui": { ui: {}, UserAvatar: "avatar" },
    "@/components/ui/GameIcon": { GameIcon: "icon" },
    "@/components/ui/Tooltip": { Tooltip: "tooltip" },
    "@/lib/help": { localizedRaceName: name => name },
  });
  const text = node => node == null || typeof node === "boolean" ? ""
    : Array.isArray(node) ? node.map(text).join(" ")
    : typeof node === "object" ? text(node.props?.children) : String(node);
  const party = lobby.LobbyParty({ campaign: campaigns.getCampaignById(campaign.id),
    members: campaigns.listMembers(campaign.id), partySize: 2, sheets: [], humanDmTable: true, showParty: true });
  assert.match(text(party), /Отряд · 2\/2/);
  assert.match(text(party), /Мастер/);
  assert.match(text(party), /пом\. Мастера/);
  const extra = createUser("seat-extra", "hash");
  assert.ok(campaigns.joinByInviteCode(extra.id, campaign.inviteCode).error, "a full player roster still rejects another player");
  db.prepare("UPDATE campaigns SET human_dm_user_id = NULL WHERE id = ?").run(campaign.id);
  assert.equal(campaigns.getCampaignById(campaign.id).playerCount, 2, "legacy owner-as-DM fallback matches viewer roles");
  campaigns.setHumanDm(campaign.id, dm.id);
  campaigns.setCampaignStatus(campaign.id, "active");

  // The actual campaign PATCH must accept a cap equal to PLAYERS, not all seats.
  const filename = path.join(repo, "src/app/api/campaigns/[campaignId]/route.ts");
  const mocks = {};
  for (const { from, name } of namedImports(filename)) {
    (mocks[from] ??= {})[name] = () => { throw new Error(`Unexpected route dependency: ${name}`); };
  }
  mocks.zod = await import("zod");
  mocks["@/lib/campaign-types"] = await import("../src/lib/campaign-types.ts");
  mocks["@/lib/dm/viewer"] = await import("../src/lib/dm/viewer.ts");
  mocks["@/lib/db/campaigns"] = campaigns;
  mocks["@/lib/events"] = { publishPersisted };
  mocks["@/lib/dm/campaign-ending"] = { closeCampaignNow };
  mocks["@/lib/campaign-api"] = {
    requireMember: async () => ({ campaign: campaigns.getCampaignById(campaign.id), user: dm }),
    isErrorResponse: () => false, isLead: () => true,
  };
  const { PATCH } = loadReviewModule(filename, mocks);
  const patch = body => PATCH(new Request("http://table.test/campaign", { method: "PATCH", body: JSON.stringify(body) }),
    { params: Promise.resolve({ campaignId: campaign.id }) });
  assert.equal((await patch({ maxPlayers: 2 })).status, 200);
  assert.equal((await patch({ maxPlayers: 1 })).status, 400, "the cap cannot exclude a real player");

  const input = createSheetSchema.parse({
    name: "Hero", race: "human", class: "fighter", maxHp: 12, ac: 12,
    abilities: { str: 12, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
    hitDice: { die: "d10", total: 1, spent: 0 },
    proficiencies: { saves: [], skills: [], languages: [], tools: [], armor: [], weapons: [] },
  });
  const libraries = [dm, ...players].map(user => createCharacter(user.id, 1, input));
  const sheets = libraries.map(library => instantiateIntoCampaign(library.id, campaign.id, library.userId, 1));
  for (const sheet of sheets) assert.ok(!("error" in sheet));
  for (const sheet of sheets) db.prepare("UPDATE character_sheets SET xp = 250 WHERE id = ?").run(sheet.id);
  db.prepare("UPDATE library_characters SET xp = 900 WHERE id = ?").run(libraries[2].id);
  createEncounter(campaign.id, "An unfinished fight");
  campaigns.setFloor(campaign.id, { mode: "hold", next: { mode: "open" } });
  const notices = [];
  const unsubscribe = subscribeUser(players[1].id, chunk => notices.push(chunk));
  assert.throws(() => withCommittedEffects(() => db.transaction(() => {
    notifyUsers([players[1].id], { campaignId: campaign.id, kind: "test", body: "Uncommitted notice" });
    assert.equal(notices.length, 0, "private pings wait for the outer commit");
    throw new Error("rollback notice");
  })()), /rollback notice/);
  assert.equal(listNotifications(players[1].id).length, 0);
  assert.equal(notices.length, 0, "a rolled-back close cannot leak a notice");
  // A real storage failure still rolls back closure and all successful syncs.
  db.exec("CREATE TRIGGER fail_campaign_close BEFORE UPDATE OF status ON campaigns WHEN NEW.status = 'ended' BEGIN SELECT RAISE(ABORT, 'injected storage failure'); END");
  await assert.rejects(() => closeCampaignNow(campaign.id, { outcome: "victory", endedBy: "owner" }), /injected storage failure/);
  db.exec("DROP TRIGGER fail_campaign_close");
  assert.equal(campaigns.getCampaignById(campaign.id).status, "active");
  assert.equal(getCharacter(libraries[1].id).xp, 0);
  assert.equal(listActiveEncounters(campaign.id).length, 1);
  assert.equal(notices.length, 0);
  db.exec(`CREATE TRIGGER fail_library_sync BEFORE UPDATE ON library_characters WHEN OLD.id = '${libraries[1].id}' BEGIN SELECT RAISE(ABORT, 'injected sync failure'); END`);
  await assert.rejects(() => closeCampaignNow(campaign.id, { outcome: "victory", endedBy: "owner" }), /injected sync failure/);
  db.exec("DROP TRIGGER fail_library_sync");
  assert.equal(campaigns.getCampaignById(campaign.id).status, "active");
  assert.equal(getCharacter(libraries[1].id).xp, 0);
  assert.equal(listActiveEncounters(campaign.id).length, 1);
  assert.equal(notices.length, 0, "unexpected sync errors roll back instead of being treated as version conflicts");

  const response = await patch({ status: "ended", outcome: "victory", maxPlayers: 2 });
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.equal(campaigns.getCampaignById(campaign.id).status, "ended", "a progress conflict cannot block closing the campaign");
  assert.equal(getCharacter(libraries[0].id).xp, 0, "a legacy DM sheet is never synced as a player");
  assert.equal(getCharacter(libraries[1].id).xp, 250, "valid player progression is synced");
  assert.equal(getCharacter(libraries[2].id).xp, 900, "the newer library version is never overwritten");
  assert.equal(getSheetById(sheets[2].id).xp, 250, "the conflicting campaign copy remains available to reconcile");
  assert.equal(listActiveEncounters(campaign.id).length, 0);
  assert.equal(campaigns.getFloor(campaign.id).mode, "open");
  assert.equal(listNotifications(players[0].id).length, 0);
  assert.equal(listNotifications(players[1].id).length, 1, "the affected player receives a private durable notice");
  assert.equal(listNotifications(dm.id).length, 1, "the owner can see that progress needs reconciliation");
  assert.equal(notices.length, 1);
  const noticesBeforeReplay = listNotifications(players[1].id).length;
  await closeCampaignNow(campaign.id, { outcome: "victory", endedBy: "owner" });
  assert.equal(listNotifications(players[1].id).length, noticesBeforeReplay, "a repeated close does not repeat sync or warnings");
  unsubscribe();
  console.log("PASS DM-free party counts, cap validation and campaign closure with safe deferred progress sync");
} finally {
  globalThis.fetch = nativeFetch;
  process.chdir(cwd);
  removeTempDir(directory);
}
