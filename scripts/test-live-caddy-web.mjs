import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const caddy = fs.readFileSync(path.join(root, "deploy/live-caddyfile.example"), "utf8");

test("live Caddy keeps global options first and publishes the browser UI on its own HTTPS hostname", () => {
  assert.equal(caddy.trimStart().startsWith("{\n    auto_https disable_redirects\n}"), true);
  assert.match(caddy, /dnd\.iroslyakov\.com\s*\{/);
  assert.match(caddy, /reverse_proxy 127\.0\.0\.1:3005/);
  assert.match(caddy, /@odm_web_internal path \/api\/internal \/api\/internal\/\*/);
  assert.match(caddy, /respond @odm_web_internal 404/);
});

test("the existing api host keeps LiveKit as its default upstream", () => {
  assert.match(caddy, /api\.iroslyakov\.com\s*\{/);
  assert.match(caddy, /reverse_proxy localhost:3000/);
  assert.match(caddy, /reverse_proxy 127\.0\.0\.1:3006/);
});
