// Disclosure contracts only; this is not a hydrated browser or full-app test.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../src/app/campaigns/[campaignId]/Composer.tsx", import.meta.url), "utf8");
const file = ts.createSourceFile("Composer.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
assert.equal(file.parseDiagnostics.length, 0, "Composer must parse");
const compiled = ts.transpileModule(source, {
  fileName: "Composer.tsx",
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
});
assert.equal((compiled.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);

function elements(node, tag) {
  const found = [];
  function visit(child) {
    if (ts.isJsxElement(child) && child.openingElement.tagName.getText(file) === tag) found.push(child);
    ts.forEachChild(child, visit);
  }
  visit(node);
  return found;
}
const details = elements(file, "details");
assert.equal(details.length, 1, "One disclosure, not multiple reading modes");
const disclosure = details[0];
const children = disclosure.children.filter(ts.isJsxElement);
assert.deepEqual(children.map(n => n.openingElement.tagName.getText(file)), ["summary", "form"],
  "The form must stay mounted as a direct child, not behind conditional rendering");
const [summary, form] = children;
assert.equal(elements(summary, "button").length, 0, "Native summary must not contain nested buttons");
assert.match(summary.getText(file), /min-h-11/, "Keep a 44px touch target");
assert.match(summary.getText(file), /chatExpanded \? copy\.hideChat : copy\.showChat/);
assert.match(source, /\[chatExpanded, setChatExpanded\] = useState\(true\)/);
for (const label of ["Скрыть чат", "Показать чат", "Hide chat", "Show chat"]) assert.ok(source.includes(label));
const attribute = name => disclosure.openingElement.attributes.properties.find(p => p.name?.getText(file) === name);
assert.equal(attribute("open").initializer.expression.getText(file), "chatExpanded");
assert.ok(!attribute("onClick"), "Native summary owns pointer and keyboard activation");
const onToggleSource = attribute("onToggle").initializer.expression.getText(file);
let expanded = true;
const onToggle = vm.runInNewContext(`(${onToggleSource})`, { setChatExpanded: value => { expanded = value; } });
for (const open of [false, false, true, false, true]) {
  onToggle({ currentTarget: { open } });
  assert.equal(expanded, open, "Open state follows native toggles without gameplay actions");
}
assert.match(form.getText(file), /onSubmit=\{handleSubmit\}/);
assert.match(form.getText(file), /disabled=\{inputBlocked\}/);
assert.match(form.getText(file), /value=\{input\}/);
assert.match(form.getText(file), /<PendingRollCard/);
const composer = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ComposerInner");
const submitHandler = composer.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "handleSubmit");
const handlerJs = ts.transpileModule(`(${submitHandler.getText(file)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
for (const [kind, input, blocked, expectedPreview, expectedSubmit] of [
  ["do", "  I draw my sword  ", false, "I draw my sword", 0],
  ["ooc", "hello", false, null, 1],
  ["do", "hello", true, null, 1],
]) {
  let preview = null, submissions = 0, prevented = 0;
  const handleSubmit = vm.runInNewContext(handlerJs, {
    kind, input, inputBlocked: blocked, sending: false, ownCombatTurn: false, combatChoices: [],
    setPreview: value => { preview = value; }, onSubmit: () => { submissions += 1; },
  });
  handleSubmit({ preventDefault: () => { prevented += 1; } });
  assert.equal(prevented, 1);
  assert.equal(preview, expectedPreview);
  assert.equal(submissions, expectedSubmit);
}
assert.match(source, /onSubmit\(null, preview\)/, "Confirmation sends the reviewed draft");
const locationSource = await readFile(new URL("../src/app/campaigns/[campaignId]/LocationChat.tsx", import.meta.url), "utf8");
const locationFile = ts.createSourceFile("LocationChat.tsx", locationSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const locationComponent = locationFile.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "LocationChat");
const spatialSend = locationComponent.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "send");
const spatialJs = ts.transpileModule(`(${spatialSend.getText(locationFile)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
let spatialPreview = null;
const commands = [];
const chat = { selected: "room-a", campaignId: "campaign-a", command: async payload => { commands.push(payload); return true; } };
const send = vm.runInNewContext(spatialJs, {
  content: "  I draw my sword  ", kind: "do", ooc: false, view: { enabled: true, isDm: false, current: { revision: 7 } },
  canSend: true, sendBlocked: false, chat, isStealth: false,
  setPreview: value => { spatialPreview = value; }, setContent: () => {}, setIsStealth: () => {},
});
await send({ preventDefault() {} });
assert.deepEqual(JSON.parse(JSON.stringify(spatialPreview)), { text: "I draw my sword", roomId: "room-a" });
assert.equal(commands.length, 0, "Spatial action waits for confirmation");
await send(null, spatialPreview.text);
assert.equal(commands.length, 1);
assert.equal(commands[0].roomId, "room-a");
assert.equal(commands[0].content, spatialPreview.text);
console.log("Table chat disclosure and both action confirmation paths passed.");
