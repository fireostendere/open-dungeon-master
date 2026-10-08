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
const { instantiateIntoCampaign } = await import('../../src/lib/db/characters.ts');
const password = randomBytes(16).toString('hex'), salt = randomBytes(16).toString('hex');
const passwordHash = `${salt}$${scryptSync(password, salt, 64).toString('hex')}`;
const owner = createUser('lobby_owner', passwordHash);
const dm = createUser('lobby_dm', passwordHash);
const player = createUser('lobby_player', passwordHash);
const lead = createUser('lobby_lead', passwordHash);
const campaign = createCampaign(owner.id, { title: 'Local lobby regression', description: 'Find the missing courier. '.repeat(100),
  theme: 'Dark fantasy', maxPlayers: 6, startingLevel: 3, difficulty: 'hard',
  gameSettings: { dmMode: 'human', mapsEnabled: false, ttsEnabled: false } });
joinByInviteCode(dm.id, campaign.inviteCode);
joinByInviteCode(player.id, campaign.inviteCode);
joinByInviteCode(lead.id, campaign.inviteCode);
setMemberReady(campaign.id, owner.id, true);
const heroInput = createSheetSchema.parse({ name: 'First hero', race: 'human', class: 'fighter', maxHp: 28, ac: 18, acOverride: false,
  abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 12, cha: 10 }, hitDice: { die: 'd10', total: 3, spent: 0 },
  proficiencies: { saves: ['str', 'con'], skills: ['athletics'], languages: ['Common'], tools: [], armor: ['heavy', 'shields'], weapons: ['martial'] },
  equipment: [{name:'Chain Mail', qty:1, equipped:true}, {name:'Shield', qty:1, equipped:true}] });
createCharacter(owner.id, 3, heroInput);
createCharacter(owner.id, 3, { ...heroInput, name: 'Second hero' });
const playerHero = createCharacter(player.id, 3, { ...heroInput, name: 'Guest hero' });
const playerSheet = instantiateIntoCampaign(playerHero.id, campaign.id, player.id, 3);
assert.ok(!('error' in playerSheet));

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
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
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
  assert.equal(await page.getByRole('button', {name:/^(Готов|Не готов)$/}).count(), 0, 'DM seat has no readiness toggle');
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
  const playerContext = await browser.newContext();
  assert.equal((await playerContext.request.post(`${base}/api/auth/login`, {data:{username:player.username,password}})).status(), 200);
  const dmContext = await browser.newContext();
  assert.equal((await dmContext.request.post(`${base}/api/auth/login`, {data:{username:dm.username,password}})).status(), 200);
  const kickUrl = `${base}/api/campaigns/${campaign.id}/members/${player.id}`;
  assert.equal((await playerContext.request.delete(`${base}/api/campaigns/${campaign.id}/members/${lead.id}`)).status(), 403, 'players cannot kick other players');
  assert.equal((await dmContext.request.delete(kickUrl)).status(), 403, 'DM powers do not grant player admission control');
  for (const target of [owner.id, dm.id]) {
    assert.equal((await context.request.delete(`${base}/api/campaigns/${campaign.id}/members/${target}`)).status(), 403, 'owner and DM seats are protected');
  }
  const ownerRow = page.locator('li').filter({has:page.getByText(owner.username, {exact:true})});
  assert.equal(await ownerRow.locator('summary').count(), 0, 'no empty management menu for the owner/lead with a character');
  const playerRow = page.locator('li').filter({has:page.getByText(player.username, {exact:true})});
  const dmRow = page.locator('li').filter({has:page.getByText(dm.username, {exact:true})});
  assert.equal(await dmRow.getByText('не готов', {exact:true}).count(), 0, 'DM readiness does not appear in the roster');
  assert.equal((await context.request.patch(`${base}/api/campaigns/${campaign.id}`, {data:{status:'active',ignoreReadiness:true}})).status(), 400, 'readiness override does not bypass missing characters');
  const management = playerRow.locator('summary').filter({hasText:/^Управление$/});
  const invite = page.locator('section').filter({has:page.getByText('Код комнаты', {exact:true})});
  await page.locator('summary').filter({hasText:'Пригласить игроков'}).click();
  const expectedInvite = `${base}/join/${campaign.inviteCode}`;
  await invite.getByText(expectedInvite, {exact:true}).waitFor();
  await invite.getByRole('button', {name:'Ссылка',exact:true}).click();
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()), expectedInvite, 'copy shares the displayed invite URL');
  await invite.getByRole('button', {name:'Поделиться',exact:true}).click();
  const share = page.getByRole('dialog', {name:'Пригласить игроков'});
  await share.getByRole('button', {name:'Копировать ссылку',exact:true}).click();
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()), expectedInvite, 'dialog shares the same invite URL');
  await page.keyboard.press('Escape');
  for (const viewport of [{width:1280,height:900},{width:390,height:844},{width:320,height:740}]) {
    await page.setViewportSize(viewport);
    await page.evaluate(()=>window.scrollTo(0,0));
    const change = await page.getByRole('link', {name:'Сменить',exact:true}).boundingBox();
    assert.ok(change.y + change.height <= viewport.height, 'character controls fit on the first screen');
    const settings = page.locator('details').filter({has:page.locator('summary').filter({hasText:'Настройки игры и правила'})});
    assert.equal(await settings.evaluate(element=>element.open), false, 'settings start collapsed');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth), 'no mobile horizontal overflow');
    const card = await invite.boundingBox();
    for (const button of await invite.getByRole('button').all()) {
      const box = await button.boundingBox();
      assert.ok(box.x >= card.x && box.x + box.width <= card.x + card.width + 1, 'invite buttons stay inside their card');
    }
    await management.click();
    await playerRow.getByRole('button', {name:'заглушить',exact:true}).waitFor({state:'visible'});
    await playerRow.getByRole('button', {name:'лидер',exact:true}).waitFor({state:'visible'});
    await playerRow.getByRole('button', {name:'Кикнуть игрока',exact:true}).waitFor({state:'visible'});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth), 'expanded management fits mobile');
    await management.click();
    await page.screenshot({path:path.join(dir,`lobby-${viewport.width}.png`),fullPage:true});
  }
  await management.click();
  await playerRow.getByRole('button', {name:'заглушить',exact:true}).click();
  await playerRow.getByRole('button', {name:'разрешить участие',exact:true}).waitFor({state:'visible'});
  snapshot = await context.request.get(`${base}/api/campaigns/${campaign.id}`).then(r=>r.json());
  assert.equal(snapshot.members.find(m=>m.userId===player.id).muted, true, 'management action reaches the server');
  await playerRow.getByRole('button', {name:'разрешить участие',exact:true}).click();
  await playerRow.getByRole('button', {name:'заглушить',exact:true}).waitFor({state:'visible'});
  await management.click();
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
  await management.click();
  page.once('dialog', dialog=>dialog.dismiss());
  await playerRow.getByRole('button', {name:'Кикнуть игрока',exact:true}).click();
  assert.equal((await playerContext.request.get(`${base}/api/campaigns/${campaign.id}`)).status(), 200, 'cancelled kick keeps access');
  page.once('dialog', dialog=>dialog.accept());
  await playerRow.getByRole('button', {name:'Кикнуть игрока',exact:true}).click();
  await playerRow.waitFor({state:'detached'});
  assert.equal((await playerContext.request.get(`${base}/api/campaigns/${campaign.id}`)).status(), 404, 'lobby kick revokes access');
  snapshot = await context.request.get(`${base}/api/campaigns/${campaign.id}`).then(r=>r.json());
  assert.equal(snapshot.sheets.find(s=>s.id===playerSheet.id).name, 'Guest hero', 'kick preserves campaign character progress');
  assert.equal((await playerContext.request.get(`${base}/api/characters/${playerHero.id}`)).status(), 200, 'library character is preserved');
  // A kick removes membership; the still-valid room invitation can admit them again.
  assert.equal((await playerContext.request.post(`${base}/api/campaigns/join`, {data:{inviteCode:campaign.inviteCode}})).status(), 200);
  const leadContext = await browser.newContext({viewport:{width:1280,height:900}});
  await leadContext.addCookies([{name:'odm_locale',value:'ru',url:base}]);
  assert.equal((await leadContext.request.post(`${base}/api/auth/login`, {data:{username:lead.username,password}})).status(), 200);
  assert.equal((await context.request.post(`${base}/api/campaigns/${campaign.id}/lead`, {data:{userId:lead.id}})).status(), 200);
  assert.equal((await leadContext.request.delete(`${base}/api/campaigns/${campaign.id}/members/${owner.id}`)).status(), 403);
  assert.equal((await leadContext.request.delete(`${base}/api/campaigns/${campaign.id}/members/${lead.id}`)).status(), 403);
  for (const member of [owner, player, lead]) {
    const memberContext = member.id === owner.id ? context : member.id === player.id ? playerContext : leadContext;
    if (member.id === lead.id) {
      const hero = createCharacter(lead.id, 3, { ...heroInput, name:'Lead hero' });
      assert.equal((await memberContext.request.post(`${base}/api/campaigns/${campaign.id}/sheet`, {data:{libraryCharacterId:hero.id}})).status(), 201);
    }
    if (member.id !== lead.id) assert.equal((await memberContext.request.post(`${base}/api/campaigns/${campaign.id}/ready`, {data:{ready:true}})).status(), 200);
  }
  assert.equal((await leadContext.request.patch(`${base}/api/campaigns/${campaign.id}`, {data:{status:'active',ignoreReadiness:true}})).status(), 403, 'override cannot grant start rights to a player/lead');
  assert.equal((await context.request.patch(`${base}/api/campaigns/${campaign.id}`, {data:{status:'active',ignoreReadiness:'yes'}})).status(), 400, 'override must be an explicit boolean');
  assert.equal((await context.request.patch(`${base}/api/campaigns/${campaign.id}`, {data:{status:'active'}})).status(), 400, 'ordinary start still checks player readiness');
  await page.reload();
  const start = page.getByRole('button', {name:'Начать кампанию',exact:true});
  await start.waitFor();
  assert.equal(await start.isEnabled(), true, 'unready players do not disable the confirmation path');
  let prompt = '';
  page.once('dialog', dialog=>{prompt=dialog.message();return dialog.dismiss();});
  await start.click();
  assert.ok(prompt.includes(lead.username), 'confirmation lists the unready player');
  assert.ok(!prompt.includes(dm.username), 'confirmation excludes DM readiness');
  snapshot = await context.request.get(`${base}/api/campaigns/${campaign.id}`).then(r=>r.json());
  assert.equal(snapshot.campaign.status, 'lobby', 'cancel keeps the campaign in its lobby');
  page.once('dialog', dialog=>dialog.accept());
  await start.click();
  await page.getByRole('heading', {name:campaign.title,exact:true}).first().waitFor();
  snapshot = await context.request.get(`${base}/api/campaigns/${campaign.id}`).then(r=>r.json());
  assert.equal(snapshot.campaign.status, 'active', 'confirmed start accepts an unready player and DM');
  assert.equal(snapshot.members.find(m=>m.userId===lead.id).ready, false, 'forced start does not fabricate readiness');
  const playerPage = await playerContext.newPage();
  await playerPage.goto(`${base}/campaigns/${campaign.id}`);
  await playerPage.getByRole('heading', {name:campaign.title,exact:true}).first().waitFor();
  const leadPage = await leadContext.newPage();
  await leadPage.goto(`${base}/campaigns/${campaign.id}`);
  await leadPage.locator('[data-guided-tour][role="dialog"]').waitFor();
  await leadPage.keyboard.press('Escape');
  await leadPage.locator('[data-tour="tab-lead"]').filter({visible:true}).click();
  const sessionPlayerRow = leadPage.locator('li').filter({has:leadPage.getByText(player.username, {exact:true})})
    .filter({has:leadPage.getByRole('button', {name:'Кикнуть игрока',exact:true})});
  leadPage.once('dialog', dialog=>dialog.accept());
  await sessionPlayerRow.getByRole('button', {name:'Кикнуть игрока',exact:true}).click();
  await sessionPlayerRow.waitFor({state:'detached'});
  await playerPage.getByText('Campaign not found.', {exact:true}).waitFor();
  for (const endpoint of ['', '/events', '/sheet']) {
    assert.equal((await playerContext.request.get(`${base}/api/campaigns/${campaign.id}${endpoint}`)).status(), 404, 'active kick revokes protected endpoints');
  }
  assert.equal((await leadContext.request.delete(kickUrl)).status(), 404, 'repeated kick is harmless');
  assert.deepEqual(errors, []);
  console.log(`PASS: lobby management, desktop/mobile layout, lobby/active kick permissions and access revocation. Screenshots: ${dir}`);
} catch (error) {
  console.error(logs.slice(-4000));
  throw error;
} finally {
  await browser?.close();
  app.kill('SIGTERM');
}
