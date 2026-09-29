import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);
const dir = fs.mkdtempSync("/tmp/opencode/odm-images-test-");
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = "target-images-test";
process.env.ODM_SQLITE_DRIVER = "node";
process.chdir(dir);

const { getDatabase } = await import("../src/lib/db/core.ts");
const { createUser, setUserAvatar } = await import("../src/lib/db/users.ts");
const { createCharacter, getCharacter, instantiateIntoCampaign } = await import("../src/lib/db/characters.ts");
const { createCampaign, getCampaignById } = await import("../src/lib/db/campaigns.ts");
const { getSheetById } = await import("../src/lib/db/sheets.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { executeMcpExtendedControl } = await import("../src/lib/mcp-external-control.ts");
const { executeMcpControl } = await import("../src/lib/mcp-control.ts");
const { authorizeMcpAction } = await import("../src/lib/mcp-access.mjs");
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const input = createSheetSchema.parse({
  name: "Fixture", race: "human", class: "fighter", maxHp: 10, ac: 12,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  hitDice: { die: "d10", total: 1, spent: 0 },
  proficiencies: { saves: [], skills: [], languages: [], tools: [], armor: [], weapons: [] },
});
const owner = createUser("owner", "x");
const admin = createUser("admin", "x", { isAdmin: true });
const character = createCharacter(owner.id, 1, input);
const target = { type: "library_character", id: character.id };
const fileExists = (url) => fs.existsSync(path.join(dir, "public", url));
async function images(operation, params = {}) {
  const response = await executeMcpExtendedControl(`images.${operation}`, { target, ...params });
  assert.equal(response.handled, true, `images.${operation} must be handled`);
  return response.result;
}

try {
  const first = await images("set", { dataBase64: png, mimeType: "image/png", name: "face.png", expectedUrl: null });
  assert.ok(first.image.url.startsWith("/uploads/"));
  assert.equal(getCharacter(character.id).sheet.portrait.url, first.image.url);
  const read = await images("get", { includeData: true });
  assert.equal(read.dataBase64, png);
  assert.equal(read.width, 1);
  assert.equal(read.sha256.length, 64);
  assert.equal((await images("get")).dataBase64, undefined);

  const fileCount = () => fs.readdirSync(path.join(dir, "public", "uploads")).length;
  const beforeRejected = fileCount();
  await assert.rejects(images("set", { dataBase64: "not base64!", mimeType: "image/png" }), /base64/i);
  await assert.rejects(images("set", { dataBase64: png, mimeType: "image/jpeg" }), /MIME/i);
  await assert.rejects(images("set", { dataBase64: Buffer.from("not an image").toString("base64"), mimeType: "image/png" }), /Unsupported/);
  await assert.rejects(images("set", { dataBase64: png, mimeType: "image/png", expectedUrl: null }), /changed|conflict/i);
  await assert.rejects(images("set", { target: { type: "library_character", id: crypto.randomUUID() }, dataBase64: png, mimeType: "image/png" }), /not found/i);
  await assert.rejects(images("get", { target: { type: "file", id: "../../etc/passwd" } }), /Invalid|expected/i);
  await assert.rejects(images("set", { dataBase64: Buffer.alloc(8 * 1024 * 1024 + 1).toString("base64"), mimeType: "image/png" }), /large|8MB|limit/i);
  assert.equal(getCharacter(character.id).sheet.portrait.url, first.image.url);
  assert.equal(fileCount(), beforeRejected, "rejected operations must not leave uploads behind");

  // A reference in a different kind of record must protect the shared bytes.
  setUserAvatar(admin.id, { url: first.image.url });
  const replacement = await images("set", { dataBase64: png, mimeType: "image/png", expectedUrl: first.image.url });
  assert.equal(fileExists(first.image.url), true);
  await assert.rejects(images("delete", { confirm: true, expectedUrl: first.image.url }), /changed|conflict/i);
  const removed = await images("delete", { confirm: true, expectedUrl: replacement.image.url });
  assert.equal(removed.image, null);
  assert.equal(fileExists(replacement.image.url), false);
  assert.equal(fileExists(first.image.url), true);
  await assert.rejects(images("delete", { confirm: false }), /true/i);
  assert.equal((await images("delete", { confirm: true })).image, null);

  // Library portraits mirror into linked campaign sheets, including clear.
  const campaign = createCampaign(admin.id, { title: "Images", description: "", theme: "", maxPlayers: 5, startingLevel: 1, difficulty: "normal" });
  const sheet = instantiateIntoCampaign(character.id, campaign.id, owner.id, 1);
  const mirrored = await images("set", { dataBase64: png, mimeType: "image/png" });
  assert.equal(getSheetById(sheet.id).portrait.url, mirrored.image.url);
  assert.ok(getDatabase().prepare("SELECT 1 FROM campaign_events WHERE campaign_id = ? AND type = 'sheet_updated'").get(campaign.id));
  const live = await images("set", { target: { type: "sheet", id: sheet.id }, dataBase64: png, mimeType: "image/png" });
  assert.equal(getCharacter(character.id).sheet.portrait.url, mirrored.image.url);
  assert.equal(getSheetById(sheet.id).portrait.url, live.image.url);
  await images("delete", { confirm: true });
  assert.equal(getSheetById(sheet.id).portrait, null);
  assert.equal(fileExists(mirrored.image.url), true, "replayable events retain their referenced files");

  const cover = await images("set", { target: { type: "campaign", id: campaign.id }, dataBase64: png, mimeType: "image/png" });
  assert.equal(getCampaignById(campaign.id).cover.url, cover.image.url);
  await images("delete", { target: { type: "campaign", id: campaign.id }, confirm: true });
  assert.equal(getCampaignById(campaign.id).cover, null);

  const db = getDatabase();
  const npcId = crypto.randomUUID();
  db.prepare("INSERT INTO npcs (id, campaign_id, name, created_at, updated_at) VALUES (?, ?, 'Face', ?, ?)").run(npcId, campaign.id, new Date().toISOString(), new Date().toISOString());
  const npc = await images("set", { target: { type: "npc", id: npcId }, dataBase64: png, mimeType: "image/png" });
  assert.equal(db.prepare("SELECT portrait_url FROM npcs WHERE id = ?").get(npcId).portrait_url, npc.image.url);
  await images("delete", { target: { type: "npc", id: npcId }, confirm: true });
  assert.equal(db.prepare("SELECT portrait_url FROM npcs WHERE id = ?").get(npcId).portrait_url, "");

  for (const action of ["images.get", "images.set", "images.delete", "characters.transfer"]) {
    assert.throws(() => authorizeMcpAction({ role: "narrator", campaignId: campaign.id }, action, { campaignId: campaign.id }), /not available/);
  }
  console.log("PASS targeted image lifecycle, validation, shared references and mirroring");

  const movable = createCharacter(owner.id, 1, { ...input, portrait: first.image });
  const transfer = { characterId: movable.id, owner: { userId: admin.id }, expectedOwnerUserId: owner.id, confirm: true };
  await assert.rejects(executeMcpControl("characters.transfer", { ...transfer, confirm: false }), /true/i);
  await assert.rejects(executeMcpControl("characters.transfer", { ...transfer, expectedOwnerUserId: admin.id }), /changed|conflict/i);
  const moved = await executeMcpControl("characters.transfer", transfer);
  assert.equal(moved.character.userId, admin.id);
  assert.equal(moved.character.id, movable.id);
  assert.deepEqual(moved.character.sheet, movable.sheet);
  // Exact retries do not recreate the character.
  assert.equal((await executeMcpControl("characters.transfer", transfer)).character.id, movable.id);
  await assert.rejects(executeMcpControl("characters.transfer", { characterId: character.id, owner: { userId: admin.id }, expectedOwnerUserId: owner.id, confirm: true }), /campaign/i);
  assert.equal(getCharacter(character.id).userId, owner.id);
  const { purgeAccount } = await import("../src/lib/account-deletion.ts");
  const extraOwner = createUser("library-only", "x");
  const extraCharacter = createCharacter(extraOwner.id, 1, input);
  const extraImage = await images("set", { target: { type: "library_character", id: extraCharacter.id }, dataBase64: png, mimeType: "image/png" });
  purgeAccount(extraOwner.id);
  assert.equal(fileExists(extraImage.image.url), false, "account cleanup reads the library's actual sheet.portrait");
  console.log("PASS original ownership transfer preserves ID/sheet and rejects connected characters");
} finally {
  globalThis.__localRoleplayDb?.close();
  globalThis.__localRoleplayDb = undefined;
  fs.rmSync(dir, { recursive: true, force: true });
}
