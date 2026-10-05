// The shine must share the animated glyphs, including wrapped Cyrillic titles.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadReviewModule } from "./lib/review-module.mjs";

const root = path.resolve(import.meta.dirname, "..");
const { FxTitle } = loadReviewModule(path.join(root, "src/components/fx/shared.tsx"), {
  "./fx.css": {}, "@/lib/fx/particles": {}, "@/lib/fx/prefs": {},
});
const css = readFileSync(path.join(root, "src/components/fx/fx.css"), "utf8");
for (const text of ["1 УРОНА", "КРИТИЧЕСКИЙ ПРОМАХ", "ПОБЕДА", "LEVEL UP", "ЙЁЩ"]) {
  for (const variant of ["rise", "drop", "slam"]) {
    const html = renderToStaticMarkup(createElement(FxTitle, { text, variant }));
    assert.ok(html.includes(`aria-label="${text}"`));
    assert.equal((html.match(/class="fx-word"/g) ?? []).length, text.split(" ").length);
    assert.equal((html.match(/style="--i:/g) ?? []).length, Array.from(text).length);
    assert.ok(!html.includes("data-text="), "the shine must not render a second independently laid-out title");
  }
}
assert.ok(!css.includes(".fx-shine::after"), "no detached shine glyphs");
assert.match(css, /background-image: var\(--fx-shine,[^;]+var\(--fx-grad\)/);
assert.match(css, /background-size: 250% 100%, 100% 100%/);
assert.match(css, /animation-name: var\(--fx-letter-enter\)/, "Lite keeps letter entrances without a shine loop");
console.log("fx titles: Cyrillic, word wrapping, all entrance variants and shared shine glyphs passed");
