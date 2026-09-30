// Disposable ODM table for driving a real narrator host without HTTP: the real Next
// route handlers and SQLite engine run in-process on a lab database.
//   node scripts/lab/odm-lab.mjs seed            create the campaign (once per LAB_DIR)
//   node scripts/lab/odm-lab.mjs do <hero> <text>   a player's declared action
//   node scripts/lab/odm-lab.mjs ask <hero> <text>  a private question to the DM
//   node scripts/lab/odm-lab.mjs log [afterSeq]     transcript as players see it
// odm-lab-mcp.mjs serves the same database to opencode as the odm_narrator MCP.
import { register } from 'node:module';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const LAB_DIR = path.resolve(process.env.LAB_DIR || '/mnt/c/Users/fireo/dnd-lab/state');
const envFile = path.join(LAB_DIR, 'env.json');
fs.mkdirSync(LAB_DIR, { recursive: true });
if (!fs.existsSync(envFile)) {
  fs.writeFileSync(envFile, JSON.stringify({ dbKey: randomBytes(32).toString('hex'), mcpToken: randomBytes(32).toString('hex') }), { mode: 0o600 });
}
export const lab = JSON.parse(fs.readFileSync(envFile, 'utf8'));
Object.assign(process.env, {
  SQLITE_DB_PATH: path.join(LAB_DIR, 'game.sqlite'), DB_ENCRYPTION_KEY: lab.dbKey, ODM_MCP_TOKEN: lab.mcpToken,
  ODM_MEDIA_ROOT: path.join(LAB_DIR, 'media'), COOKIE_SECURE: '0', VOICE_ENABLED: '0', NEXT_TELEMETRY_DISABLED: '1',
  COMFYUI_URL: '', FLUX_WORKER_URL: '', OLLAMA_BASE_URL: '',
});
register('../lib/register-alias.mjs', import.meta.url);
register('./lab-loader.mjs', import.meta.url);
const { labRequest } = await import('./next-headers-shim.mjs');

const routes = {
  mcp: '../../src/app/api/internal/mcp/route.ts',
  register: '../../src/app/api/auth/register/route.ts',
  token: '../../src/app/api/auth/token/route.ts',
  campaigns: '../../src/app/api/campaigns/route.ts',
  sheet: '../../src/app/api/campaigns/[campaignId]/sheet/route.ts',
  actions: '../../src/app/api/campaigns/[campaignId]/actions/route.ts',
  ask: '../../src/app/api/campaigns/[campaignId]/ask/route.ts',
  messages: '../../src/app/api/campaigns/[campaignId]/messages/route.ts',
};

export async function route(name, method, { body, token, campaignId, query = '' } = {}) {
  const handler = (await import(routes[name]))[method];
  const request = new Request(`http://odm-lab.local/lab${query}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await labRequest.run(request, () => handler(request, { params: Promise.resolve({ campaignId }) }));
  const data = await response.json().catch(() => ({}));
  if (response.status >= 400) throw new Error(`${name} ${method} ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

export async function mcp(action, params) {
  const body = await route('mcp', 'POST', { body: { action, params }, token: lab.mcpToken });
  if (!body.ok) throw new Error(`${action}: ${JSON.stringify(body)}`);
  return body.result;
}

const weapons = { grog: 'Greataxe', shepot: 'Rapier', oleg: 'Quarterstaff' };
const heroes = {
  grog: { user: 'lab_grog', sheet: {
    name: 'Грог', race: 'half-orc', class: 'barbarian', background: 'outlander',
    abilities: { str: 17, dex: 13, con: 16, int: 8, wis: 10, cha: 12 }, maxHp: 15, ac: 14, hitDice: { die: 'd12', total: 1, spent: 0 },
    proficiencies: { saves: ['str', 'con'], skills: ['athletics', 'intimidation'], languages: ['common', 'orc'], tools: [], armor: ['light', 'medium', 'shields'], weapons: ['simple', 'martial'] },
    equipment: [{ name: 'Greataxe', qty: 1 }, { name: 'Handaxe', qty: 2 }, { name: 'Бурдюк с самогоном', qty: 1 }],
    backstory: 'Полуорк-вышибала из портового борделя «Мокрая русалка». Громкий, похабный, добрый к шлюхам и детям, ненавидит стражу.',
  } },
  shepot: { user: 'lab_shepot', sheet: {
    name: 'Шёпот', race: 'tiefling', class: 'rogue', background: 'criminal',
    abilities: { str: 8, dex: 17, con: 12, int: 13, wis: 10, cha: 15 }, maxHp: 9, ac: 14, hitDice: { die: 'd8', total: 1, spent: 0 },
    proficiencies: { saves: ['dex', 'int'], skills: ['stealth', 'sleight-of-hand', 'deception', 'acrobatics'], languages: ['common', 'infernal'], tools: ['thieves-tools'], armor: ['light'], weapons: ['simple', 'rapier', 'shortsword'] },
    equipment: [{ name: 'Rapier', qty: 1 }, { name: 'Shortbow', qty: 1 }, { name: "Thieves' tools", qty: 1 }],
    backstory: 'Тифлинг-воровка, торгует чужими кошельками и своими улыбками. Врёт всем, кроме Грога.',
  } },
  oleg: { user: 'lab_oleg', sheet: {
    name: 'Олег', race: 'gnome', class: 'druid', background: 'hermit',
    abilities: { str: 8, dex: 12, con: 14, int: 13, wis: 16, cha: 10 }, maxHp: 10, ac: 13, hitDice: { die: 'd8', total: 1, spent: 0 },
    proficiencies: { saves: ['int', 'wis'], skills: ['nature', 'animal-handling', 'medicine'], languages: ['common', 'gnomish', 'druidic'], tools: ['herbalism-kit'], armor: ['light', 'medium', 'shields'], weapons: ['club', 'dagger', 'quarterstaff', 'sling'] },
    equipment: [{ name: 'Quarterstaff', qty: 1 }, { name: 'Herbalism kit', qty: 1 }],
    spellcasting: { ability: 'wis', slots: { 1: { max: 2, used: 0 } }, prepared: ['Shillelagh', 'Produce Flame', 'Cure Wounds', 'Thunderwave'], known: [] },
    backstory: 'Гном-друид, говорит с белками и козами, курит странные грибы и уверен, что лес ему должен денег.',
  } },
};

const statePath = path.join(LAB_DIR, 'campaign.json');
export const campaignState = () => JSON.parse(fs.readFileSync(statePath, 'utf8'));

async function seed() {
  if (fs.existsSync(statePath)) return campaignState();
  const password = 'LabPass2026!';
  await route('register', 'POST', { body: { username: heroes.grog.user, password } });
  const lead = await route('token', 'POST', { body: { username: heroes.grog.user, password } });
  const { campaign } = await route('campaigns', 'POST', { token: lead.token, body: {
    title: 'Лаборатория: Портовый переполох', maxPlayers: 4, startingLevel: 1,
    description: 'Грязный портовый город Солёная Жопа. Бордель, контрабанда, продажная стража и культ Рыбьего Бога.',
    theme: 'Портовые трущобы, чёрный юмор, YOLO 21+',
    gameSettings: { dmMode: 'human', ttsEnabled: false, mapsEnabled: false, worldSimulation: false },
  } });
  const state = { campaignId: campaign.id, tokens: { grog: lead.token }, sheets: {} };
  const dm = await route('register', 'POST', { body: { username: 'lab_dm', password, joinCode: campaign.inviteCode } });
  await mcp('campaigns.join_user', { campaignId: campaign.id, user: { userId: dm.user.id } });
  await mcp('campaigns.assign_dm_seat', { campaignId: campaign.id, seat: 'dm', userId: dm.user.id });
  for (const [key, hero] of Object.entries(heroes)) {
    if (key !== 'grog') {
      const user = await route('register', 'POST', { body: { username: hero.user, password, joinCode: campaign.inviteCode } });
      await mcp('campaigns.join_user', { campaignId: campaign.id, user: { userId: user.user.id } });
      state.tokens[key] = (await route('token', 'POST', { body: { username: hero.user, password } })).token;
    }
    state.sheets[key] = (await route('sheet', 'POST', { token: state.tokens[key], campaignId: campaign.id, body: hero.sheet })).sheet.id;
  }
  await mcp('campaigns.set_status', { campaignId: campaign.id, status: 'active' });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
  return state;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [command, hero, ...rest] = process.argv.slice(2);
  const text = rest.join(' ');
  if (command === 'seed') console.log(JSON.stringify({ campaignId: (await seed()).campaignId }));
  else {
    const { campaignId, tokens } = campaignState();
    if (command === 'do') console.log(JSON.stringify(await route('actions', 'POST', { token: tokens[hero], campaignId, body: { kind: 'do', content: text } })));
    else if (command === 'fight') {
      // A combat turn goes through the action builder: attack the first living enemy.
      const s = await mcp('narrator.read', { campaignId, projection: 'live', afterSeq: 0, limit: 1 });
      const { encounter, enemies = [] } = s.encounter ?? {};
      const target = enemies.find(e => e.status === 'alive' || e.currentHp > 0);
      if (!encounter || !target) throw new Error('no active fight or no living enemy');
      console.log(JSON.stringify(await route('actions', 'POST', { token: tokens[hero], campaignId, body: { kind: 'do', combatTurn: {
        encounterId: encounter.id, round: encounter.round, turnIndex: encounter.turnIndex, description: text,
        choices: [{ type: 'attack', targetEnemyId: target.id, weapon: weapons[hero] }] } } })));
    }
    else if (command === 'ask') console.log(JSON.stringify(await route('ask', 'POST', { token: tokens[hero], campaignId, body: { question: text, visibility: 'private' } })));
    else if (command === 'log') {
      const after = Number(hero ?? 0);
      const { messages = [] } = await route('messages', 'GET', { token: tokens.grog, campaignId, query: '?beforeSeq=1000000' });
      for (const m of messages.filter(m => m.seq > after)) console.log(`#${m.seq} [${m.authorType}${m.characterName ? ' ' + m.characterName : ''}] ${m.content}\n`);
    } else if (command === 'state') {
      const s = await mcp('narrator.read', { campaignId, projection: 'live', afterSeq: 0, limit: 1 });
      console.log(JSON.stringify({ currentSeq: s.currentSeq, floor: s.campaign?.floor, turnLock: s.campaign?.turnLock, encounter: s.encounter?.encounter ?? null, pendingRolls: s.pendingRolls?.length, hp: s.sheets?.map(x => [x.name, x.currentHp, x.maxHp]) }));
    } else throw new Error('usage: seed | do <hero> <text> | ask <hero> <text> | log [afterSeq] | state');
  }
  process.exit(0);
}
