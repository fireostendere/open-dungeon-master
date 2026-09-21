// Server inference was removed; lore and note retrieval are lexical now.
// Keep the old storage hook harmless for rows written by older releases.
export async function embed(_texts: string[]): Promise<Float32Array[]> {
  return [];
}

export function vectorToBuffer(_vector: Float32Array): Buffer {
  return Buffer.alloc(0);
}
