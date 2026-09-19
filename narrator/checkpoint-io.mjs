/** Atomic checkpoints. Durable command intent, receipts and cursors keep fsync.
 * Identical narrator state is not rewritten for advisory wall-clock updates.
 * The checkpoint remains a standalone JSON file: no new recovery sidecars.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const recent = new Map();
const advisory = new Set(['updatedAt','uptimeSeconds','lastPollAt','lastError']);
function stamp(file) {
  try { const s=fs.statSync(file); return `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`; }
  catch { return null; }
}
function stateKey(data) {
  if(data?.formatVersion!==3 || !Object.hasOwn(data,'memory'))return null;
  const durable=Object.fromEntries(Object.entries(data).filter(([key])=>!advisory.has(key)));
  return crypto.createHash('sha256').update(JSON.stringify(durable)).digest('hex');
}
export function atomicWriteJson(targetPath, data, mode = 0o600) {
  const started=performance.now(), resolved=path.resolve(targetPath), key=stateKey(data);
  const previous=recent.get(resolved);
  if(key && previous?.key===key && previous.stamp===stamp(resolved)) {
    if(process.env.ODM_LATENCY_LOG==='1')console.error('[odm-latency]',JSON.stringify({stage:'checkpoint',skipped:true,bytes:0,durationMs:Math.round(performance.now()-started)}));
    return {written:false,bytes:0};
  }
  const dir=path.dirname(resolved);
  fs.mkdirSync(dir,{recursive:true});
  const tempPath=path.join(dir,`.${path.basename(resolved)}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  // Whitespace does not improve recovery; compact JSON reduces write volume.
  const payload=JSON.stringify(data)+'\n';
  try {
    const fd=fs.openSync(tempPath,'wx',mode);
    try { fs.writeFileSync(fd,payload,'utf8'); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(tempPath,resolved);
    if(process.platform!=='win32') {
      const dirFd=fs.openSync(dir,'r');
      try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    }
  } catch(error) {
    recent.delete(resolved);
    try { fs.unlinkSync(tempPath); } catch {}
    throw error;
  }
  if(key) {
    if(recent.size>=64)recent.delete(recent.keys().next().value);
    recent.set(resolved,{key,stamp:stamp(resolved)});
  }
  const bytes=Buffer.byteLength(payload);
  if(process.env.ODM_LATENCY_LOG==='1')console.error('[odm-latency]',JSON.stringify({stage:'checkpoint',skipped:false,bytes,durationMs:Math.round(performance.now()-started)}));
  return {written:true,bytes};
}
export function readJsonSafe(targetPath,fallback=null) {
  // External restore invalidates duplicate suppression, even for equal content.
  recent.delete(path.resolve(targetPath));
  try { return JSON.parse(fs.readFileSync(targetPath,'utf8')); }
  catch { return fallback; }
}
