// Exercise the actual JSX and click handlers without a browser or network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

let locale = "ru", cursor = 0;
const slots = [], requests = [];
let respond = async () => Response.json({ message: { id: "rest-request" } }, { status: 201 });
const jsx = (type, props) => ({ type, props });
const mocks = {
  react: { useEffect() {}, useState(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = initial;
    return [slots[index], value => { slots[index] = value; }];
  } },
  "react/jsx-runtime": { jsx, jsxs: jsx },
  "@/lib/i18n": { useI18n: () => ({ locale }) },
  "@/lib/i18n/locale-text": { localeText: (language, values) => values[language] },
  "@/lib/cn": { cn: (...values) => values.filter(Boolean).join(" ") },
  "@/app/campaigns/[campaignId]/NotesPanel": { pendingCampaignNotes: () => [] },
};
const source = readFileSync(new URL("../src/app/campaigns/[campaignId]/LeadPanel.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
vm.runInNewContext(compiled, {
  exports,
  require: name => mocks[name] ?? new Proxy({}, { get: (_target, key) => key }),
  fetch: async (url, init) => { requests.push({ url, ...init }); return respond(); },
});
const walk = (tree, predicate) => !tree || typeof tree !== "object" ? []
  : Array.isArray(tree) ? tree.flatMap(child => walk(child, predicate))
  : [...(predicate(tree) ? [tree] : []), ...walk(tree.props?.children, predicate)];
const text = tree => tree == null || typeof tree === "boolean" ? ""
  : Array.isArray(tree) ? tree.map(text).join(" ")
  : typeof tree === "object" ? text(tree.props?.children) : String(tree);
const props = {
  campaignId: "campaign", campaign: { status: "active", gameSettings: {} }, floor: { mode: "open" },
  sheets: [], members: [], notes: [], isLead: true, steersStory: false,
};
function restCard(extra = {}) {
  slots.length = 0; cursor = 0;
  return walk(exports.LeadPanel({ ...props, ...extra }), node => typeof node.type === "function" && node.type.name === "RestCard")[0];
}
assert.equal(restCard({ isLead: false }), undefined, "other party members cannot request party rest here");
let card = restCard();
assert.ok(card, "the lead panel must offer party rest");
slots.length = 0;
const render = () => { cursor = 0; return card.type(card.props); };
const buttons = () => walk(render(), node => node.type === "button");
assert.deepEqual(buttons().map(button => text(button).trim()), ["Короткий привал", "Долгий привал"]);

let complete;
respond = () => new Promise(resolve => { complete = resolve; });
buttons()[0].props.onClick();
assert.ok(buttons().every(button => button.props.disabled), "both choices lock while a request is in flight");
buttons()[1].props.onClick();
assert.equal(requests.length, 1, "a pending request cannot submit a second rest");
assert.equal(requests[0].url, "/api/campaigns/campaign/lead-note");
assert.equal(requests[0].method, "POST");
assert.match(JSON.parse(requests[0].body).content, /короткий привал/);
complete(Response.json({}, { status: 201 }));
await new Promise(setImmediate);
assert.match(text(render()), /Запрос на короткий привал отправлен/);

respond = async () => Response.json({ error: "Rest refused" }, { status: 409 });
buttons()[1].props.onClick(); await new Promise(setImmediate);
assert.match(JSON.parse(requests.at(-1).body).content, /долгий привал/);
assert.match(text(render()), /Rest refused/);
assert.ok(buttons().every(button => !button.props.disabled), "a refusal leaves the controls usable");
respond = async () => { throw new Error("offline"); };
buttons()[0].props.onClick(); await new Promise(setImmediate);
assert.match(text(render()), /Не удалось связаться/);

for (const extra of [
  { campaign: { ...props.campaign, status: "lobby" } },
  { campaign: { ...props.campaign, status: "ended" } },
  { encounter: { status: "active" } },
  { floor: { mode: "initiative" } },
  { floor: { mode: "hold", combat: {} } },
]) {
  card = restCard(extra); slots.length = 0;
  assert.ok(buttons().every(button => button.props.disabled), "inactive campaigns and combat cannot request rest");
  const count = requests.length;
  buttons()[0].props.onClick();
  assert.equal(requests.length, count);
}
locale = "en"; card = restCard({ encounter: { status: "ended" } }); slots.length = 0;
assert.ok(buttons().every(button => !button.props.disabled), "completed encounters allow rest");
assert.deepEqual(buttons().map(button => text(button).trim()), ["Short rest", "Long rest"]);
respond = async () => Response.json({}, { status: 201 });
buttons()[1].props.onClick(); await new Promise(setImmediate);
assert.match(JSON.parse(requests.at(-1).body).content, /long rest/);
assert.match(text(render()), /Long rest requested/);
console.log("PASS lead rest buttons, requests, busy state, refusals, combat/status gates and localization");
