// A self-contained, local-only production-browser check. No live credentials/data.
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { randomBytes, scryptSync } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'odm-combat-hud-'));
const socket = createServer();
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const env = { ...process.env, NODE_ENV: 'production', SQLITE_DB_PATH: path.join(dir, 'test.sqlite'), DB_ENCRYPTION_KEY: randomBytes(32).toString('hex'), COOKIE_SECURE: '0',
  ODM_MEDIA_ROOT: path.join(dir, 'media'), ODM_LOCAL_ORIGIN: origin, ODM_PUBLIC_URL: origin, NEXT_TELEMETRY_DISABLED: '1', VOICE_ENABLED: '0' };
for (const key of Object.keys(env)) if (/API_KEY|ACCESS_TOKEN|REFRESH_TOKEN|ODM_.*TOKEN/.test(key)) delete env[key];
Object.assign(process.env, env);
register('../lib/register-alias.mjs', import.meta.url);
const { createUser } = await import('../../src/lib/db/users.ts');
const { createCampaign, joinByInviteCode, setHumanDm, setFloor, setCampaignStatus } = await import('../../src/lib/db/campaigns.ts');
const { createSheet, patchSheet } = await import('../../src/lib/db/sheets.ts');
const { createSheetSchema } = await import('../../src/lib/schemas/sheet.ts');
const { createEncounter, insertEnemy, saveEncounter } = await import('../../src/lib/db/encounters.ts');
const password = randomBytes(16).toString('hex'), salt = randomBytes(16).toString('hex');
const hash = `${salt}$${scryptSync(password, salt, 64).toString('hex')}`;
const user = createUser('combat_hud', hash), observer = createUser('combat_observer', hash), dm = createUser('combat_dm', 'unloginable');
const campaign = createCampaign(user.id, { title: 'Local HUD check', description: '', theme: '', maxPlayers: 3, startingLevel: 3, difficulty: 'normal',
  gameSettings: { dmMode: 'human', mapsEnabled: false, ttsEnabled: false } });
for (const member of [dm, observer]) joinByInviteCode(member.id, campaign.inviteCode);
assert.equal(setHumanDm(campaign.id, dm.id), true);
const heroInput = { race: 'human', class: 'fighter', abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 12, cha: 10 }, maxHp: 24, ac: 16,
  hitDice: { die: 'd10', total: 3, spent: 0 }, proficiencies: { saves: [], skills: [], languages: [], tools: [], armor: [], weapons: ['martial'] }, equipment: [{ name: 'Longsword', qty: 1, equipped: true }] };
const sheet = createSheet(campaign.id, user.id, 3, createSheetSchema.parse({ ...heroInput, name: 'Hero' }));
const other = createSheet(campaign.id, observer.id, 3, createSheetSchema.parse({ ...heroInput, name: 'Observer' }));
for (const [hero, name] of [[sheet, 'Fedya'], [other, 'Buddy']]) patchSheet(hero.id, { resources: { second_wind: { max: 1, used: 0 } },
  pets: [{ name, kind: 'drake', form: 'Drake', hp: 12, maxHp: 12, ac: 13, speed: 30, notes: '', attacks: [{ name: 'Bite', toHit: 4, damage: '1d6+2', type: 'piercing' }] }] });
const encounter = createEncounter(campaign.id, 'HUD');
const enemy = insertEnemy({ encounterId: encounter.id, campaignId: campaign.id, slug: 'dummy', displayName: 'Dummy', initiative: 1,
  stats: { maxHp: 100, ac: 12, cr: 0, xp: 0, dexMod: 0, speed: '0', attacks: [], traits: [], resist: '', immune: '', vulnerable: '', conditionImmune: '' } });
encounter.orderReady = true;
encounter.order = [sheet, other].map((hero, index) => ({ kind: 'pc', characterId: hero.id, userId: hero.userId, name: hero.name, initiative: 20 - index * 10 }));
encounter.order.push({ kind: 'enemy', enemyId: enemy.id, name: enemy.displayName, initiative: 1 });
saveEncounter(encounter);
setCampaignStatus(campaign.id, 'active');
setFloor(campaign.id, { mode: 'initiative', encounterId: encounter.id, round: encounter.round, userIds: [user.id], currentName: sheet.name });
let logs = '';
const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
app.stdout.on('data', chunk => { logs += chunk; }); app.stderr.on('data', chunk => { logs += chunk; });
try {
  let healthy = false;
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline && app.exitCode === null) {
    try { healthy = (await fetch(`${origin}/api/ready`, { signal: AbortSignal.timeout(10000) })).ok; } catch {}
    if (healthy) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.ok(healthy, logs);
  const result = spawnSync(process.execPath, ['scripts/e2e/combat-hud.e2e.mjs'], { cwd: root, env: { ...env, ODM_E2E_BASE_URL: origin,
    ODM_E2E_CAMPAIGN_ID: campaign.id, ODM_E2E_USERNAME: user.username, ODM_E2E_PASSWORD: password, ODM_E2E_PET_NAME: 'Fedya', ODM_E2E_OTHER_USERNAME: observer.username }, stdio: 'inherit', timeout: 240000 });
  assert.equal(result.status, 0, logs.slice(-3000));
} finally {
  app.kill('SIGTERM');
}
