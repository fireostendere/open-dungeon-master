/** Resolve schema-2 metadata and available portrait variants without fallbacks. */
export async function resolveCreatureAvatars(manifest, slug, loadJson) {
  if (manifest.schemaVersion !== 2) throw new Error('Unsupported avatar schema');
  if (!Object.hasOwn(manifest.creatures, slug)) return null;
  const shard = manifest.catalogShards[String(manifest.creatures[slug])];
  const metadata = (await loadJson(shard))[slug];
  if (!metadata || metadata.id !== slug) throw new Error('Invalid catalog record');
  const path = manifest.variantRecords[slug];
  const record = path ? await loadJson(path) : {
    id: slug, status: 'pending', variants: [], modes: { normal: [], yolo: [] },
  };
  if (record.id !== slug) throw new Error('Invalid variant record');
  return { ...metadata, ...record };
}
