import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSource, sqliteFixture } from './lib/readiness-harness.mjs';

function fixture() {
  const f = sqliteFixture();
  f.db.exec(`CREATE TABLE dm_turns (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL);
    INSERT INTO dm_turns VALUES ('turn1', 'c1'), ('turn2', 'c2');
    CREATE TABLE dm_whispers (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, user_id TEXT NOT NULL,
      character_id TEXT, direction TEXT NOT NULL, content TEXT NOT NULL, answered_turn_id TEXT, group_id TEXT);`);
  const recipients = [{ userId: 'alice', characterId: 'pc1', characterName: 'Alice' }];
  // Only the pre-existing insert mapper and campaign lookup are substituted.
  // Reply authorization/transaction code, notifications and SQLite are real.
  const whispers = { insertWhisper: (campaignId, _turnId, recipients, message) => {
    const groupId = crypto.randomUUID();
    for (const recipient of recipients) f.db.prepare(`INSERT INTO dm_whispers (id, campaign_id, user_id, character_id, direction, content, group_id)
      VALUES (?, ?, ?, ?, 'to_player', ?, ?)`).run(crypto.randomUUID(), campaignId, recipient.userId, recipient.characterId, message, groupId);
    return groupId;
  } };
  const replies = loadSource('src/lib/db/whisper-replies.ts', {
    '@/lib/db/core': f.core, '@/lib/db/campaigns': { getCampaignById: () => ({ dmUserId: 'dm' }) },
    '@/lib/db/commit-effects': f.effects, '@/lib/db/dm-whispers': whispers, '@/lib/events': f.events,
  });
  const incoming = (id, campaignId = 'c1', userId = 'alice', characterId = 'pc1') => f.db.prepare(`INSERT INTO dm_whispers
    (id, campaign_id, user_id, character_id, direction, content) VALUES (?, ?, ?, ?, 'to_dm', 'private question')`).run(id, campaignId, userId, characterId);
  const pending = () => f.db.prepare("SELECT id FROM dm_whispers WHERE campaign_id = 'c1' AND direction = 'to_dm' AND answered_turn_id IS NULL ORDER BY id").all().map((row) => row.id);
  return { ...f, ...replies, recipients, incoming, pending,
    reply: (ids) => replies.deliverWhisperReply('c1', 'turn1', recipients, 'Private answer', ids) };
}

test('M04: three sequential private questions/answers never exhaust pending cap; only participants are notified', () => {
  const f = fixture(); const heard = { alice: [], bob: [], dm: [] };
  const off = Object.entries(heard).map(([userId, chunks]) => f.events.subscribe('c1', (chunk) => chunks.push(chunk), userId));
  for (const chunks of Object.values(heard)) chunks.length = 0;
  for (let i = 1; i <= 3; i++) { f.incoming(`w${i}`); f.reply([`w${i}`]); assert.deepEqual(f.pending(), []); }
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM dm_whispers WHERE direction = 'to_player'").get().n, 3);
  assert.equal(heard.alice.length, 3); assert.equal(heard.dm.length, 3); assert.deepEqual(heard.bob, []);
  assert.equal(heard.alice.join('').includes('Private answer'), false);
  for (const stop of off) stop(); f.close();
});

test('M04: a later incoming message stays pending after a reply to the earlier ID', () => {
  const f = fixture(); f.incoming('old'); f.incoming('new'); f.reply(['old']);
  assert.deepEqual(f.pending(), ['new']); f.close();
});

test('M04: foreign campaign, foreign author, already answered IDs and outsider recipients are rejected atomically', () => {
  const f = fixture(); f.incoming('foreign', 'c2'); f.incoming('bob-message', 'c1', 'bob', 'pc2'); f.incoming('alice-message');
  assert.throws(() => f.reply(['foreign']), /pending messages/);
  assert.throws(() => f.reply(['bob-message']), /pending messages/);
  assert.throws(() => f.deliverWhisperReply('c1', 'turn2', f.recipients, 'no', ['alice-message']), /another campaign/);
  assert.throws(() => f.deliverWhisperReply('c1', 'turn1', [...f.recipients, { userId: 'bob', characterId: 'pc2' }], 'no', ['alice-message']), /add recipients/);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM dm_whispers WHERE direction = 'to_player'").get().n, 0);
  f.reply(['alice-message']);
  assert.throws(() => f.reply(['alice-message']), /pending messages/);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM dm_whispers WHERE direction = 'to_player'").get().n, 1); f.close();
});

test('M04: acknowledgement failure rolls back outgoing rows and emits no notifications', () => {
  const f = fixture(); f.incoming('w1'); const heard = [];
  const off = f.events.subscribe('c1', (chunk) => heard.push(chunk), 'alice'); heard.length = 0;
  f.db.exec("CREATE TRIGGER reject_ack BEFORE UPDATE ON dm_whispers BEGIN SELECT RAISE(ABORT, 'ack failed'); END");
  assert.throws(() => f.reply(['w1']), /ack failed/);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM dm_whispers WHERE direction = 'to_player'").get().n, 0);
  assert.deepEqual(f.pending(), ['w1']); assert.deepEqual(heard, []);
  off(); f.close();
});
