import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const script = path.resolve('deploy/watch-player.sh');

function runWatcher(result) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odm-watch-test-'));
  try {
    const token = path.join(dir, 'token');
    const curl = path.join(dir, 'curl');
    fs.writeFileSync(token, 'test-token\n');
    fs.writeFileSync(curl, '#!/bin/sh\nprintf "%s" "$WATCH_FIXTURE"\n');
    fs.chmodSync(curl, 0o755);
    return spawnSync('bash', [script, '0', 'campaign'], {
      encoding: 'utf8', timeout: 2500,
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`,
        WATCH_TOKEN_FILE: token, WATCH_CONTROL_URL: 'http://test.invalid',
        WATCH_TIMEOUT: '1', WATCH_INTERVAL: '0.01', WATCH_FIXTURE: JSON.stringify(result) },
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('watcher ignores director and global-turn events', () => {
  const result = runWatcher({ ok: true, result: {
    currentSeq: 40, messages: [], asks: [], pendingRolls: [],
    events: [{ seq: 40, type: 'director_armed' }, { seq: 41, type: 'global_turn_resolved' }],
  } });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /TIMEOUT_NO_MESSAGES/);
});

test('watcher wakes for an IC player message but not OOC', () => {
  const result = runWatcher({ ok: true, result: {
    currentSeq: 42, asks: [], pendingRolls: [], events: [], messages: [
      { seq: 41, authorType: 'player', kind: 'ooc', content: '(ooc) pause' },
      { seq: 42, authorType: 'player', kind: 'do', content: '*Рывок к затвору*' },
    ],
  } });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /\[42\] player: \*Рывок к затвору\*/);
  assert.doesNotMatch(result.stdout, /pause/);
});

test('watcher wakes for an unresolved pending roll', () => {
  const result = runWatcher({ ok: true, result: {
    currentSeq: 50, messages: [], asks: [],
    events: [{ seq: 50, type: 'pending_roll' }],
    pendingRolls: [{ id: 'roll-1', characterId: 'hero', kind: 'skill_check', reason: 'затвор' }],
  } });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /PENDING_ROLL \[roll-1\]/);
});

test('watcher wakes for an autopilot_action_requested event', () => {
  const result = runWatcher({ ok: true, result: {
    currentSeq: 55, messages: [], asks: [], pendingRolls: [],
    events: [{ seq: 55, type: 'autopilot_action_requested' }],
  } });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /autopilot_action_requested/);
});

test('watcher wakes when an active round has an eligible autopilot member who has not acted', () => {
  const result = runWatcher({ ok: true, result: {
    currentSeq: 60, messages: [], asks: [], pendingRolls: [], events: [],
    members: [{ userId: 'u1', autopilot: true }],
    sheets: [{ id: 'c1', userId: 'u1' }],
    campaign: {
      gameSettings: { globalTurn: { enabled: true } },
      globalTurnState: { phase: 'active', roundNumber: 2, actionsByCharacter: {} },
    },
  } });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /AUTOPILOT_ACTION_NEEDED \[c1\] round=2/);
});
