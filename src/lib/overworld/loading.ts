import { TERRAIN_ASSETS, type TerrainMaterial } from "./cartography";
import type { AtlasMaterials } from "@/app/campaigns/[campaignId]/overworldDraw";

type Connection = { saveData?: boolean; effectiveType?: string; downlink?: number; rtt?: number };
export function slowMapConnection(connection?: Connection, responseMs = 0) {
  return Boolean(connection?.saveData || ["slow-2g", "2g", "3g"].includes(connection?.effectiveType ?? "") ||
    (connection?.downlink !== undefined && connection.downlink < 1.5) || (connection?.rtt ?? 0) > 500 || responseMs > 1500);
}

const cacheName = `odm-map-art-${process.env.NEXT_PUBLIC_MAP_ART_VERSION ?? "dev"}`;
let storage: Promise<Cache | null> | undefined;
function artCache() {
  return storage ??= (async () => {
    try {
      const cache = await caches.open(cacheName);
      for (const key of await caches.keys()) {
        if (key.startsWith("odm-map-art-") && key !== cacheName) await caches.delete(key);
      }
      return cache;
    } catch { return null; }
  })();
}

const images = new Map<string, Promise<HTMLImageElement | null>>();
// Only bundled public artwork enters persistent storage. Campaign projections
// and uploaded backdrops keep their existing authorization and cache policy.
async function materialImage(kind: TerrainMaterial, allowNetwork: boolean) {
  const url = `${TERRAIN_ASSETS[kind]}?v=${process.env.NEXT_PUBLIC_MAP_ART_VERSION ?? "dev"}`;
  const previous = images.get(url);
  if (previous) return previous;
  const pending = (async () => {
    const cache = await artCache();
    let response = await cache?.match(url).catch(() => undefined);
    if (!response) {
      if (!allowNetwork) return null;
      response = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) return null;
      await cache?.put(url, response.clone()).catch(() => undefined);
    }
    const objectUrl = URL.createObjectURL(await response.blob());
    return await new Promise<HTMLImageElement | null>(resolve => {
      const image = new Image();
      image.onload = () => { URL.revokeObjectURL(objectUrl); resolve(image); };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        void cache?.delete(url).catch(() => undefined);
        resolve(null);
      };
      image.src = objectUrl;
    });
  })().catch(() => null);
  images.set(url, pending);
  const image = await pending;
  if (!image) images.delete(url); // A cache miss or broken connection can recover.
  return image;
}

// ponytail: keep the last material set; a multi-map gallery can use an LRU.
let materialSet: { key: string; value: Promise<AtlasMaterials | null> } | undefined;
export async function loadAtlasMaterials(kinds: TerrainMaterial[], allowNetwork: boolean) {
  const key = [...new Set(kinds)].sort().join(",");
  if (materialSet?.key === key) return materialSet.value;
  const value = (async () => {
    const entries = await Promise.all(key.split(",").filter(Boolean).map(async name =>
      [name, await materialImage(name as TerrainMaterial, allowNetwork)] as const));
    if (!entries.length || entries.some(([, image]) => !image)) return null;
    return Object.fromEntries(entries) as AtlasMaterials;
  })();
  materialSet = { key, value };
  const result = await value;
  if (!result && materialSet?.value === value) materialSet = undefined;
  return result;
}
