// Real production filesystem backend and submission boundary, real SQLite.
// The established pipeline is an explicit fault-injecting test double here;
// this does not substitute for the full authenticated upload HTTP smoke.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { loadReviewModule, sqliteAdapter } from "./lib/review-module.mjs";
const root=path.resolve(import.meta.dirname,"..");
const load=(file,mocks)=>loadReviewModule(path.join(root,file),mocks);
function fixture(fault){
  const dir=mkdtempSync(path.join(os.tmpdir(),"odm-asset-"));const previous=process.env.ODM_MEDIA_ROOT;
  process.env.ODM_MEDIA_ROOT=dir;const storage=load("src/lib/assets/storage.ts").assetStorage();
  if(previous===undefined)delete process.env.ODM_MEDIA_ROOT;else process.env.ODM_MEDIA_ROOT=previous;
  const raw=new DatabaseSync(":memory:"),db=sqliteAdapter(raw),effects=load("src/lib/db/commit-effects.ts");
  db.exec("CREATE TABLE asset_access_grants(id TEXT, job_id TEXT, operation TEXT, staging_key TEXT, status TEXT); CREATE TABLE assets(id TEXT, storage_key TEXT);");
  const bytes=Buffer.from("uploaded image bytes");const staging=storage.writeStaged("upload",bytes,"png");
  db.prepare("INSERT INTO asset_access_grants VALUES ('upload','job','upload',?,'uploaded')").run(staging);
  let serial=0,fail=fault;
  const store={submitResult:()=>{
    const id=`asset${++serial}`;const written=storage.finalizeStaged({stagingKey:staging,campaignId:"campaign",packId:"pack",assetId:id,extension:"png"});
    try{db.transaction(()=>{
      if(fail==="insert"){fail=null;throw Error("insert fault");}
      db.prepare("INSERT INTO assets VALUES (?,?)").run(id,written.storageKey);
      db.exec("UPDATE asset_access_grants SET status='consumed'");
      if(fail==="commit"){fail=null;throw Error("commit fault");}
    })();}catch(error){storage.delete(written.storageKey);throw error;}
    return {asset:{id,...written},duplicate:false};
  }};
  const pipeline=load("src/lib/db/asset-pipeline.ts",{"@/lib/db/asset-pipeline-store":store,"@/lib/db/core":{getDatabase:()=>db},"@/lib/db/commit-effects":effects,"@/lib/assets/storage":{assetStorage:()=>storage}});
  return {db,raw,storage,staging,bytes,effects,pipeline,close:()=>{raw.close();rmSync(dir,{recursive:true,force:true});}};
}
for(const fault of ["insert","commit"])test(`R09: ${fault} failure preserves upload and resubmission succeeds without new bytes`,()=>{
  const f=fixture(fault);try{
    assert.throws(()=>f.pipeline.submitResult({jobId:"job",uploadId:"upload",workerId:"worker"}),/fault/);
    assert.deepEqual(f.storage.read(f.staging),f.bytes);assert.equal(f.db.prepare("SELECT status FROM asset_access_grants").get().status,"uploaded");
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM assets").get().n,0);
    const result=f.pipeline.submitResult({jobId:"job",uploadId:"upload",workerId:"worker"});
    assert.deepEqual(f.storage.read(result.asset.storageKey),f.bytes);assert.equal(f.storage.exists(f.staging),false);
  }finally{f.close();}
});
test("R09: an enclosing rollback cannot consume the staged upload",()=>{
  const f=fixture();try{
    assert.throws(()=>f.effects.withCommittedEffects(()=>f.db.transaction(()=>{
      f.pipeline.submitResult({jobId:"job",uploadId:"upload",workerId:"worker"});throw Error("outer rollback");
    })()),/outer rollback/);
    assert.deepEqual(f.storage.read(f.staging),f.bytes);assert.equal(f.db.prepare("SELECT status FROM asset_access_grants").get().status,"uploaded");
  }finally{f.close();}
});
test("R09: promotion is no-clobber and cannot traverse outside media root",()=>{
  const f=fixture();try{
    const input={stagingKey:f.staging,campaignId:"c",packId:"p",assetId:"a",extension:"png"};
    const result=f.storage.finalizeStaged(input);assert.throws(()=>f.storage.finalizeStaged(input));
    assert.deepEqual(f.storage.read(result.storageKey),f.bytes);assert.deepEqual(f.storage.read(f.staging),f.bytes);
    assert.throws(()=>f.storage.finalizeStaged({...input,assetId:"../bad"}),/Invalid/);
  }finally{f.close();}
});
