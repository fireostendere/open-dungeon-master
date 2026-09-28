// Narrator lamp (the header's web half): the campaign-stream reducer keeps
// narratorPresence from the snapshot and narrator_presence events, the pure
// helper derives the lamp from presence + dmStatus, and the component renders
// that state as the header pill and the mobile sheet row (static markup).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const DIR = '../src/app/campaigns/[campaignId]/';

// Real source for "@/"/relative imports (TSX via typescript), `stubs` by
// specifier, and bare packages from this process so React stays one instance.
async function loader(stubs = {}) {
  const context = vm.createContext({ console, Date, Intl, setInterval, clearInterval });
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
      let path = name.startsWith('@/') ? `../src/${name.slice(2)}` : name;
      if (!/\.(?:ts|tsx|mjs)$/.test(path)) {
        try { readFileSync(new URL(`${path}.ts`, import.meta.url)); path += '.ts'; } catch { path += '.tsx'; }
      }
      const source = readFileSync(new URL(path, import.meta.url), 'utf8');
      const code = path.endsWith('.tsx')
        ? ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
        : stripTypeScriptTypes(source);
      vmModule = new vm.SourceTextModule(code, { context, identifier: name });
    }
    modules.set(name, vmModule); await vmModule.link(load); return vmModule;
  }
  return async name => { const loaded = await load(name); await loaded.evaluate(); return loaded.namespace; };
}

const lampModule = async () => (await loader())(`${DIR}narratorLampState.ts`);
const plain = value => JSON.parse(JSON.stringify(value));

// ------------------------------------------------------------------- reducer
async function streamModule() {
  const load = await loader({
    react: { useCallback: f => f, useEffect() {}, useReducer() {}, useRef: value => ({ current: value }) },
    '@/lib/dm/call-tracker-logic': { sortCalls: calls => calls },
    '@/lib/ambience/logic': { EMPTY_AMBIENCE: {} },
    '@/lib/dm/viewer': { capsForRole: () => ({}) },
    '@/lib/navigation': { navigateTo() {} },
    '@/lib/i18n': { useI18n: () => ({ locale: 'en' }) },
    '@/lib/i18n/session-text': { sessionText: () => '' },
  });
  return load(`${DIR}useCampaignStream.ts`);
}

test('reducer: narratorPresence starts offline, follows the snapshot and narrator_presence events', async () => {
  const { campaignStreamReducer: reduce, initialCampaignState } = await streamModule();
  assert.deepEqual(plain(initialCampaignState.narratorPresence), { online: false, since: null });
  const campaign = { id: 'c1' };
  let state = reduce(initialCampaignState, { type: 'snapshot', payload: { campaign, lastSeq: 5, narratorPresence: { online: true, since: 1000 } } });
  assert.deepEqual(plain(state.narratorPresence), { online: true, since: 1000 });

  // Ephemeral: applies without a seq and never moves the replay cursor.
  state = reduce(state, { type: 'event', eventType: 'narrator_presence', seq: null, payload: { online: false, since: 2000 } });
  assert.deepEqual(plain(state.narratorPresence), { online: false, since: 2000 });
  assert.equal(state.lastSeq, 5);
  state = reduce(state, { type: 'event', eventType: 'narrator_presence', seq: null, payload: { online: 'yes', since: 'noon' } });
  assert.deepEqual(plain(state.narratorPresence), { online: false, since: null }, 'malformed payloads read as offline, unknown since');

  // Reconnect/resync: the snapshot is authoritative again.
  state = reduce(state, { type: 'snapshot', reset: true, payload: { campaign, lastSeq: 6, narratorPresence: { online: true, since: 3000 } } });
  assert.deepEqual(plain(state.narratorPresence), { online: true, since: 3000 });
  // A dm_status change leaves presence alone.
  state = reduce(state, { type: 'event', eventType: 'dm_status', seq: null, payload: { state: 'thinking' } });
  assert.equal(state.dmStatus, 'thinking');
  assert.deepEqual(plain(state.narratorPresence), { online: true, since: 3000 });
});

test('stream hook: narrator_presence is subscribed as ephemeral and read from the snapshot', () => {
  const source = readFileSync(new URL(`${DIR}useCampaignStream.ts`, import.meta.url), 'utf8');
  const ephemeral = /const EPHEMERAL_EVENTS = \[([\s\S]*?)\];/.exec(source)[1];
  assert.match(ephemeral, /"narrator_presence"/);
  assert.match(source, /narratorPresence: narratorPresenceFrom\(data\.narratorPresence\)/);
});

// ------------------------------------------------------------ derivation
test('lamp: offline, online and activity states from presence + dmStatus', async () => {
  const { narratorLamp } = await lampModule();
  const offline = { online: false, since: 500 }, online = { online: true, since: 900 };
  assert.deepEqual(plain(narratorLamp({ presence: offline, dmStatus: 'idle' })),
    { state: 'offline', tone: 'offline', pulse: false, online: false, since: 500 });
  assert.deepEqual(plain(narratorLamp({ presence: { online: false, since: null }, dmStatus: 'idle' })),
    { state: 'offline', tone: 'offline', pulse: false, online: false, since: null });
  assert.deepEqual(plain(narratorLamp({ presence: online, dmStatus: 'idle' })),
    { state: 'online', tone: 'online', pulse: false, online: true, since: 900 });
  for (const dmStatus of ['thinking', 'rolling', 'narrating', 'awaiting_rolls', 'writing_chapter', 'plotting_arc']) {
    assert.deepEqual(plain(narratorLamp({ presence: online, dmStatus })), { state: dmStatus, tone: 'busy', pulse: true, online: true, since: 900 }, dmStatus);
    // Activity shows even without a doorbell (server-side runtime).
    assert.equal(narratorLamp({ presence: offline, dmStatus }).state, dmStatus, `${dmStatus} while offline`);
  }
});

test('lamp: a server-side narrator or a present human DM is on the line without a doorbell', async () => {
  const { narratorLamp } = await lampModule();
  const offline = { online: false, since: 500 };
  // `since` belongs to the doorbell, so it is dropped rather than misread as "online since".
  assert.deepEqual(plain(narratorLamp({ presence: offline, dmStatus: 'idle', serverNarrator: true })),
    { state: 'online', tone: 'online', pulse: false, online: true, since: null });
  assert.deepEqual(plain(narratorLamp({ presence: offline, dmStatus: 'idle', dmSeatOnline: true })),
    { state: 'online', tone: 'online', pulse: false, online: true, since: null });
  assert.deepEqual(plain(narratorLamp({ presence: { online: true, since: 900 }, dmStatus: 'idle', serverNarrator: true })).since, 900);
});

test('lamp: presence payloads are parsed defensively', async () => {
  const { narratorPresenceFrom } = await lampModule();
  assert.deepEqual(plain(narratorPresenceFrom({ online: true, since: 12 })), { online: true, since: 12 });
  for (const bad of [undefined, null, 'x', [], { online: 1, since: -1 }, { online: 'true', since: Infinity }, { since: '12' }]) {
    assert.deepEqual(plain(narratorPresenceFrom(bad)), { online: false, since: null }, JSON.stringify(bad));
  }
});

test('lamp text: RU/EN labels and tooltips; HH:MM today, date otherwise', async () => {
  const { narratorLamp, narratorLampText, formatLampTime } = await lampModule();
  const at = Date.UTC(2026, 8, 29, 14, 5), now = Date.UTC(2026, 8, 29, 18, 0);
  const full = (presence, dmStatus, locale, extra = {}) => plain(narratorLampText(narratorLamp({ presence, dmStatus, ...extra }), locale, now, 'UTC'));
  const text = (...args) => { const { label, detail } = full(...args); return { label, detail }; };
  assert.equal(formatLampTime(at, now, 'ru', 'UTC'), '14:05');
  assert.equal(formatLampTime(at, now, 'en', 'UTC'), '14:05');
  assert.match(formatLampTime(at, Date.UTC(2026, 8, 30, 9), 'ru', 'UTC'), /^29 сент\.?, 14:05$/);
  assert.match(formatLampTime(at, Date.UTC(2026, 8, 30, 9), 'en', 'UTC'), /^Sep 29, 14:05$/);

  assert.deepEqual(text({ online: false, since: at }, 'idle', 'ru'),
    { label: 'Мастер не на связи', detail: 'Ходы сохраняются: мастер обработает их, когда вернётся. Не на связи с 14:05.' });
  assert.deepEqual(text({ online: false, since: null }, 'idle', 'ru'),
    { label: 'Мастер не на связи', detail: 'Ходы сохраняются: мастер обработает их, когда вернётся.' });
  assert.deepEqual(text({ online: true, since: at }, 'idle', 'ru'), { label: 'Мастер на связи', detail: 'Ждёт ходов, на связи с 14:05.' });
  assert.deepEqual(text({ online: false, since: null }, 'idle', 'ru', { serverNarrator: true }), { label: 'Мастер на связи', detail: 'Ждёт ходов.' });
  assert.deepEqual(text({ online: false, since: at }, 'idle', 'en'),
    { label: 'DM offline', detail: 'Your turns are saved and will be handled when the DM is back. Offline since 14:05.' });
  assert.deepEqual(text({ online: true, since: at }, 'idle', 'en'), { label: 'DM online', detail: 'Waiting for your turns, online since 14:05.' });

  // One spoken sentence for aria-label: no "…." when the label ends a sentence.
  assert.equal(full({ online: true, since: at }, 'idle', 'ru').summary, 'Мастер на связи. Ждёт ходов, на связи с 14:05.');
  assert.equal(full({ online: true, since: at }, 'rolling', 'ru').summary, 'Бросает кости… Мастер работает над ходом стола. На связи с 14:05.');
  assert.equal(full({ online: false, since: null }, 'awaiting_rolls', 'en').summary, 'Waiting for rolls. The DM is working on the table\'s turn.');

  const ru = { thinking: 'Мастер думает…', rolling: 'Бросает кости…', narrating: 'Пишет…', awaiting_rolls: 'Ждёт бросков', writing_chapter: 'Пишет главу…', plotting_arc: 'Строит сюжет…' };
  for (const [dmStatus, label] of Object.entries(ru)) {
    assert.deepEqual(text({ online: true, since: at }, dmStatus, 'ru'), { label, detail: 'Мастер работает над ходом стола. На связи с 14:05.' });
    assert.deepEqual(text({ online: false, since: at }, dmStatus, 'ru'), { label, detail: 'Мастер работает над ходом стола.' }, 'no "online since" while offline');
    assert.doesNotMatch(text({ online: true, since: at }, dmStatus, 'en').label, /[А-Яа-яЁё]/);
  }
});

// ---------------------------------------------------------------- render
async function renderLamp(lamp, locale = 'ru') {
  const load = await loader({
    '@/lib/i18n': { useI18n: () => ({ locale }) },
    // Radix needs a DOM; the stub renders the tooltip body inline instead.
    '@/components/ui/Tooltip': { Tooltip: ({ content, children }) => React.createElement(React.Fragment, null, children, React.createElement('div', { role: 'tooltip' }, content)) },
  });
  const { NarratorLamp, NarratorLampRow } = await load(`${DIR}NarratorLamp.tsx`);
  const { narratorLampText } = await load(`@/app/campaigns/[campaignId]/narratorLampState`);
  return {
    pill: renderToStaticMarkup(React.createElement(NarratorLamp, { lamp })),
    row: renderToStaticMarkup(React.createElement(NarratorLampRow, { lamp })),
    text: plain(narratorLampText(lamp, locale, Date.now())),
  };
}
const escape = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

test('render: the header pill is a quiet header button with a dot, a md+ label and an accessible explanation', async () => {
  const { narratorLamp } = await lampModule();
  const { pill, row, text } = await renderLamp(narratorLamp({ presence: { online: false, since: Date.now() - 60_000 }, dmStatus: 'idle' }));
  assert.match(pill, /^<span tabindex="0" role="img" aria-label="[^"]+" data-lamp="offline" class="[^"]*rounded-lg border[^"]*"/);
  assert.ok(pill.includes(`aria-label="${escape(text.summary)}"`));
  assert.equal(text.summary, `${text.label}. ${text.detail}`);
  assert.match(pill, /class="size-2 rounded-full bg-stone-500"/);
  assert.match(pill, /<span class="hidden whitespace-nowrap text-sm md:inline">Мастер не на связи<\/span>/, 'label collapses below md');
  assert.ok(pill.includes(`<div role="tooltip"><span class="block font-medium text-stone-200">Мастер не на связи</span><span class="block">${escape(text.detail)}</span></div>`));
  assert.doesNotMatch(pill, /animate-pulse/);
  assert.match(row, /data-lamp="offline"/);
  assert.ok(row.includes(`>${escape(text.detail)}</span>`), 'the mobile sheet row spells out the tooltip');
});

test('render: online is green; activity pulses amber unless motion is reduced', async () => {
  const { narratorLamp } = await lampModule();
  const online = await renderLamp(narratorLamp({ presence: { online: true, since: Date.now() }, dmStatus: 'idle' }), 'en');
  assert.match(online.pill, /data-lamp="online"/);
  assert.match(online.pill, /bg-emerald-400/);
  assert.match(online.pill, />DM online<\/span>/);
  const busy = await renderLamp(narratorLamp({ presence: { online: true, since: Date.now() }, dmStatus: 'thinking' }));
  assert.match(busy.pill, /data-lamp="thinking"/);
  assert.match(busy.pill, /class="size-2 rounded-full bg-amber-400[^"]* animate-pulse motion-reduce:animate-none"/);
  assert.match(busy.pill, /border-amber-500\/40/);
  assert.match(busy.pill, />Мастер думает…<\/span>/);
});

test('header: the lamp sits right before the voice-room button and in the mobile sheet', () => {
  const source = readFileSync(new URL(`${DIR}SessionHeader.tsx`, import.meta.url), 'utf8');
  assert.match(source, /<NarratorLamp lamp=\{narrator\} \/>\s*<VoiceDock \{\.\.\.voice\} \/>/);
  assert.match(source, /<div className="flex flex-col gap-2">\s*<NarratorLampRow lamp=\{narrator\} \/>/);
});
