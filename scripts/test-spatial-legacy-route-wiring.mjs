import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');
const route=relative=>{
  const filename=`src/app/api/campaigns/[campaignId]/${relative}/route.ts`;
  const source=read(filename);
  return source+(source.includes("'./legacy-handlers'")?'\n'+read(filename.replace('route.ts','legacy-handlers.ts')):'');
};
test('R02-R04: real route entry points remain wired to version-aware boundaries',()=>{
  assert.match(route('battle-map'),/spatialBattleMapView/);
  for(const [name,projector] of [['facts','projectSpatialFacts'],['notes','listNotesVisibleTo'],['chapters','projectSpatialChapters'],['relationships','projectSpatialOwnedRows'],['item-proposals','projectSpatialUserRows']]) {
    assert.match(route(name),new RegExp(projector),name);
  }
  assert.match(route('notes/[noteId]'),/canMutateSpatialNote/);
  assert.match(route('facts'),/withEntityRequest/);
  assert.match(route('export'),/buildStoryDocument\(campaignId,\s*context\.user\.id\)/);
  assert.match(route('entities'),/domainStore\(\)\.list/);
  assert.match(route('entities/[entityType]/[entityId]'),/domainStore\(\)\.read/);
  assert.match(read('src/lib/db/notes.ts'),/captureNoteVersion/);
  assert.match(read('src/lib/db/facts.ts'),/publishEntity/);
  assert.match(read('src/lib/db/snapshots.ts'),/restoreCanonicalDomainRows/);
});
