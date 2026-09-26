// npm run build && node scripts/e2e/combat-caster.e2e.mjs
// Real local app and isolated SQLite; no live campaign writes or model calls.
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { randomBytes, scryptSync } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPlaywright } from './location-privacy.e2e.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const dir = mkdtempSync('/tmp/opencode/combat-caster-');
const socket = createServer();
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, NODE_ENV: 'production', SQLITE_DB_PATH: `${dir}/test.sqlite`,
  DB_ENCRYPTION_KEY: randomBytes(32).toString('hex'), COOKIE_SECURE: '0', ODM_MEDIA_ROOT: `${dir}/media`,
  ODM_LOCAL_ORIGIN: base, ODM_PUBLIC_URL: base, NEXT_TELEMETRY_DISABLED: '1', VOICE_ENABLED: '0',
  COMFYUI_URL: '', FLUX_WORKER_URL: '', OLLAMA_BASE_URL: '' };
for (const key of Object.keys(env)) if (/API_KEY|ACCESS_TOKEN|REFRESH_TOKEN/.test(key)) delete env[key];
Object.assign(process.env, env);
register(new URL('../lib/register-alias.mjs', import.meta.url), import.meta.url);
const load = file => import(new URL(`../../src/lib/${file}.ts`, import.meta.url));
const { createUser } = await load('db/users');
const { createCampaign, joinByInviteCode, setHumanDm, setFloor, setCampaignStatus } = await load('db/campaigns');
const { createSheet, patchSheet, getSheetById } = await load('db/sheets');
const { createSheetSchema } = await load('schemas/sheet');
const { createEncounter, insertEnemy, saveEncounter } = await load('db/encounters');
const password = randomBytes(24).toString('hex');
const salt = randomBytes(16).toString('hex');
const hash = `${salt}$${scryptSync(password, salt, 64).toString('hex')}`;
const user = createUser('caster_check', hash);
const bot = createUser('caster_dm', 'unloginable');
const observer = createUser('caster_observer', hash);
const campaign = createCampaign(user.id, { title: 'Isolated caster regression', description: '', theme: '', maxPlayers: 3,
  startingLevel: 3, difficulty: 'normal', gameSettings: { dmMode: 'human', mapsEnabled: false, ttsEnabled: false } });
joinByInviteCode(bot.id, campaign.inviteCode);
joinByInviteCode(observer.id, campaign.inviteCode);
assert.equal(setHumanDm(campaign.id, bot.id), true);
const spells = ['Eldritch Blast', 'Minor Illusion', 'Hex', 'Hellish Rebuke', 'Suggestion', 'Scorching Ray'];
const sheet = createSheet(campaign.id, user.id, 3, createSheetSchema.parse({ name: 'Асмодей Чёртополох', race: 'human', class: 'warlock',
  abilities: { str: 8, dex: 12, con: 14, int: 14, wis: 10, cha: 16 }, maxHp: 24, ac: 12,
  proficiencies: { saves: ['wis', 'cha'], skills: [], languages: [], tools: [], armor: ['light'], weapons: ['simple'] },
  hitDice: { die: 'd8', total: 3, spent: 1 }, equipment: [{ name: 'Кинжал', qty: 1, equipped: true }],
  spellcasting: { ability: 'cha', slots: { 2: { max: 2, used: 2 } }, known: spells, prepared: spells } }));
patchSheet(sheet.id, { currentHp: 5, resources: {}, features: [{ name: 'Pact Boon: Pact of the Chain', source: 'choice' }],
  pets: [{ name: 'Федя', kind: 'familiar', form: 'Quasit', hp: 7, maxHp: 7, ac: 13, speed: 40, notes: '',
    attacks: [{ name: 'Когти', toHit: 4, damage: '1d4+3', type: 'slashing' }] }] });
const encounter = createEncounter(campaign.id, 'Caster HUD');
const enemy = insertEnemy({ encounterId: encounter.id, campaignId: campaign.id, slug: 'dummy', displayName: 'Дьявол', initiative: 1,
  stats: { maxHp: 100, ac: 12, cr: 0, xp: 0, dexMod: 0, speed: '0', attacks: [], traits: [], resist: '', immune: '', vulnerable: '', conditionImmune: '' } });
encounter.orderReady = true;
encounter.order = [{ kind: 'pc', characterId: sheet.id, userId: user.id, name: sheet.name, initiative: 20 },
  { kind: 'enemy', enemyId: enemy.id, name: enemy.displayName, initiative: 1 }];
saveEncounter(encounter);
setCampaignStatus(campaign.id, 'active');
setFloor(campaign.id, { mode: 'initiative', encounterId: encounter.id, round: encounter.round, userIds: [user.id], currentName: sheet.name });

let logs = '';
const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
app.stdout.on('data', chunk => { logs += chunk; });
app.stderr.on('data', chunk => { logs += chunk; });
let browser;
try {
  let healthy = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { healthy = (await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) })).ok; } catch {}
    if (healthy) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.ok(healthy, logs);
  const playwright = await loadPlaywright();
  browser = await (playwright.default ?? playwright).chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  await context.addCookies([{ name: 'odm_locale', value: 'ru', url: base }]);
  assert.equal((await context.request.post(`${base}/api/auth/login`, { data: { username: user.username, password } })).status(), 200);
  const endpoint = `${base}/api/campaigns/${campaign.id}/actions`;
  const options = await (await context.request.get(endpoint)).json();
  assert.equal(options.spells.length, 6);
  assert.equal(options.spells.find(spell => spell.name === 'Eldritch Blast').level, 0);
  const other = await browser.newContext();
  assert.equal((await other.request.get(endpoint)).status(), 401);
  assert.equal((await other.request.post(`${base}/api/auth/login`, { data: { username: observer.username, password } })).status(), 200);
  assert.deepEqual((await (await other.request.get(endpoint)).json()).spells, []);
  await other.close();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/campaigns/${campaign.id}`);
  const tour = page.getByRole('button', { name: 'Завершить тур', exact: true });
  if (await tour.waitFor({ timeout: 5000 }).then(() => true, () => false)) await tour.click();
  await page.getByRole('button', { name: 'Вкладка «Бой» ↗', exact: true }).click();
  const hud = page.getByRole('region', { name: 'Ваш боевой ход', exact: true });
  const pets = page.getByRole('region', { name: 'Питомцы в бою', exact: true });
  const picker = hud.getByRole('combobox', { name: 'Заклинание', exact: true });
  await picker.waitFor();
  await picker.selectOption('Hex');
  assert.equal(await hud.getByText('Нет свободных подходящих ячеек. Заговоры доступны без ячеек.', { exact: true }).isVisible(), true);
  assert.equal(await hud.getByRole('button', { name: 'Добавить заклинание', exact: true }).isDisabled(), true);
  await picker.selectOption('Eldritch Blast');
  await hud.getByRole('combobox', { name: 'Цель заклинания', exact: true }).selectOption(enemy.id);
  assert.equal(await hud.getByRole('button', { name: 'Добавить заклинание', exact: true }).isEnabled(), true);
  await hud.getByRole('combobox', { name: 'Способность', exact: true }).selectOption('feature:Pact Boon: Pact of the Chain');
  assert.equal(await hud.getByText(/Заявка мастеру: применимость/).isVisible(), true);
  assert.equal(await hud.getByText(/В инвентаре нет распознанных расходников/).isVisible(), true);
  // The actual Chain familiar costs the owner's attack, not the drake bonus
  // action that the previous fixture tested instead of this user's character.
  await pets.getByRole('combobox', { name: 'Цель питомца: Федя', exact: true }).selectOption(enemy.id);
  await pets.getByRole('button', { name: 'Приказать Федя: Когти', exact: true }).click();
  assert.equal(await hud.getByRole('button', { name: 'Добавить заклинание', exact: true }).isDisabled(), true);
  await hud.getByRole('button', { name: 'Убрать действие 1', exact: true }).click();
  await pets.getByRole('textbox', { name: 'Прямой приказ: Федя', exact: true }).fill('Стань невидимым и разведай проход');
  await pets.getByRole('button', { name: 'Добавить приказ: Федя', exact: true }).click();
  await hud.getByRole('button', { name: 'Добавить заклинание', exact: true }).click();
  assert.equal(await hud.getByText('Действие: использовано', { exact: true }).isVisible(), true);
  // OOC must not submit or discard the queued combat intent.
  await page.getByRole('button', { name: 'Вне игры', exact: true }).click();
  const composer = page.locator('[data-tour="composer-input"] textarea');
  await composer.fill('Проверка интерфейса, вне игры');
  const oocResponse = page.waitForResponse(result => result.url() === endpoint && result.request().method() === 'POST');
  await composer.press('Control+Enter');
  const ooc = await oocResponse;
  assert.equal(ooc.status(), 202);
  assert.equal(ooc.request().postDataJSON().kind, 'ooc');
  assert.equal(await hud.getByRole('button', { name: 'Убрать действие 2', exact: true }).isVisible(), true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-tour="tab-battle"]').filter({ visible: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: `${dir}/mobile.png`, fullPage: true });
  // Explicit HUD submit is a Do even while the chat composer is still OOC.
  const resultPromise = page.waitForResponse(result => result.url() === endpoint && result.request().method() === 'POST');
  await hud.getByRole('button', { name: 'Отправить действие', exact: true }).click();
  const result = await resultPromise;
  assert.equal(result.status(), 202, await result.text());
  assert.equal(result.request().postDataJSON().kind, 'do');
  assert.deepEqual(result.request().postDataJSON().combatTurn.choices.map(choice => choice.type), ['pet_order', 'spell']);
  assert.equal(getSheetById(sheet.id).spellcasting.slots[2].used, 2, 'submitting a draft does not execute mechanics');
  assert.deepEqual(errors, []);
  console.log(`PASS caster HUD: real warlock/familiar, six spells, exhausted slots, cantrip target, features, pet attack/order, OOC, mobile, server submission. Evidence: ${dir}`);
} finally {
  await browser?.close();
  app.kill('SIGTERM');
}
