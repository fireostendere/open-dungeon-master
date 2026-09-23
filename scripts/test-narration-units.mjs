import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { loadSource } from './lib/readiness-harness.mjs';
import { publicProjection } from '../narrator/orchestration.mjs';

const { normalizeNarrationUnits } = loadSource('src/lib/units/narration.ts');

test('metric DM prose converts explicit feet, pounds, ranges, dimensions and size adjectives', () => {
  assert.equal(normalizeNarrationUnits('A 10-20 ft hall, 5 x 10 ft gate, 30-foot wall, 2.5 lbs and 3 фунта.'),
    'A 3-6 m hall, 1.5 x 3 m gate, 9-meter wall, 1.13 kg and 1.35 kg.');
  assert.equal(normalizeNarrationUnits('В 30-футовый коридор ведёт мост в 10 фт.'), 'В 9-метровый коридор ведёт мост в 3 m.');
  assert.equal(normalizeNarrationUnits('10 x 20 x 30 ft'), '3 x 6 x 9 m');
  assert.equal(normalizeNarrationUnits('30-футовая башня с 10-футовой дверью.'), '9-метровая башня с 3-метровой дверью.');
  assert.equal(normalizeNarrationUnits('1,000 feet; 1,5 фута.'), '300 m; 0.45 m.');
  assert.equal(normalizeNarrationUnits('item30ft and 30-football teams'), 'item30ft and 30-football teams');
  assert.equal(normalizeNarrationUnits('1 000 футов; 1/2 foot; 1 1/2 pounds.'), '300 m; 0.15 m; 0.68 kg.');
  assert.equal(normalizeNarrationUnits('1/0 ft is invalid'), '1/0 ft is invalid');
});

test('imperial campaigns and protected/player-like literals remain unchanged', () => {
  const prose = 'The foot hurts; see https://example.test/30ft and `30 ft`; 10 ft.';
  assert.equal(normalizeNarrationUnits(prose, 'imperial'), prose);
  assert.equal(normalizeNarrationUnits(prose), 'The foot hurts; see https://example.test/30ft and `30 ft`; 3 m.');
});

test('public DM inserts and variants are normalized while player text and imperial DM text are retained', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE campaigns (id TEXT PRIMARY KEY, game_settings_json TEXT NOT NULL);
    CREATE TABLE campaign_messages (id TEXT PRIMARY KEY, campaign_id TEXT, seq INTEGER, author_type TEXT, user_id TEXT, character_id TEXT, content TEXT, image_request_json TEXT, generated_image_json TEXT, location_id TEXT, variants_json TEXT, variant_index INTEGER, dm_turn_id TEXT, created_at TEXT);
    INSERT INTO campaigns VALUES ('metric', '{"unitSystem":"metric"}'), ('imperial', '{"unitSystem":"imperial"}');`);
  const messages = loadSource('src/lib/db/messages.ts', {
    '@/lib/db/core': { getDatabase: () => db, nowIso: () => 'now', parseJson: (value, fallback) => { try { return JSON.parse(value); } catch { return fallback; } } },
    '@/lib/db/campaigns': { touchCampaign() {} }, '@/lib/types': {},
    '@/lib/units/narration': { normalizeNarrationUnits },
  });
  const dm = messages.insertCampaignMessage({ campaignId: 'metric', seq: 1, authorType: 'dm', content: 'The door is 10 ft away.' });
  const player = messages.insertCampaignMessage({ campaignId: 'metric', seq: 2, authorType: 'player', content: 'I move 10 ft.' });
  const imperial = messages.insertCampaignMessage({ campaignId: 'imperial', seq: 1, authorType: 'dm', content: 'The door is 10 ft away.' });
  assert.equal(dm.content, 'The door is 3 m away.');
  assert.equal(player.content, 'I move 10 ft.');
  assert.equal(imperial.content, 'The door is 10 ft away.');
  assert.equal(messages.updateMessageContent(dm.id, 'A 20 ft bridge.').content, 'A 6 m bridge.');
  assert.equal(messages.updateMessageContent(player.id, 'I move 20 ft.').content, 'I move 20 ft.');
  assert.equal(messages.updateMessageContent(imperial.id, 'A 20 ft bridge.').content, 'A 20 ft bridge.');
  assert.deepEqual(messages.setMessageVariants(dm.id, ['A 5 ft gap.', 'A 10 lb lock.'], 1).variants, ['A 1.5 m gap.', 'A 4.5 kg lock.']);
  db.close();
});

test('spatial narration is normalized only after the raw idempotency fingerprint', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys = ON; CREATE TABLE campaigns (id TEXT PRIMARY KEY); CREATE TABLE users (id TEXT PRIMARY KEY);
    INSERT INTO campaigns VALUES ('c'); INSERT INTO users VALUES ('dm'), ('player');`);
  const { createSpatialStore } = await import('../src/lib/spatial/store.mjs');
  let seq = 0, id = 0;
  const driver = { exec: sql => db.exec(sql), prepare: sql => db.prepare(sql), transaction: work => (...args) => work(...args) };
  const store = createSpatialStore(driver, { nextSeq: () => ++seq, uuid: () => `room-${++id}`, now: () => 'now' });
  const actor = { campaignId: 'c', userId: 'dm', isDm: true, memberIds: ['dm', 'player'], playerIds: ['player'] };
  const room = store.command(actor, 'enable', 'enable', { name: 'Room' }).roomId;
  const raw = { roomId: room, kind: 'narration', content: 'The ledge is 10 ft away.' };
  const normalize = input => ({ ...input, content: normalizeNarrationUnits(input.content) });
  const first = store.command(actor, 'narrate', 'send', raw, normalize);
  const retry = store.command(actor, 'narrate', 'send', raw, normalize);
  assert.equal(first.message.content, 'The ledge is 3 m away.');
  assert.deepEqual(retry, first);
  assert.throws(() => store.command(actor, 'narrate', 'send', { ...raw, content: 'Different 20 ft text' }, normalize), /different arguments/);
  db.close();
});

test('external narrator projection carries persisted units and JRPG constraints', () => {
  const projection = publicProjection({ campaign: { gameSettings: { unitSystem: 'metric', combatMode: 'jrpg' } } });
  assert.deepEqual({ unitSystem: projection.unitSystem, combatMode: projection.combatMode }, { unitSystem: 'metric', combatMode: 'jrpg' });
  assert.equal(publicProjection({ campaign: { gameSettings: { unitSystem: 'imperial' } } }).unitSystem, 'imperial');
});
