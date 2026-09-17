import crypto from "node:crypto";
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export type AssetStorageWrite = { storageKey: string; filename: string };
export interface AssetStorageBackend {
  readonly kind: "filesystem";
  readonly root: string;
  writeStaged(uploadId: string, bytes: Buffer, extension: string): string;
  finalizeStaged(input: { stagingKey: string; campaignId: string; packId: string; assetId: string; extension: string }): AssetStorageWrite;
  read(storageKey: string): Buffer;
  exists(storageKey: string): boolean;
  delete(storageKey: string): void;
}
function safeSegment(value: string, label: string) {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(trimmed)) throw new Error(`Invalid ${label}.`);
  return trimmed;
}
function within(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
export function mediaRoot() {
  return path.resolve(/*turbopackIgnore: true*/ process.env.ODM_MEDIA_ROOT?.trim() || path.join(process.cwd(), "data", "media"));
}
class FilesystemAssetStorage implements AssetStorageBackend {
  readonly kind = "filesystem" as const;
  readonly root = mediaRoot();
  private resolveKey(storageKey: string) {
    const normalized = storageKey.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!normalized || normalized.includes("\0") || normalized.split("/").some((part) => part === ".." || part === ".")) throw new Error("Invalid asset storage key.");
    const absolute = path.resolve(/*turbopackIgnore: true*/ this.root, ...normalized.split("/"));
    if (!within(this.root, absolute)) throw new Error("Asset storage key escapes the media root.");
    return absolute;
  }
  writeStaged(uploadId: string, bytes: Buffer, extension: string) {
    const safeUploadId = safeSegment(uploadId, "upload id");
    const safeExtension = safeSegment(extension.replace(/^\./, ""), "extension");
    mkdirSync(path.join(this.root, ".staging"), { recursive: true });
    const stagingKey = `.staging/${safeUploadId}.${safeExtension}`;
    const destination = this.resolveKey(stagingKey);
    const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, bytes, { flag: "wx", mode: 0o600, flush: true });
      renameSync(temporary, destination);
    } finally {
      if (existsSync(temporary)) rmSync(temporary, { force: true });
    }
    return stagingKey;
  }
  finalizeStaged(input: { stagingKey: string; campaignId: string; packId: string; assetId: string; extension: string }): AssetStorageWrite {
    const source = this.resolveKey(input.stagingKey);
    if (!existsSync(source) || !statSync(source).isFile()) throw new Error("Uploaded staging object is unavailable.");
    const campaignId = safeSegment(input.campaignId, "campaign id");
    const packId = safeSegment(input.packId, "pack id");
    const assetId = safeSegment(input.assetId, "asset id");
    const extension = safeSegment(input.extension.replace(/^\./, ""), "extension");
    const filename = `${assetId}.${extension}`;
    const storageKey = `campaigns/${campaignId}/${packId}/${assetId}/${filename}`;
    const destination = this.resolveKey(storageKey);
    mkdirSync(path.dirname(destination), { recursive: true });
    // Keep the only uploaded copy until the database commit succeeds. On a
    // failed insert/commit the pipeline may delete the destination safely;
    // the uploaded grant can then be submitted again without re-uploading.
    copyFileSync(source, destination, constants.COPYFILE_EXCL);
    return { storageKey, filename };
  }
  read(storageKey: string) { return readFileSync(this.resolveKey(storageKey)); }
  exists(storageKey: string) {
    try { const absolute = this.resolveKey(storageKey); return existsSync(absolute) && statSync(absolute).isFile(); }
    catch { return false; }
  }
  delete(storageKey: string) {
    const absolute = this.resolveKey(storageKey);
    rmSync(absolute, { force: true });
    try { rmSync(path.dirname(absolute), { recursive: false, force: true }); }
    catch { /* A sidecar/variant can legitimately keep the directory in use. */ }
  }
}
let backend: AssetStorageBackend | null = null;
export function assetStorage(): AssetStorageBackend { return (backend ??= new FilesystemAssetStorage()); }
