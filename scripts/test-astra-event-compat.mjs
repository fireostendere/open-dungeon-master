import test from 'node:test';
import assert from 'node:assert/strict';
import { astraHarness } from './lib/astra-harness.mjs';
test('old audience_json receipts retain metadata and presence redactions after consolidation',async t=>{
 const f=await astraHarness(t);
 f.events.publishPersisted('c','message_added',{message:{content:'(ooc) initialize'}});
 const insert=(type,payload)=>{
  const seq=f.campaigns.allocateSeq('c');
  f.db.prepare('INSERT INTO campaign_events VALUES(?,?,?,?,?,?)').run('c',seq,type,JSON.stringify(payload),'now',JSON.stringify({version:1,userIds:['a']}));
  return {seq,type,payload};
 };
 const projector=f.policy.campaignEventProjector('c','a');
 const metadata=projector.projectEvent(insert('campaign_updated',{title:'Public title',scene:'HIDDEN_SCENE',floor:{secret:'HIDDEN_FLOOR'}}));
 assert.equal(metadata.payload.title,'Public title');assert.doesNotMatch(JSON.stringify(metadata),/HIDDEN_/);
 const presence=projector.projectEvent(insert('presence',{online:['a','REMOVED_MEMBER']}));
 assert.deepEqual(Array.from(presence.payload.online),['a']);
 const roll=projector.projectEvent(insert('roll_result',{roll:{visibility:'blind',total:18,dc:15,success:true,breakdown:{dice:[18]}}}));
 assert.equal(roll.payload.roll.total,null);assert.equal(roll.payload.roll.dc,null);
});
