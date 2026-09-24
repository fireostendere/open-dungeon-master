// Pure behavior + structural regression checks; runs in the normal npm test suite.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const folder = new URL("../src/app/campaigns/[campaignId]/", import.meta.url);
const read = name => readFile(new URL(name, folder), "utf8");
const source = await read("session-mobile.ts");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const { keyboardIsOpen, composerHeight, mobileTabIds, shouldSubmitComposerKey } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`);
let cases = 0;
function check(value, expected) { assert.deepEqual(value, expected); cases++; }
check(keyboardIsOpen({ editing: true, baselineHeight: 844, visibleHeight: 500 }), true);
check(keyboardIsOpen({ editing: false, baselineHeight: 844, visibleHeight: 500 }), false);
check(keyboardIsOpen({ editing: true, baselineHeight: 844, visibleHeight: 790 }), false);
check(keyboardIsOpen({ editing: true, baselineHeight: 844, visibleHeight: 844 }), false);
check(keyboardIsOpen({ editing: true, baselineHeight: 844, visibleHeight: 500, scale: 1.5 }), false);
check(keyboardIsOpen({ editing: true, baselineHeight: 500, visibleHeight: 380 }), false);
for (const height of [256, 320, 568, 740, 844, 1024]) {
  check(composerHeight(24, height), 32);
  check(composerHeight(2000, height), Math.max(64, Math.min(144, height / 4)));
}
const ids = ["dm", "lead", "party", "battle", "map", "story", "notes", "chat", "context", "settings"];
for (let mask = 0; mask < 2 ** ids.length; mask++) {
  const allowed = ids.filter((_, i) => mask & (1 << i));
  const primary = mobileTabIds(allowed);
  const overflow = allowed.filter(id => !primary.includes(id));
  check(primary.length <= 3, true);
  check([...primary, ...overflow].sort(), [...allowed].sort());
  check(primary.every(id => allowed.includes(id)), true);
}
const key = { key: "Enter", shift: false, modifier: false, composing: false, mobile: false };
check(shouldSubmitComposerKey(key), true);
check(shouldSubmitComposerKey({ ...key, mobile: true }), false);
check(shouldSubmitComposerKey({ ...key, mobile: true, modifier: true }), true);
check(shouldSubmitComposerKey({ ...key, shift: true }), false);
check(shouldSubmitComposerKey({ ...key, composing: true }), false);
check(shouldSubmitComposerKey({ ...key, mobile: true, modifier: true, composing: true }), false);
check(shouldSubmitComposerKey({ ...key, key: "a" }), false);

for (const file of ["Composer.tsx", "SessionHeader.tsx", "SessionTabs.tsx", "SessionViewport.tsx", "page.tsx", "session-mobile.ts"]) {
  const text = await read(file);
  const result = ts.transpileModule(text, { fileName: file, compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, reportDiagnostics: true });
  const errors = (result.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")).join("\n"));
  cases++;
}
const composer = await read("Composer.tsx");
const header = await read("SessionHeader.tsx");
const viewport = await read("SessionViewport.tsx");
const css = await read("session-mobile.css");
check((composer.match(/<PendingRollCard\b/g) ?? []).length, 1);
check((header.match(/<VoiceDock\b/g) ?? []).length, 1);
// The tray's display changes; it must not gate mounting the physical dice listener.
assert.match(composer, /pendingRolls\.map\(pending => <PendingRollCard key=\{pending\.id\}/);
assert.doesNotMatch(composer, /trayOpen\s*\?\s*<|trayOpen\s*&&\s*</);
assert.match(composer, /ownCombatTurn && !combatLocked/);
assert.match(composer, /!sending && !inputBlocked/);
assert.match(composer, /disabled=\{inputBlocked\}/);
assert.match(composer, /onSubmit=\{submit\} noValidate/); // Hidden pending-roll input cannot block chat form validation.
assert.match(composer, /isComposing \|\| event\.keyCode === 229/);
assert.match(css, /data-tray-open="false"/);
assert.match(css, /data-reading="true"/);
assert.match(viewport, /cancelAnimationFrame\(frame\)/);
assert.match(viewport, /removeEventListener\("focusout", schedule\)/);
assert.match(viewport, /returnFocusRef\.current\.focus\(\{ preventScroll: true \}\)/);
console.log(`Mobile session: ${cases} checks passed (behavior, permissions-preserving navigation, syntax and mount contracts).`);
