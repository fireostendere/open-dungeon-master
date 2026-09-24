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
assert.match(form.getText(file), /onSubmit=\{onSubmit\}/);
assert.match(form.getText(file), /disabled=\{inputBlocked\}/);
assert.match(form.getText(file), /value=\{input\}/);
assert.match(form.getText(file), /<PendingRollCard/);
console.log("Table chat disclosure: syntax, local state, persistent form and input gates passed.");
