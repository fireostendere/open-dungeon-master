/**
 * Atomic File & Checkpoint I/O for the Autonomous Narrator Host.
 * Ensures that state transitions and checkpoint writes never leave
 * partially written or corrupted files on sudden power loss or process kill.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function atomicWriteJson(targetPath, data, mode = 0o600) {
  const resolved = path.resolve(targetPath);
  const dir = path.dirname(resolved);
  fs.mkdirSync(dir, { recursive: true });

  const tempName = `.${path.basename(resolved)}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const tempPath = path.join(dir, tempName);

  const payload = JSON.stringify(data, null, 2) + '\n';
  const fd = fs.openSync(tempPath, 'w', mode);
  try {
    fs.writeFileSync(fd, payload, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  try {
    fs.renameSync(tempPath, resolved);
  } catch (err) {
    try { fs.unlinkSync(tempPath); } catch {}
    throw err;
  }

  if (process.platform !== 'win32') {
    try {
      const dirFd = fs.openSync(dir, 'r');
      try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    } catch {}
  }
}

export function readJsonSafe(targetPath, fallback = null) {
  try {
    const raw = fs.readFileSync(targetPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
