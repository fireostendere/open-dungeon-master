// Narrator presence (the header lamp's server half): per-campaign doorbell
// counting, the debounced offline transition, the published events, and the
// campaign snapshot field. Real modules in a vm; the event bus and every other
// snapshot dependency are stubbed. The doorbell route itself is exercised
// end to end in scripts/test-mcp-events-stream.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const CAMPAIGN = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

// Loads `entry` and its imports as real source, except `stubs` (by specifier)
// and bare packages/node: builtins, which come from this process. `autoStub`
// turns every other "@/" import into functions returning [] by named import.
async function loader(stubs, { autoStub = false, globals = {} } = {}) {
  const context = vm.createContext({ console, Response, Request, URL, setTimeout, clearTimeout, ...globals });
  const modules = new Map();
  async function load(name) {
    if (modules.has(name)) return modules.get(name);
    let vmModule;
    const synthetic = values => new vm.SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    }, { context, identifier: name });
    if (stubs[name]) vmModule = synthetic(stubs[name]);
    else if (!name.startsWith('@/') && !name.startsWith('.')) vmModule = synthetic({ ...(await import(name)) });
    else {
      const path = name.startsWith('@/') ? `../src/${name.slice(2)}${/\.(?:ts|mjs)$/.test(name) ? '' : '.ts'}` : name;
      let source;
      try { source = readFileSync(new URL(path, import.meta.url), 'utf8'); }
      catch (error) { if (!autoStub) throw error; }
      vmModule = source === undefined || (autoStub && !name.startsWith('.') && !REAL.has(name))
        ? synthetic(Object.fromEntries(namedImports(name).map(key => [key, () => []])))
        : new vm.SourceTextModule(stripTypeScriptTypes(source), { context, identifier: name });
    }
    modules.set(name, vmModule); await vmModule.link(load); return vmModule;
  }
  let importers = '';
  const REAL = new Set(['@/lib/dm/narrator-presence', '@/lib/dm/status']);
  // Named imports of `specifier` across every module loaded so far.
  function namedImports(specifier) {
    const names = new Set();
    const pattern = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*["']${specifier.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}["']`, 'g');
    for (const match of importers.matchAll(pattern)) {
      for (const part of match[1].split(',')) {
        const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
        if (name) names.add(name);
      }
    }
    return [...names];
  }
  return async (name, file) => {
    if (file) importers += stripTypeScriptTypes(readFileSync(new URL(file, import.meta.url), 'utf8'));
    const loaded = await load(name); await loaded.evaluate(); return loaded.namespace;
  };
}

// Deterministic clock for the offline debounce: timers fire only on advance().
function fakeClock(presence, now = 100) {
  const clock = { now, timers: new Map(), id: 0 };
  clock.advance = ms => {
    clock.now += ms;
    for (const [id, timer] of [...clock.timers].sort((a, b) => a[1].at - b[1].at)) {
      if (timer.at <= clock.now) { clock.timers.delete(id); timer.callback(); }
    }
  };
  presence.configureNarratorPresence({
    now: () => clock.now, graceMs: 5000,
    setTimeout: (callback, ms) => { const id = ++clock.id; clock.timers.set(id, { callback, at: clock.now + ms }); return id; },
    clearTimeout: id => { clock.timers.delete(id); },
  });
  return clock;
}

async function presenceModule(globals) {
  const published = [];
  const failures = { next: false };
  const events = { publishEphemeral: (...args) => {
    if (failures.next) { failures.next = false; throw new Error('bus down'); }
    // Copied into this realm so deepStrictEqual compares plain objects.
    published.push(args.map(arg => (arg && typeof arg === 'object' ? { ...arg } : arg)));
  } };
  const load = await loader({ '@/lib/events': events }, { globals });
  const presence = await load('@/lib/dm/narrator-presence');
  const status = await load('@/lib/dm/status');
  const clock = fakeClock(presence);
  const state = campaignId => ({ ...presence.getNarratorPresence(campaignId) });
  return { presence, status, published, failures, clock, state };
}

test('counts doorbell streams per campaign; only 0 -> 1 publishes online', async () => {
  const { presence, published, state } = await presenceModule();
  assert.deepEqual(state(CAMPAIGN), { online: false, since: null }, 'never seen');
  const a = presence.acquireNarratorPresence(CAMPAIGN);
  const b = presence.acquireNarratorPresence(CAMPAIGN);
  const c = presence.acquireNarratorPresence(CAMPAIGN);
  assert.deepEqual(state(CAMPAIGN), { online: true, since: 100 });
  assert.deepEqual(state(OTHER), { online: false, since: null }, 'campaigns are independent');
  assert.equal(published.length, 1);
  const [campaignId, type, payload, scope] = published[0];
  assert.equal(campaignId, CAMPAIGN);
  assert.equal(type, 'narrator_presence');
  assert.deepEqual(payload, { online: true, since: 100 });
  assert.deepEqual(scope, { kind: 'global' }, 'every seat sees the lamp');
  a(); b();
  assert.deepEqual(state(CAMPAIGN), { online: true, since: 100 }, 'one stream still open');
  assert.equal(published.length, 1);
  c();
});

test('release is idempotent: every close path may call it, it counts once', async () => {
  const { presence, clock, state } = await presenceModule();
  const a = presence.acquireNarratorPresence(CAMPAIGN);
  const b = presence.acquireNarratorPresence(CAMPAIGN);
  a(); a(); a();
  clock.advance(60_000);
  assert.deepEqual(state(CAMPAIGN), { online: true, since: 100 }, 'b keeps it online');
  assert.equal(clock.timers.size, 0);
  b(); b();
  assert.equal(clock.timers.size, 1, 'exactly one debounce armed');
});

test('offline is debounced; a reconnect inside the window is a silent flap', async () => {
  const { presence, published, clock, state } = await presenceModule();
  const first = presence.acquireNarratorPresence(CAMPAIGN);
  clock.now = 1000; first();
  assert.deepEqual(state(CAMPAIGN), { online: true, since: 100 }, 'still online while debouncing');
  clock.advance(4999);
  const second = presence.acquireNarratorPresence(CAMPAIGN);
  assert.equal(clock.timers.size, 0, 'pending offline cancelled');
  clock.advance(60_000);
  assert.equal(published.length, 1, 'nothing published for the flap');
  assert.deepEqual(state(CAMPAIGN), { online: true, since: 100 }, 'the online stretch keeps its start');

  clock.now = 70_000; second();
  clock.advance(5000);
  assert.deepEqual(published.map(([, , payload]) => payload), [{ online: true, since: 100 }, { online: false, since: 70_000 }],
    'offline is dated when the last stream closed, published after the grace');
  assert.deepEqual(state(CAMPAIGN), { online: false, since: 70_000 });

  clock.now = 80_000;
  const third = presence.acquireNarratorPresence(CAMPAIGN);
  assert.deepEqual(published.at(-1)[2], { online: true, since: 80_000 }, 'back online after a confirmed offline publishes again');
  third();
});

test('a narrator that left no longer shows turn activity to the table', async () => {
  const { presence, status, published, clock } = await presenceModule();
  const release = presence.acquireNarratorPresence(CAMPAIGN);
  status.setDmStatus(CAMPAIGN, 'thinking');
  release();
  clock.advance(5000);
  assert.equal(status.getDmStatus(CAMPAIGN), 'idle', 'a crashed host mid-turn must not leave "thinking" forever');
  assert.deepEqual(published.at(-1).slice(0, 3), [CAMPAIGN, 'dm_status', { state: 'idle' }]);
  const again = presence.acquireNarratorPresence(CAMPAIGN);
  status.setDmStatus(CAMPAIGN, 'awaiting_rolls');
  again();
  clock.advance(5000);
  assert.equal(status.getDmStatus(CAMPAIGN), 'awaiting_rolls', 'waiting for players stays: it is the table\'s move');
});

test('a failing event bus never breaks the stream that acquired or released', async () => {
  const { presence, failures, clock, state } = await presenceModule();
  const errors = [];
  const original = console.error; console.error = (...args) => errors.push(args.join(' '));
  try {
    failures.next = true;
    const release = presence.acquireNarratorPresence(CAMPAIGN);
    assert.deepEqual(state(CAMPAIGN), { online: true, since: 100 });
    release();
    failures.next = true;
    assert.doesNotThrow(() => clock.advance(5000));
    assert.deepEqual(state(CAMPAIGN), { online: false, since: 100 });
    assert.equal(errors.length, 2);
    assert.match(errors[0], /narrator-presence/);
  } finally { console.error = original; }
});

test('default clock: 5 s grace on real timers that never hold the process open', async () => {
  const armed = [];
  const { presence, state } = await presenceModule({
    setTimeout: (callback, ms) => { const handle = { callback, ms, unrefed: false, unref() { handle.unrefed = true; } }; armed.push(handle); return handle; },
    clearTimeout: handle => { handle.cleared = true; },
  });
  assert.equal(presence.NARRATOR_OFFLINE_GRACE_MS, 5000);
  presence.configureNarratorPresence();
  const before = Date.now();
  const first = presence.acquireNarratorPresence(CAMPAIGN);
  assert.ok(state(CAMPAIGN).since >= before, 'since is wall-clock ms');
  first();
  assert.equal(armed.length, 1);
  assert.equal(armed[0].ms, 5000);
  assert.equal(armed[0].unrefed, true);
  const second = presence.acquireNarratorPresence(CAMPAIGN);
  assert.equal(armed[0].cleared, true, 'reconnect clears the real timer');
  second();
  armed[1].callback();
  assert.equal(state(CAMPAIGN).online, false);
});

test('campaign snapshot serves narratorPresence next to dmStatus', async () => {
  const published = [];
  const route = '../src/app/api/campaigns/[campaignId]/route.ts';
  const load = await loader({
    '@/lib/events': { publishEphemeral: (...args) => published.push(args), publishPersisted() {}, publishWithSeq() {} },
    '@/lib/campaign-api': {
      requireMember: async () => ({ campaign: { id: CAMPAIGN }, user: { id: 'A', username: 'a', avatar: null } }),
      isErrorResponse: value => value instanceof Response,
      capsFor: () => ({ adjudicates: false, steersStory: false, fullMap: false, enemyNumbers: false }),
      isLead: () => false,
    },
    '@/lib/campaign-types': { CAMPAIGN_DIFFICULTIES: ['easy', 'normal', 'hard'] },
    '@/lib/spatial/service': { spatialEnabled: () => false, spatialContext: () => ({}), spatialStore: () => ({}) },
    '@/lib/db/campaigns': Object.fromEntries(['allocateSeq', 'campaignSeats', 'deleteCampaign', 'listMembers', 'setCampaignStatus', 'updateCampaignInfo']
      .map(name => [name, () => []]).concat([['latestSeq', () => 42], ['publicCampaign', campaign => campaign]])),
  }, { autoStub: true });
  const { GET } = await load(route, route);
  const presence = await load('@/lib/dm/narrator-presence');
  const clock = fakeClock(presence, 5000);
  const snapshot = async () => (await GET(new Request(`http://app/api/campaigns/${CAMPAIGN}`), { params: Promise.resolve({ campaignId: CAMPAIGN }) })).json();

  let body = await snapshot();
  assert.equal(body.latestSeq, 42);
  assert.equal(body.dmStatus, 'idle');
  assert.deepEqual(body.narratorPresence, { online: false, since: null });

  const release = presence.acquireNarratorPresence(CAMPAIGN);
  body = await snapshot();
  assert.deepEqual(body.narratorPresence, { online: true, since: 5000 });
  assert.equal(published.length, 1);
  clock.now = 9000; release();
  body = await snapshot();
  assert.deepEqual(body.narratorPresence, { online: true, since: 5000 }, 'unchanged while the offline debounce runs');
  clock.advance(5000);
  body = await snapshot();
  assert.deepEqual(body.narratorPresence, { online: false, since: 9000 }, 'follows the confirmed transition');
});
