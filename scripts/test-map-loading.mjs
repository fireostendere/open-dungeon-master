import assert from "node:assert/strict";
import { register } from "node:module";
register("./lib/register-alias.mjs", import.meta.url);

const stored = new Map();
const deleted = [];
globalThis.caches = {
  open: async () => ({ match: async url => stored.get(url)?.clone(),
    put: async (url, response) => { stored.delete(url); stored.set(url, response); }, delete: async url => stored.delete(url?.url ?? url),
    keys: async () => [...stored.keys()].map(url => ({ url: new URL(url, "https://odm.test").href })) }),
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

// The finished relief survives a reload: no textures, no pixel loop.
globalThis.caches.open = async () => ({ match: async url => stored.get(url)?.clone(),
  put: async (url, response) => { stored.delete(url); stored.set(url, response); }, delete: async request => stored.delete(new URL(request.url ?? request, "https://odm.test").pathname),
  keys: async () => [...stored.keys()].map(url => ({ url: new URL(url, "https://odm.test").href })) });
globalThis.createImageBitmap = async blob => ({ bitmap: await blob.text() });
const canvas = name => ({ toBlob: (resolve, type) => resolve(new Blob([name], { type })) });
const relief = await import("../src/lib/overworld/loading.ts?relief");
assert.equal(await relief.cachedRelief("map-a"), null, "a map never drawn here has no relief");
await relief.storeRelief("map-a", canvas("relief-a"));
const afterReload = await import("../src/lib/overworld/loading.ts?relief-reload");
assert.deepEqual(await afterReload.cachedRelief("map-a"), { bitmap: "relief-a" }, "reload shows the detailed relief, not low-poly");
assert.equal(await afterReload.cachedRelief("map-b"), null, "another map or viewer projection never reuses it");
for (const name of ["b", "c", "d", "e", "f", "g"]) await afterReload.storeRelief(`map-${name}`, canvas(name));
assert.equal(await afterReload.cachedRelief("map-a"), null, "only the newest reliefs are kept");
assert.deepEqual(await afterReload.cachedRelief("map-g"), { bitmap: "g" });
assert.equal([...stored.keys()].filter(url => url.startsWith("/__odm-relief/")).length, 6);

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
let drawn = null;
const drawing = new Proxy({}, { get: (_, name) => name === "drawImage" ? image => { drawn = image; } : name === "fillRect" ? () => assert.fail("a ready relief drew low-poly") : () => {}, set: () => true });
drawOverworld(drawing, { map: { width: 3, height: 2, terrain: "wpfmhs", paths: [], labels: [], pins: [], partyXy: null }, locations: [] },
  { genre: "high_fantasy", pulse: 0, relief: "relief", lowPoly: true, markers: false });
assert.equal(drawn, "relief", "a ready relief wins over the low-poly grid");
console.log("test-map-loading: cold/warm/concurrent/reloaded cache, persisted relief, slow/offline/storage-blocked fallback and low-poly rendering passed");
