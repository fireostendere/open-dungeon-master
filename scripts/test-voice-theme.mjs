import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const css = read("src/app/campaigns/[campaignId]/VoiceCall.module.css");
const dock = read("src/app/campaigns/[campaignId]/VoiceDock.tsx");
const globals = read("src/app/globals.css");

test("voice surfaces use the application palette rather than literal colors", () => {
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab)\(/i);
  assert.match(css, /--call-bg:\s*var\(--color-stone-950\)/);
  assert.match(css, /--call-accent:\s*var\(--color-amber-300\)/);
  assert.match(css, /--call-text:\s*var\(--foreground\)/);
});

test("custom color and shadow references exist in the application theme", () => {
  const declared = new Set([...globals.matchAll(/(--[\w-]+)\s*:/g)].map(match => match[1]));
  const refs = new Set([...css.matchAll(/var\((--(?:color-(?:stone|amber|ember)-[\w-]+|shadow-[\w-]+|foreground))\)/g)].map(match => match[1]));
  assert.ok(refs.size > 10);
  for (const ref of refs) assert.ok(declared.has(ref), `Missing shared theme token: ${ref}`);
});

test("portaled chrome shares the palette aliases with the inner call", () => {
  const shared = css.match(/\.call,\s*\.dockLayer\s*\{([^}]+)\}/)?.[1] ?? "";
  for (const name of ["bg", "panel", "line", "text", "muted", "accent"])
    assert.match(shared, new RegExp(`--call-${name}:\\s*(?:var|color-mix)\\(`));
});

test("the outer header indicator has no hardcoded inline color", () => {
  assert.doesNotMatch(dock, /#[\da-f]{3,8}\b|style=\{\{\s*background/i);
  assert.match(dock, /s\.liveDot/);
  assert.match(css, /\.live\s+\.dot,\s*\.liveDot\s*\{[^}]*var\(--color-emerald-400\)/);
});

test("the primary action and elevation use shared gold tokens", () => {
  assert.match(css, /\.primary\s*\{[^}]*linear-gradient\(180deg, var\(--color-amber-300\), var\(--color-amber-500\)\)/);
  assert.match(css, /box-shadow:\s*var\(--shadow-elev-2\),\s*var\(--shadow-glow-gold\)/);
});

test("the app's success and ember warning colors stay distinguishable", () => {
  assert.match(css, /\.live\s*\{[^}]*var\(--color-emerald-300\)/);
  assert.match(css, /\.error\s*\{[^}]*var\(--color-ember-300\)/);
  assert.match(css, /input::placeholder\s*\{[^}]*var\(--color-stone-500\)/);
});
