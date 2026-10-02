import assert from "node:assert/strict";
import { register } from "node:module";
register("./lib/register-alias.mjs", import.meta.url);

const stored = new Map();
const deleted = [];
globalThis.caches = {
  open: async () => ({ match: async url => stored.get(url)?.clone(),
    put: async (url, response) => stored.set(url, response), delete: async url => stored.delete(url) }),
  keys: async () => ["odm-map-art-old", "unrelated-cache"],
  delete: async key => deleted.push(key),
};
let requests = 0;
let fail = false;
globalThis.fetch = async () => {
  requests++;
  if (fail) throw new Error("offline");
  return new Response("image", { headers: { "Content-Type": "image/webp" } });
};
globalThis.Image = class {
  set src(value) { this.url = value; queueMicrotask(() => this.onload()); }
};
const { slowMapConnection, loadAtlasMaterials } = await import("../src/lib/overworld/loading.ts");
assert.equal(slowMapConnection(), false, "browsers without connection information remain usable");
for (const connection of [{ saveData: true }, { effectiveType: "2g" }, { effectiveType: "3g" }, { downlink: 0.5 }, { rtt: 600 }]) {
  assert.equal(slowMapConnection(connection), true);
}
assert.equal(slowMapConnection(undefined, 1600), true, "slow initial response is the fallback for unsupported browsers");
assert.equal(slowMapConnection({ effectiveType: "4g", downlink: 10, rtt: 50 }), false);
assert.equal(await loadAtlasMaterials(["forest"], false), null);
assert.equal(requests, 0, "cold slow connection must not download any artwork");
assert.deepEqual(await Promise.all([loadAtlasMaterials(["forest"], false), loadAtlasMaterials(["water"], false)]), [null, null], "simultaneous cold maps remain usable");
const [first, concurrent] = await Promise.all([loadAtlasMaterials(["forest"], true), loadAtlasMaterials(["forest"], true)]);
assert.ok(first.forest);
assert.equal(first, concurrent, "concurrent opens share decoded textures and renderer cache identity");
assert.equal(requests, 1);
assert.equal(first, await loadAtlasMaterials(["forest"], false), "reopening reuses the same decoded texture set");
assert.deepEqual(deleted, ["odm-map-art-old"], "retire only old atlas artwork caches");

// A new module simulates a page reload: only persistent storage survives.
const reloaded = await import("../src/lib/overworld/loading.ts?reload");
assert.ok((await reloaded.loadAtlasMaterials(["forest"], false)).forest);
assert.equal(requests, 1, "a slow connection can use the disk cache without network");
assert.equal(await reloaded.loadAtlasMaterials(["forest", "water"], false), null, "partial caches keep the lightweight map");
assert.equal(requests, 1);
fail = true;
assert.equal(await reloaded.loadAtlasMaterials(["water"], true), null, "network errors preserve the lightweight fallback");
fail = false;
assert.ok((await reloaded.loadAtlasMaterials(["water"], true)).water, "failed downloads must be retryable");

// Storage can be blocked (private mode); memory caching still works.
globalThis.caches.open = async () => { throw new Error("storage blocked"); };
const blocked = await import("../src/lib/overworld/loading.ts?blocked");
assert.equal(await blocked.loadAtlasMaterials(["plains"], false), null);
assert.ok((await blocked.loadAtlasMaterials(["plains"], true)).plains);

// Low-poly terrain never builds the costly pixel relief or decodes images.
const { drawOverworld } = await import("../src/app/campaigns/[campaignId]/overworldDraw.ts");
let tiles = 0;
const context = new Proxy({}, { get: (_, name) => {
  if (name === "drawImage" || name === "createImageData") return () => assert.fail("low-poly map used an expensive rendering path");
  if (name === "fillRect") return () => tiles++;
  return () => {};
}, set: () => true });
drawOverworld(context, { map: { width: 3, height: 2, terrain: "wpfmhs", paths: [], labels: [], pins: [], partyXy: null }, locations: [] },
  { genre: "high_fantasy", pulse: 0, lowPoly: true, markers: false });
assert.equal(tiles, 6);
console.log("test-map-loading: cold/warm/concurrent/reloaded cache, slow/offline/storage-blocked fallback and low-poly rendering passed");
