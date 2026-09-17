import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";
register("./lib/register-alias.mjs", import.meta.url);
const { trustedPortalFromCookies } = await import("../src/lib/portal-trust.ts");
const token = "abcdefghijklmnopqrstuvwxyz0123456789_-";
const config = { enabled: "1", origin: "http://192.168.1.50:3005", token };
const read = (origin = config.origin, bearer = token) => (name) => ({
  odm_portal_origin: origin, odm_portal_token: bearer,
})[name];

test("R01: public-server default never authorizes portal cookies", () => {
  for (const origin of ["http://127.0.0.1", "http://169.254.169.254", "http://10.0.0.1", "https://example.com"]) {
    assert.equal(trustedPortalFromCookies(read(origin), {}), null);
    assert.equal(trustedPortalFromCookies(read(origin), { ...config, enabled: "0" }), null);
  }
});
test("R01: trusted local portal preserves explicitly configured LAN destination", () => {
  assert.deepEqual(trustedPortalFromCookies(read(), config), { origin: config.origin, token });
});
test("R01: client cannot switch destination or supply an arbitrary bearer", () => {
  assert.equal(trustedPortalFromCookies(read("http://127.0.0.1"), config), null);
  assert.equal(trustedPortalFromCookies(read(config.origin, "a".repeat(token.length)), config), null);
  assert.equal(trustedPortalFromCookies(read(config.origin, "short"), config), null);
  assert.equal(trustedPortalFromCookies(() => undefined, config), null);
});
test("R01: opt-in with incomplete or malformed trusted configuration fails closed", () => {
  for (const invalid of [{ enabled: "1" }, { ...config, origin: "http://x/path" }, { ...config, token: "" }]) {
    assert.equal(trustedPortalFromCookies(read(), invalid), null);
  }
});
