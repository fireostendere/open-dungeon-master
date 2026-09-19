import test from 'node:test';
import assert from 'node:assert/strict';
import { domainFixture } from './lib/domain-fixture.mjs';
import { domainModules } from './lib/domain-module.mjs';

function fixture(t) {
  const f=domainFixture(t);
  const actor=userId=>({campaignId:'c',userId,isDm:userId==='dm',memberIds:[...f.members],playerIds:['a','b']});
  const view=current=>({enabled:true,startSeq:1,current:{roomId:f.db.prepare('SELECT room_id FROM spatial_presence WHERE user_id=?').get(current.userId)?.room_id},rooms:[],isDm:current.isDm});
  const load=domainModules({
    '@/lib/spatial/service':{spatialEnabled:id=>id==='c',spatialContext:(_id,userId)=>({actor:actor(userId)}),spatialStore:()=>({view})},
    '@/lib/spatial/domain':{visibleEntity:(campaignId,userId,type,id)=>{const item=f.store.read(campaignId,userId,type,id);return item&&!item.deleted?item.data:null;}},
    '@/lib/db/chapters':{listChaptersVisibleTo:(campaignId,userId)=>f.store.list(campaignId,userId,'chapter').map(row=>row.data)},
  });
  const mod=load('@/lib/spatial/legacy-projection');
  const policy=userId=>mod.spatialLegacyPolicy({campaignId:'c',userId,adjudicates:userId==='dm',ownedCharacterIds:[`pc-${userId}`]});
  return {...f,mod,policy};
}

test('R03/R04: player role is resolved from current actor, not an asserted adjudicates flag',t=>{
  const f=fixture(t);
  assert.equal(f.mod.spatialLegacyPolicy({campaignId:'c',userId:'a',adjudicates:true,ownedCharacterIds:[]}).scoped,true);
  assert.equal(f.policy('dm').scoped,false);
});

test('R03: characterless/foreign rolls and unrelated addressed rows remain hidden',t=>{
  const f=fixture(t),policy=f.policy('a');
  const rolls=[{id:'mine',characterId:'pc-a'},{id:'foreign',characterId:'pc-b'},{id:'unscoped',characterId:null}];
  assert.deepEqual(f.mod.projectSpatialRolls(policy,rolls).map(x=>x.id),['mine']);
  assert.equal(f.mod.projectSpatialRolls(f.policy('dm'),rolls).length,3);
  assert.deepEqual(f.mod.projectSpatialOwnedRows(policy,rolls.slice(0,2)).map(x=>x.id),['mine']);
  assert.deepEqual(f.mod.projectSpatialUserRows(policy,[{userId:'a'},{userId:'b'}]),[{userId:'a'}]);
});

test('R04: a fact list projects the witnessed version instead of trusting manual/sourceSeq labels',t=>{
  const f=fixture(t);
  const v1={id:'f',campaignId:'c',source:'manual',sourceSeq:0,status:'active',knownBy:'party',fact:'OBSERVED_V1'};
  f.store.publish('c','dm','fact','f',v1,{scope:{kind:'room',roomId:'tavern'}});
  f.move('a','street');f.move('b','tavern');
  const v2={...v1,fact:'HIDDEN_V2'};f.store.publish('c','dm','fact','f',v2);
  assert.equal(f.mod.projectSpatialFacts(f.policy('a'),[v2])[0].fact,'OBSERVED_V1');
  assert.equal(f.mod.projectSpatialFacts(f.policy('b'),[v2])[0].fact,'HIDDEN_V2');
  assert.deepEqual(f.mod.projectSpatialFacts(f.policy('a'),[{...v1,id:'unversioned'}]),[]);
});

test('R04: note direct-ID projection and chapter lists use version receipts',t=>{
  const f=fixture(t),v1={id:'n',campaignId:'c',body:'SEEN'};
  f.store.publish('c','dm','note','n',v1,{scope:{kind:'room',roomId:'tavern'}});
  f.move('a','street');const v2={...v1,body:'SECRET'};f.store.publish('c','dm','note','n',v2);
  assert.equal(f.mod.projectSpatialNotes(f.policy('a'),[v2])[0].body,'SEEN');
  assert.deepEqual(f.mod.projectSpatialNotes(f.policy('b'),[v2]),[]);
  f.store.publish('c','dm','chapter','ch',{id:'ch',index:1,summary:'PUBLISHED'},{scope:{kind:'global'}});
  assert.equal(f.mod.projectSpatialChapters(f.policy('a'),[])[0].summary,'PUBLISHED');
});

test('R03: campaign scene, quest, and global floor are not treated as player knowledge',t=>{
  const f=fixture(t);
  const value=f.mod.projectSpatialCampaign(f.policy('a'),{scene:'SECRET',questLog:['SECRET'],floor:{mode:'initiative',currentName:'SECRET'},dmCover:{active:true},party:{location:'SECRET',activity:'SECRET',marchingOrder:['pc-b']}});
  assert.doesNotMatch(JSON.stringify(value),/SECRET/);
});
