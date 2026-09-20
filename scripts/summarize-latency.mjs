#!/usr/bin/env node
import fs from 'node:fs';
import { LATENCY_STAGES } from '../mcp/latency-trace.mjs';

const fields = ['bytes', 'inputBytes', 'outputBytes', 'responseBytes', 'modelCalls', 'mcpCalls', 'hits', 'loads', 'attemptCount', 'errorCount'];
const values = new Map(), files = process.argv.slice(2);
if (!files.length) { console.error('Usage: node scripts/summarize-latency.mjs <log...>'); process.exitCode = 2; }
for (const file of files) for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
  const raw = line.startsWith('[odm-latency] ') ? line.slice(14) : line;
  try {
    const event = JSON.parse(raw);
    if (!LATENCY_STAGES.has(event.stage) || !Number.isFinite(event.durationMs) || event.durationMs < 0) continue;
    const role = ['referee', 'writer'].includes(event.role) ? event.role : '-';
    const key = `${event.stage}\t${role}`, item = values.get(key) ?? { stage: event.stage, role, durations: [], bytes: 0, inputBytes: 0, outputBytes: 0, responseBytes: 0, modelCalls: 0, mcpCalls: 0, hits: 0, loads: 0, checkpointWrites: 0, attemptCount: 0, errorCount: 0 };
    item.durations.push(event.durationMs);
    for (const field of fields) if (Number.isFinite(event[field]) && event[field] >= 0) item[field] += Math.round(event[field]);
    if (event.stage === 'checkpoint_write' && Number.isFinite(event.writeCount) && event.writeCount >= 0) item.checkpointWrites += Math.round(event.writeCount);
    values.set(key, item);
  } catch {}
}
const percentile = (sorted, p) => { const index = (sorted.length - 1) * p, low = Math.floor(index), high = Math.ceil(index); return sorted[low] + (sorted[high] - sorted[low]) * (index - low); };
const milliseconds = value => percentile(value, .5).toFixed(3);
console.log('stage\trole\tcount\tp50Ms\tp95Ms\tbytes\tinputBytes\toutputBytes\tresponseBytes\tmodelCalls\tmcpCalls\thits\tloads\tcheckpointWrites\tattempts\terrors');
for (const item of [...values.values()].sort((a, b) => a.stage.localeCompare(b.stage) || a.role.localeCompare(b.role))) {
  item.durations.sort((a, b) => a - b);
  console.log(`${item.stage}\t${item.role}\t${item.durations.length}\t${milliseconds(item.durations)}\t${percentile(item.durations, .95).toFixed(3)}\t${item.bytes}\t${item.inputBytes}\t${item.outputBytes}\t${item.responseBytes}\t${item.modelCalls}\t${item.mcpCalls}\t${item.hits}\t${item.loads}\t${item.checkpointWrites}\t${item.attemptCount}\t${item.errorCount}`);
}
