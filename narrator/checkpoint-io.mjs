/** Atomic checkpoints. Durable command intent, receipts and cursors keep fsync.
 * Identical narrator state is not rewritten for advisory wall-clock updates.
 * The checkpoint remains a standalone JSON file: no new recovery sidecars.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { emitLatency, latencyEnabled, withLatencyTrace } from '../mcp/latency-trace.mjs';
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
  return withLatencyTrace(() => {
    const timing=latencyEnabled(), started=timing?performance.now():0, resolved=path.resolve(targetPath);
    const keyStarted=timing?performance.now():0, key=stateKey(data), keyMs=timing?performance.now()-keyStarted:0;
    const previous=recent.get(resolved);
    if(key && previous?.key===key && previous.stamp===stamp(resolved)) {
      if(timing)emitLatency({stage:'checkpoint_serialize',durationMs:keyMs,bytes:0,skipped:true});
      return {written:false,bytes:0};
    }
    // Whitespace does not improve recovery; compact JSON reduces write volume.
    const payloadStarted=timing?performance.now():0, payload=JSON.stringify(data)+'\n', bytes=Buffer.byteLength(payload), payloadMs=timing?performance.now()-payloadStarted:0;
    if(timing)emitLatency({stage:'checkpoint_serialize',durationMs:keyMs+payloadMs,bytes});
    const dir=path.dirname(resolved);
    fs.mkdirSync(dir,{recursive:true});
    const tempPath=path.join(dir,`.${path.basename(resolved)}.${crypto.randomBytes(6).toString('hex')}.tmp`);
    try {
      const fd=fs.openSync(tempPath,'wx',mode);
      try { fs.writeFileSync(fd,payload,'utf8'); const fsyncStarted=timing?performance.now():0; fs.fsyncSync(fd); if(timing)emitLatency({stage:'checkpoint_file_fsync',durationMs:performance.now()-fsyncStarted,bytes}); }
      finally { fs.closeSync(fd); }
      fs.renameSync(tempPath,resolved);
      if(process.platform!=='win32') {
        const dirFd=fs.openSync(dir,'r');
        try { const fsyncStarted=timing?performance.now():0; fs.fsyncSync(dirFd); if(timing)emitLatency({stage:'checkpoint_directory_fsync',durationMs:performance.now()-fsyncStarted}); } finally { fs.closeSync(dirFd); }
      }
    } catch(error) {
      recent.delete(resolved);
      try { fs.unlinkSync(tempPath); } catch {}
      if(timing)emitLatency({stage:'checkpoint_write',durationMs:performance.now()-started,attemptCount:1,errorCount:1,writeCount:0,ok:false});
      throw error;
    }
    if(key) {
      if(recent.size>=64)recent.delete(recent.keys().next().value);
      recent.set(resolved,{key,stamp:stamp(resolved)});
    }
    if(timing)emitLatency({stage:'checkpoint_write',durationMs:performance.now()-started,attemptCount:1,writeCount:1,ok:true});
    return {written:true,bytes};
  });
}
export function readJsonSafe(targetPath,fallback=null) {
  // External restore invalidates duplicate suppression, even for equal content.
  recent.delete(path.resolve(targetPath));
  try { return JSON.parse(fs.readFileSync(targetPath,'utf8')); }
  catch { return fallback; }
}
