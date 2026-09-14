import crypto from "node:crypto";

export const ASSET_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type AssetMimeType = (typeof ASSET_MIME_TYPES)[number];

export type InspectedImage = {
  mimeType: AssetMimeType;
  extension: "png" | "jpg" | "webp";
  width: number;
  height: number;
  byteSize: number;
  sha256: string;
};

function assertDimensions(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("Image has invalid dimensions.");
  }
  if (width > 32_768 || height > 32_768 || width * height > 268_435_456) {
    throw new Error("Image dimensions exceed ODM safety limits.");
  }
}

function inspectPng(bytes: Buffer): { width: number; height: number } | null {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(signature)) return null;
  let offset = 8;
  let width = 0;
  let height = 0;
  let sawIhdr = false;
  let sawIend = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    const end = offset + 12 + length;
    if (end > bytes.length) throw new Error("Corrupted PNG chunk length.");
    if (!sawIhdr) {
      if (type !== "IHDR" || length !== 13) throw new Error("Corrupted PNG header.");
      width = bytes.readUInt32BE(offset + 8);
      height = bytes.readUInt32BE(offset + 12);
      sawIhdr = true;
    }
    if (type === "IEND") {
      if (length !== 0) throw new Error("Corrupted PNG IEND chunk.");
      sawIend = true;
      if (end !== bytes.length) throw new Error("PNG contains trailing data after IEND.");
      break;
    }
    offset = end;
  }
  if (!sawIhdr || !sawIend) throw new Error("Corrupted PNG: missing required chunks.");
  assertDimensions(width, height);
  return { width, height };
}

const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function inspectJpeg(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  if (bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
    throw new Error("Corrupted JPEG: missing EOI marker.");
  }
  let offset = 2;
  let width = 0;
  let height = 0;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) throw new Error("Corrupted JPEG marker stream.");
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;
    const marker = bytes[offset]!;
    offset += 1;
    if (marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) throw new Error("Corrupted JPEG segment.");
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) throw new Error("Corrupted JPEG segment length.");
    if (JPEG_SOF.has(marker)) {
      if (length < 7) throw new Error("Corrupted JPEG SOF segment.");
      height = bytes.readUInt16BE(offset + 3);
      width = bytes.readUInt16BE(offset + 5);
      break;
    }
    if (marker === 0xda) break;
    offset += length;
  }
  if (!width || !height) throw new Error("Corrupted JPEG: dimensions not found.");
  assertDimensions(width, height);
  return { width, height };
}

function readUInt24LE(bytes: Buffer, offset: number) {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
}

function inspectWebp(bytes: Buffer): { width: number; height: number } | null {
  if (
    bytes.length < 20 ||
    bytes.subarray(0, 4).toString("ascii") !== "RIFF" ||
    bytes.subarray(8, 12).toString("ascii") !== "WEBP"
  ) {
    return null;
  }
  if (bytes.readUInt32LE(4) + 8 !== bytes.length) {
    throw new Error("Corrupted WebP RIFF length.");
  }
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = bytes.subarray(offset, offset + 4).toString("ascii");
    const length = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + length;
    if (end > bytes.length) throw new Error("Corrupted WebP chunk length.");
    if (type === "VP8X") {
      if (length < 10) throw new Error("Corrupted WebP VP8X chunk.");
      const width = readUInt24LE(bytes, start + 4) + 1;
      const height = readUInt24LE(bytes, start + 7) + 1;
      assertDimensions(width, height);
      return { width, height };
    }
    if (type === "VP8L") {
      if (length < 5 || bytes[start] !== 0x2f) throw new Error("Corrupted WebP VP8L chunk.");
      const b1 = bytes[start + 1]!;
      const b2 = bytes[start + 2]!;
      const b3 = bytes[start + 3]!;
      const b4 = bytes[start + 4]!;
      const width = 1 + ((b1 | (b2 << 8)) & 0x3fff);
      const height = 1 + (((b2 >> 6) | (b3 << 2) | (b4 << 10)) & 0x3fff);
      assertDimensions(width, height);
      return { width, height };
    }
    if (type === "VP8 ") {
      if (
        length < 10 ||
        bytes[start + 3] !== 0x9d ||
        bytes[start + 4] !== 0x01 ||
        bytes[start + 5] !== 0x2a
      ) {
        throw new Error("Corrupted WebP VP8 chunk.");
      }
      const width = bytes.readUInt16LE(start + 6) & 0x3fff;
      const height = bytes.readUInt16LE(start + 8) & 0x3fff;
      assertDimensions(width, height);
      return { width, height };
    }
    offset = end + (length % 2);
  }
  throw new Error("Corrupted WebP: image dimensions not found.");
}

export function inspectImage(bytes: Buffer): InspectedImage {
  if (!bytes.length) throw new Error("Image is empty.");
  const png = inspectPng(bytes);
  const jpeg = png ? null : inspectJpeg(bytes);
  const webp = png || jpeg ? null : inspectWebp(bytes);
  const dimensions = png ?? jpeg ?? webp;
  if (!dimensions) throw new Error("Unsupported image format. Only PNG, JPEG and WebP are accepted.");
  const mimeType: AssetMimeType = png ? "image/png" : jpeg ? "image/jpeg" : "image/webp";
  const extension = png ? "png" : jpeg ? "jpg" : "webp";
  return {
    mimeType,
    extension,
    width: dimensions.width,
    height: dimensions.height,
    byteSize: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}

export function isAssetMimeType(value: unknown): value is AssetMimeType {
  return (ASSET_MIME_TYPES as readonly unknown[]).includes(value);
}
