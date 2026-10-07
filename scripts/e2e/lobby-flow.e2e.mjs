// Real local lobby: hand off the DM seat, pick/switch a library hero before
// starting, and keep the preparation panels out of the first screen.
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { randomBytes, scryptSync } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadPlaywright } from './location-privacy.e2e.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'odm-lobby-test-'));
const socket = createServer();
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const base = `http://127.0.0.1:${port}`;
const production = process.argv.includes('--production');
const env = { ...process.env, NODE_ENV: production ? 'production' : 'development', SQLITE_DB_PATH: path.join(dir, 'test.sqlite'),
  DB_ENCRYPTION_KEY: randomBytes(32).toString('hex'), COOKIE_SECURE: '0', ODM_MEDIA_ROOT: path.join(dir, 'media'),
  ODM_LOCAL_ORIGIN: base, ODM_PUBLIC_URL: base, NEXT_TELEMETRY_DISABLED: '1', VOICE_ENABLED: '0' };
for (const key of Object.keys(env)) if (/API_KEY|ACCESS_TOKEN|REFRESH_TOKEN|ODM_.*TOKEN/.test(key)) delete env[key];
Object.assign(process.env, env);
register('../lib/register-alias.mjs', import.meta.url);
const { createUser } = await import('../../src/lib/db/users.ts');
const { createCampaign, joinByInviteCode, setMemberReady } = await import('../../src/lib/db/campaigns.ts');
const { createCharacter } = await import('../../src/lib/db/characters.ts');
const { createSheetSchema } = await import('../../src/lib/schemas/sheet.ts');
const password = randomBytes(16).toString('hex'), salt = randomBytes(16).toString('hex');
const owner = createUser('lobby_owner', `${salt}$${scryptSync(password, salt, 64).toString('hex')}`);
const dm = createUser('lobby_dm', 'unloginable');
const campaign = createCampaign(owner.id, { title: 'Local lobby regression', description: 'Find the missing courier. '.repeat(100),
  theme: 'Dark fantasy', maxPlayers: 6, startingLevel: 3, difficulty: 'hard',
  gameSettings: { dmMode: 'human', mapsEnabled: false, ttsEnabled: false } });
joinByInviteCode(dm.id, campaign.inviteCode);
setMemberReady(campaign.id, owner.id, true);
const heroInput = createSheetSchema.parse({ name: 'First hero', race: 'human', class: 'fighter', maxHp: 28, ac: 18, acOverride: false,
  abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 12, cha: 10 }, hitDice: { die: 'd10', total: 3, spent: 0 },
  proficiencies: { saves: ['str', 'con'], skills: ['athletics'], languages: ['Common'], tools: [], armor: ['heavy', 'shields'], weapons: ['martial'] },
  equipment: [{name:'Chain Mail', qty:1, equipped:true}, {name:'Shield', qty:1, equipped:true}] });
createCharacter(owner.id, 3, heroInput);
createCharacter(owner.id, 3, { ...heroInput, name: 'Second hero' });

let logs = '';
const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', production ? 'start' : 'dev', ...(production ? [] : ['--webpack']), '-H', '127.0.0.1', '-p', String(port)],
  { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
app.stdout.on('data', chunk => { logs += chunk; });
app.stderr.on('data', chunk => { logs += chunk; });
let browser;
try {
  const deadline = Date.now() + 120000;
  let healthy = false;
  while (Date.now() < deadline && app.exitCode === null) {
    try { healthy = (await fetch(`${base}/api/ready`, {signal:AbortSignal.timeout(10000)})).ok; } catch {}
    if (healthy) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.ok(healthy, logs.slice(-4000));
  const playwright = await loadPlaywright();
  browser = await (playwright.default ?? playwright).chromium.launch({headless:true,channel:'chrome'});
  const context = await browser.newContext({viewport:{width:1280,height:900}});
  await context.addCookies([{name:'odm_locale',value:'ru',url:base}]);
  assert.equal((await context.request.post(`${base}/api/auth/login`, {data:{username:owner.username,password}})).status(), 200);
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(120000);
  page.setDefaultTimeout(60000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/campaigns/${campaign.id}`);
  const handoff = page.getByRole('button', {name:'Передать роль и выбрать персонажа',exact:true});
  await handoff.waitFor();
  assert.ok((await handoff.boundingBox()).y < 900, 'DM handoff is on the first screen');
  await page.getByRole('combobox', {name:'Кто будет Мастером?',exact:true}).selectOption(dm.id);
  await handoff.click();
  await page.getByRole('heading', {name:'Выбрать персонажа',exact:true}).waitFor();
  let snapshot = await context.request.get(`${base}/api/campaigns/${campaign.id}`).then(r=>r.json());
  assert.equal(snapshot.members.find(m=>m.userId===owner.id).ready, false, 'handing over the DM seat clears readiness');
  await page.getByRole('button', {name:/First hero/}).click();
  await page.getByRole('link', {name:'Сменить',exact:true}).waitFor();
  snapshot = await context.request.get(`${base}/api/campaigns/${campaign.id}`).then(r=>r.json());
  assert.equal(snapshot.campaign.status, 'lobby', 'choosing a character never starts play');
  assert.equal(snapshot.campaign.dmUserId, dm.id);
  assert.equal(snapshot.sheets.find(s=>s.userId===owner.id).name, 'First hero');
  assert.equal(snapshot.sheets.find(s=>s.userId===owner.id).level, 3);
  for (const viewport of [{width:1280,height:900},{width:390,height:844}]) {
    await page.setViewportSize(viewport);
    await page.evaluate(()=>window.scrollTo(0,0));
    const change = await page.getByRole('link', {name:'Сменить',exact:true}).boundingBox();
    assert.ok(change.y + change.height <= viewport.height, 'character controls fit on the first screen');
    const settings = page.locator('details').filter({has:page.locator('summary').filter({hasText:'Настройки игры и правила'})});
    assert.equal(await settings.evaluate(element=>element.open), false, 'settings start collapsed');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth), 'no mobile horizontal overflow');
    await page.screenshot({path:path.join(dir,`lobby-${viewport.width}.png`),fullPage:true});
  }
  const settings = page.locator('details').filter({has:page.locator('summary').filter({hasText:'Настройки игры и правила'})});
  await settings.locator('summary').first().click();
  assert.equal(await settings.evaluate(element=>element.open), true, 'settings remain accessible');
  await settings.locator('summary').first().click();
  await page.getByRole('button', {name:'Готов',exact:true}).click();
  await page.getByRole('button', {name:'Не готов',exact:true}).waitFor();
  await page.getByRole('link', {name:'Сменить',exact:true}).click();
  await page.getByRole('button', {name:/Second hero/}).click();
  await page.getByRole('link', {name:'Сменить',exact:true}).waitFor();
  snapshot = await context.request.get(`${base}/api/campaigns/${campaign.id}`).then(r=>r.json());
  assert.equal(snapshot.campaign.status, 'lobby');
  assert.equal(snapshot.sheets.filter(s=>s.userId===owner.id).length, 1);
  assert.equal(snapshot.sheets.find(s=>s.userId===owner.id).name, 'Second hero');
  assert.equal(snapshot.members.find(m=>m.userId===owner.id).ready, false);
  const aiCampaign = createCampaign(owner.id, { title: 'AI lobby regression', description: '', theme: '', maxPlayers: 1,
    startingLevel: 3, difficulty: 'normal', gameSettings: {dmMode:'ai',mapsEnabled:false,ttsEnabled:false} });
  await page.goto(`${base}/campaigns/${aiCampaign.id}`);
  await page.getByRole('link', {name:'Выбрать из библиотеки',exact:true}).click();
  await page.getByRole('button', {name:/First hero/}).click();
  await page.getByRole('link', {name:'Сменить',exact:true}).waitFor();
  snapshot = await context.request.get(`${base}/api/campaigns/${aiCampaign.id}`).then(r=>r.json());
  assert.equal(snapshot.campaign.status, 'lobby');
  assert.equal(snapshot.sheets.find(s=>s.userId===owner.id).name, 'First hero', 'AI table owner is a player even with a stored DM user ID');
  assert.deepEqual(errors, []);
  console.log(`PASS: lobby seat handoff, pre-start library choice/replacement, compact desktop/mobile layout. Screenshots: ${dir}`);
} catch (error) {
  console.error(logs.slice(-4000));
  throw error;
} finally {
  await browser?.close();
  app.kill('SIGTERM');
}
