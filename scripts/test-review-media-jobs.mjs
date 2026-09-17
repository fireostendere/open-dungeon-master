// Actual durable job store + actual worker, real SQLite, temporary media files.
// Image/TTS providers and existing game mappers are explicit test doubles.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { loadReviewModule, sqliteAdapter } from "./lib/review-module.mjs";
const root = path.resolve(import.meta.dirname, "..");
const load = (name, mocks) => loadReviewModule(path.join(root, name), mocks);
function fixture() {
  const raw = new DatabaseSync(":memory:");
  const db = sqliteAdapter(raw);
  db.exec(`PRAGMA foreign_keys=ON; CREATE TABLE campaigns(id TEXT PRIMARY KEY); INSERT INTO campaigns VALUES ('c');
    CREATE TABLE output(id TEXT PRIMARY KEY, value TEXT); CREATE TABLE notices(value TEXT);`);
  const dir = mkdtempSync(path.join(os.tmpdir(), "odm-media-"));
  const effects = load("src/lib/db/commit-effects.ts");
  const store = load("src/lib/db/dm-media-jobs.ts", { "@/lib/db/core": { getDatabase: () => db }, "@/lib/db/commit-effects": effects });
  const state = { calls: 0, audioCalls: 0, fail: false, afterGenerate: null, delivered: [],
    imageRequest: { prompt: "forest" }, manual: null, location: { id: "l", campaignId: "c", name: "Cave", layoutDescription: "two rooms", mapImage: null } };
  const campaign = { id: "c", settings: { imageGenerationEnabled: true, imageMode: "fast", aspect: "square" }, gameSettings: { ttsEnabled: true, mapsEnabled: true } };
  const getOutput = (id) => { const row = db.prepare("SELECT value FROM output WHERE id=?").get(id); return row ? JSON.parse(row.value) : undefined; };
  const putOutput = (id, value) => { db.prepare("INSERT OR REPLACE INTO output VALUES (?,?)").run(id, JSON.stringify(value)); return true; };
  const message = () => ({ id: "m", campaignId: "c", content: "A checked scene.", imageRequest: state.imageRequest, generatedImage: state.manual || getOutput("m") });
  const audioPath = (_, id) => path.join(dir, `${id}.mp3`);
  const worker = load("src/lib/dm/media-jobs.ts", {
    "@/lib/db/commit-effects": effects, "@/lib/db/dm-media-jobs": store,
    "@/lib/db/campaigns": { getCampaignById: () => campaign },
    "@/lib/db/messages": { getCampaignMessage: message, setMessageGeneratedImage: putOutput },
    "@/lib/db/locations": { getLocation: () => ({ ...state.location, mapImage: getOutput("l") ?? state.location.mapImage }), setLocationMap: putOutput },
    "@/lib/image-generate": { imageProducerReady: () => true, generateStoryImage: async () => {
      state.calls++; if (state.fail) throw Error("provider fault"); state.afterGenerate?.(); return { id: `image${state.calls}`, url: "/generated/test.png" };
    } },
    "@/lib/dm/images": { publishMediaStatus: () => {} },
    "@/lib/worlds/preset": { presetFor: () => ({ mapStyle: "ink" }) },
    "@/lib/media-queue": { enqueueMediaJob: async (_, work) => { try { await work(); } catch {} } },
    "@/lib/tts": { narrationAudioPath: audioPath, renderNarrationSpeech: async () => { state.audioCalls++; return Buffer.from("AUDIO"); },
      writeNarrationAudio: (c, id, data) => writeFileSync(audioPath(c,id),data) },
    "@/lib/events": { publishPersisted: (_, name) => {
      db.prepare("INSERT INTO notices VALUES (?)").run(name); effects.afterCommit(() => state.delivered.push(name));
    } },
  });
  return { raw, db, dir, state, effects, store, worker, getOutput, audioPath,
    close: () => { worker.stopDmMediaRunner(); raw.close(); rmSync(dir,{recursive:true,force:true}); } };
}

test("R08 media: rollback leaves no intent; duplicate durable intent has one job", () => {
  const f=fixture(); try {
    assert.throws(() => f.effects.withCommittedEffects(() => f.db.transaction(() => { f.store.insertDmMediaIntent("c",{kind:"image",targetId:"m"}); throw Error("rollback"); })()), /rollback/);
    const a=f.store.insertDmMediaIntent("c",{kind:"image",targetId:"m"});
    assert.equal(a,f.store.insertDmMediaIntent("c",{kind:"image",targetId:"m"}));
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM dm_media_jobs").get().n,1);
  } finally {f.close();}
});
test("R08 media: expired claim is reclaimed and stale worker cannot commit", () => {
  const f=fixture(); try {
    f.store.insertDmMediaIntent("c",{kind:"image",targetId:"m"},0);
    const first=f.store.claimDmMediaJob("gpu",1); assert.ok(first);
    assert.equal(f.store.claimDmMediaJob("gpu",2),null);
    const second=f.store.claimDmMediaJob("gpu",180002); assert.ok(second);
    assert.notEqual(first.owner,second.owner);
    assert.throws(() => f.store.completeDmMediaJob(first,()=>assert.fail("stale output"),180003),/lease/);
    f.store.completeDmMediaJob(second,()=>f.db.exec("INSERT INTO output VALUES ('m','1')"),180003);
    f.store.completeDmMediaJob(second,()=>assert.fail("duplicate output"),180004);
    assert.equal(f.getOutput("m"),1);
  } finally {f.close();}
});
test("R08 media: completion failure rolls back output, receipt and subscriber notification", () => {
  const f=fixture(); try {
    f.store.insertDmMediaIntent("c",{kind:"image",targetId:"m"},0);
    const job=f.store.claimDmMediaJob("gpu",1);
    assert.throws(()=>f.store.completeDmMediaJob(job,()=>{
      f.db.exec("INSERT INTO output VALUES ('m','1')");f.effects.afterCommit(()=>f.state.delivered.push("ghost"));throw Error("db fault");
    },2),/db fault/);
    assert.equal(f.getOutput("m"),undefined);assert.deepEqual(f.state.delivered,[]);
    assert.equal(f.db.prepare("SELECT status FROM dm_media_jobs").get().status,"running");
  } finally {f.close();}
});
test("R08 media: actual worker completes persisted image and TTS once across repeated ticks",async()=>{
  const f=fixture();try{
    f.store.insertDmMediaIntent("c",{kind:"image",targetId:"m"});
    f.store.insertDmMediaIntent("c",{kind:"tts",targetId:"m",voice:"v"});
    await f.worker.runDmMediaJobsOnce();await f.worker.runDmMediaJobsOnce();
    assert.equal(f.state.calls,1);assert.equal(f.state.audioCalls,1);
    assert.equal(f.getOutput("m").id,"image1");assert.equal(readFileSync(f.audioPath("c","m"),"utf8"),"AUDIO");
    assert.deepEqual(f.state.delivered.sort(),["image_ready","tts_ready"]);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM dm_media_jobs WHERE status='done'").get().n,2);
  }finally{f.close();}
});
test("R08 media: provider failure remains retriable instead of losing the job",async()=>{
  const f=fixture();try{
    f.store.insertDmMediaIntent("c",{kind:"image",targetId:"m"});f.state.fail=true;
    await f.worker.runDmMediaJobsOnce();assert.equal(f.state.calls,1);
    assert.equal(f.db.prepare("SELECT status FROM dm_media_jobs").get().status,"pending");
    assert.deepEqual(f.state.delivered,[]);f.state.fail=false;
    f.db.exec("UPDATE dm_media_jobs SET available_at=0");await f.worker.runDmMediaJobsOnce();
    assert.equal(f.state.calls,2);assert.equal(f.db.prepare("SELECT status FROM dm_media_jobs").get().status,"done");
  }finally{f.close();}
});
test("R08 media: manual art and changed layouts are never overwritten",async()=>{
  const f=fixture();try{
    f.store.insertDmMediaIntent("c",{kind:"image",targetId:"m"});
    f.state.afterGenerate=()=>{f.state.manual={id:"manual"};};
    await f.worker.runDmMediaJobsOnce();assert.equal(f.getOutput("m"),undefined);
    f.store.insertDmMediaIntent("c",{kind:"map",targetId:"l",name:"Cave",layout:"old layout",previousImageId:null});
    await f.worker.runDmMediaJobsOnce();assert.equal(f.state.calls,1);assert.equal(f.getOutput("l"),undefined);
    assert.deepEqual(f.state.delivered,[]);
  }finally{f.close();}
});
test("R08 media: retries are bounded and leases cannot be resurrected after expiry",()=>{
  const f=fixture();try{
    f.store.insertDmMediaIntent("c",{kind:"image",targetId:"m"},0);
    let now=1;
    for(let n=1;n<=5;n++){
      const job=f.store.claimDmMediaJob("gpu",now);assert.equal(job.attempts,n);
      assert.equal(f.store.renewDmMediaLease(job,now+180001),false);
      assert.equal(f.store.failDmMediaJob(job,"failure",now),true);now+=3600001;
    }
    assert.equal(f.store.claimDmMediaJob("gpu",now),null);
    assert.equal(f.db.prepare("SELECT status FROM dm_media_jobs").get().status,"failed");
  }finally{f.close();}
});
