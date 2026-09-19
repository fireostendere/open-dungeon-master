// Synthetic data-path benchmark, not a model/RAG or production latency claim.
import { DatabaseSync } from 'node:sqlite';
import { readNarratorSections } from '../src/lib/mcp-read-sections.mjs';
import { projectionDigest } from '../src/lib/db/revision-cache.mjs';
import { atomicWriteJson } from '../narrator/checkpoint-io.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const db=new DatabaseSync(':memory:');
const counts={character_sheets:8,world_facts:250,campaign_notes:20,npcs:100};
for(const [table,count]of Object.entries(counts)) {
  db.exec(`CREATE TABLE ${table}(id TEXT PRIMARY KEY,campaign_id TEXT,body TEXT)`);
  const insert=db.prepare(`INSERT INTO ${table} VALUES(?,?,?)`);
  for(let i=0;i<count;i++)insert.run(`${table}-${i}`,'bench',JSON.stringify({text:'fixture '.repeat(160),hp:10,inventory:[{name:'torch',count:2}]}));
}
db.exec('CREATE TABLE homebrew_entries(id TEXT PRIMARY KEY,body TEXT)');
let loads=0;
const tableBySection={sheets:'character_sheets',facts:'world_facts',notes:'campaign_notes',npcs:'npcs'};
const loaders=Object.fromEntries(Object.entries(tableBySection).map(([section,table])=>[section,()=>{
  loads++;return db.prepare(`SELECT id,body FROM ${table} WHERE campaign_id=? ORDER BY id`).all('bench').map(row=>({id:row.id,...JSON.parse(row.body)}));
}]));
const settings={db,campaignId:'bench',timelineEpoch:'test',principal:'dm',live:true,delta:true,loaders};
const baseline=()=>{
  const versions={};for(const [section,load]of Object.entries(loaders))versions[section]=projectionDigest({campaignId:'bench',timelineEpoch:'test',section,content:load()});return versions;
};
function measure(work){loads=0;const samples=[];for(let i=0;i<100;i++){const started=performance.now();work();samples.push(performance.now()-started);}samples.sort((a,b)=>a-b);return {reads:100,sectionLoads:loads,medianMs:+samples[50].toFixed(3),p95Ms:+samples[95].toFixed(3)};}
const expected=baseline(),first=readNarratorSections(settings);
if(JSON.stringify(expected)!==JSON.stringify(first.sectionVersions))throw new Error('Benchmark changed output semantics');
const uncached=measure(baseline),cached=measure(()=>readNarratorSections({...settings,knownSections:first.sectionVersions}));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'odm-bench-'));
try{
 const file=path.join(dir,'checkpoint.json'),data={formatVersion:3,memory:{messages:Array.from({length:60},(_,i)=>({id:i,text:'fixture '.repeat(100)}))},lastSeq:60};
 let writes=0,bytes=0;for(let i=0;i<100;i++){const result=atomicWriteJson(file,{...data,lastPollAt:i,updatedAt:String(i)});if(result.written)writes++;bytes+=result.bytes;}
 console.log(JSON.stringify({kind:'synthetic-only',node:process.version,fixture:counts,uncached,cached,idleCheckpoints:{attempts:100,durableWrites:writes,bytes}},null,2));
}finally{db.close();fs.rmSync(dir,{recursive:true,force:true});}
