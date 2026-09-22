import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRolePacketDelta, createRolePacketDelta, ROLE_DELTA_FORMAT } from '../narrator/role-delta.mjs';
import { NarratorOrchestrator } from '../narrator/orchestration.mjs';
import { compactRolePacket } from '../narrator/role-packet.mjs';

const before={
  // Enough unchanged policy to exercise the beneficial-delta branch.
  instructions:'Server mechanics are authoritative. Preserve initiative, confirmed dice, scopes and player agency. '.repeat(12),
  input:{id:'m1',seq:1,content:'attack'},
  campaign:{scene:'gate',clock:{day:1,hour:8}},
  state:{
    sheets:[{id:'hero',currentHp:12,ac:16},{id:'cleric',currentHp:9,ac:15}],
    encounter:{encounter:{id:'enc',round:1},enemies:[{id:'goblin',currentHp:7,ac:13}]},
    facts:[{id:'f1',fact:'door locked'}],
  },
  outcomes:[],
  actions:[{name:'game',operations:[{name:'pc_attack'}]}],
};
const after={
  ...before,
  campaign:{...before.campaign,clock:{day:1,hour:9}},
  state:{
    ...before.state,
    sheets:[{id:'hero',currentHp:10,ac:16},{id:'cleric',currentHp:9,ac:15}],
    encounter:{...before.state.encounter,enemies:[{id:'goblin',currentHp:2,ac:13}]},
  },
  outcomes:[{name:'pc_attack',result:{hit:true,damage:5}}],
};

test('role packet delta reconstructs nested entity and scalar changes exactly',()=>{
  const delta=createRolePacketDelta(before,after);
  assert.equal(delta.format,ROLE_DELTA_FORMAT);
  assert.deepEqual(applyRolePacketDelta(before,delta),after);
  assert.equal(delta.patch.objects.state.entities.sheets.upsert.length,1);
  assert.equal(delta.patch.objects.state.entities.sheets.upsert[0].currentHp,10);
  assert.equal(delta.patch.objects.state.objects.encounter.entities.enemies.upsert[0].currentHp,2);
  assert.equal(delta.patch.objects.campaign.objects.clock.set.hour,9);
  assert.ok(Buffer.byteLength(JSON.stringify(delta)) < Buffer.byteLength(JSON.stringify(after)));
});

test('orchestrator keeps one referee session and sends only a delta on the next step',async()=>{
  const prompts=[],options=[],released=[];
  const adapter={
    runtimeSource:'custom-opencode',
    releaseConversation:key=>{released.push(key);return true;},
    instructionBytes:()=>100,
    generateWithUsage:async(role,prompt,opts)=>{
      prompts.push({role,prompt});options.push(opts);
      return {text:'{"kind":"wait"}',usage:null};
    },
    generate:async()=>{throw new Error('generate fallback should not be used');},
  };
  const controller=new NarratorOrchestrator({adapter,startAfterSeq:0,maxSteps:4,maxCallsPerHour:20});
  controller.state.epoch='e'.repeat(64);
  controller.state.current={input:{id:'m1',seq:1,content:'attack'},steps:0,outcomes:[],waiting:[],resolved:{},waitSeq:null};
  const host={
    saveCheckpoint(){},
    costTracker:{checkBudget:()=>({allowed:true}),recordUsage(){}},
  };

  await controller.generate(host,'referee',before);
  await controller.generate(host,'referee',after);
  assert.equal(prompts.length,2);
  assert.notEqual(JSON.parse(prompts[0].prompt).format,ROLE_DELTA_FORMAT);
  const delta=JSON.parse(prompts[1].prompt);
  assert.equal(delta.format,ROLE_DELTA_FORMAT);
  assert.deepEqual(applyRolePacketDelta(JSON.parse(prompts[0].prompt),delta),JSON.parse(JSON.stringify(compactRolePacket('referee',after))));
  assert.equal(options[0].sessionKey,options[1].sessionKey);
  assert.match(options[0].sessionKey,/^referee:[a-f0-9]{64}$/);
  assert.ok(controller.refereeContext.contextBytes>Buffer.byteLength(prompts[1].prompt));

  controller.pause(host,'test_pause');
  assert.deepEqual(released,[options[0].sessionKey]);
  assert.equal(controller.refereeContext,null);
});

test('adapter without sticky capability keeps legacy full prompts',async()=>{
  const prompts=[];
  const adapter={
    runtimeSource:'external',
    generate:async(_role,prompt)=>{prompts.push(JSON.parse(prompt));return '{"kind":"wait"}';},
  };
  const controller=new NarratorOrchestrator({adapter,startAfterSeq:0,maxSteps:4,maxCallsPerHour:20});
  controller.state.epoch='e'.repeat(64);
  controller.state.current={input:{id:'m1',seq:1,content:'attack'},steps:0,outcomes:[],waiting:[],resolved:{},waitSeq:null};
  const host={saveCheckpoint(){},costTracker:{checkBudget:()=>({allowed:true}),recordUsage(){}}};
  await controller.generate(host,'referee',before);
  await controller.generate(host,'referee',after);
  assert.equal(prompts.length,2);
  assert.equal(prompts[0].format,undefined);
  assert.equal(prompts[1].format,undefined);
  assert.deepEqual(prompts[1],JSON.parse(JSON.stringify(compactRolePacket('referee',after))));
});


test('rules_lookup is host-mediated, cached by outcome, and delivered in the next referee delta',async()=>{
  const prompts=[],released=[],lookups=[];
  let calls=0;
  const adapter={
    runtimeSource:'custom-opencode',
    releaseConversation:key=>{released.push(key);return true;},
    instructionBytes:()=>0,
    generateWithUsage:async(_role,prompt,options)=>{
      prompts.push({prompt,options});
      calls++;
      return {text:calls===1
        ? '{"kind":"rules_lookup","query":"When does an opportunity attack trigger?"}'
        : '{"kind":"done"}',usage:null};
    },
    generate:async()=>{throw new Error('fallback should not run');},
  };
  const controller=new NarratorOrchestrator({adapter,startAfterSeq:0,maxSteps:4,maxCallsPerHour:20});
  controller.catalog=[{category:'combat',entries:[{name:'pc_attack'}]}];
  const epoch='e'.repeat(64);
  const input={id:'msg-1',seq:1,authorType:'player',userId:'u1',characterId:'hero',content:'I move away.'};
  const snapshot={
    currentSeq:1,nextCursor:1,hasMore:false,timelineEpoch:epoch,messages:[input],recentMessages:[],events:[],
    campaign:{id:'c',gameSettings:{unitSystem:'metric',combatMode:'classical',language:'en'},scene:'gate',floor:{mode:'open'}},
    spatial:{enabled:false},spatialRooms:[],spatialGrants:[],sheets:[{id:'hero',userId:'u1',name:'Hero'}],
    facts:[],notes:[],npcs:[],pendingRolls:[],summary:{},members:[],encounter:null,sceneTracker:null,location:null,
  };
  const host={
    campaignId:'c',lastSeq:1,timelineEpoch:epoch,stopping:false,
    saveCheckpoint(){},
    memory:{getPromptContext:()=>({summary:''})},
    costTracker:{checkBudget:()=>({allowed:true}),recordUsage(){}},
    lookupRules:async query=>{
      lookups.push(query);
      return {ok:true,edition:'test-srd',corpusRevision:'a'.repeat(64),confidence:{level:'high'},
        hits:[{documentId:'rule-1',snippet:'Leaving reach can trigger a reaction.'}],untrusted:true};
    },
  };

  assert.equal(await controller.tick(host,snapshot),true);
  assert.equal(lookups.length,1);
  assert.equal(controller.state.current.outcomes.length,1);
  assert.equal(controller.state.current.outcomes[0].name,'rules_lookup');

  assert.equal(await controller.tick(host,snapshot),true);
  assert.equal(controller.state.current,null);
  assert.equal(lookups.length,1);
  assert.equal(prompts.length,2);
  const first=JSON.parse(prompts[0].prompt),delta=JSON.parse(prompts[1].prompt);
  assert.equal(delta.format,ROLE_DELTA_FORMAT);
  const reconstructed=applyRolePacketDelta(first,delta);
  assert.equal(reconstructed.outcomes[0].result.hits[0].documentId,'rule-1');
  assert.equal(reconstructed.outcomes[0].result.untrusted,true);
  assert.equal(prompts[0].options.sessionKey,prompts[1].options.sessionKey);
  assert.deepEqual(released,[prompts[0].options.sessionKey]);
});

test('rules Ask gets host evidence while campaign Ask does not trigger retrieval',async()=>{
  const packets=[];
  const adapter={
    runtimeSource:'external',
    generate:async(_role,prompt)=>{packets.push(JSON.parse(prompt));return '{"answer":"answer"}';},
  };
  const controller=new NarratorOrchestrator({adapter,startAfterSeq:0,maxSteps:4,maxCallsPerHour:20});
  let lookups=0;
  const host={
    saveCheckpoint(){},
    costTracker:{checkBudget:()=>({allowed:true}),recordUsage(){}},
    lookupRules:async()=>{lookups++;return {ok:true,edition:'test-srd',hits:[],untrusted:true};},
  };
  const rules=await controller.answerAsk(host,{scope:'rules',question:'How does concentration work?',locale:'en'},{viewer:'u'});
  const campaign=await controller.answerAsk(host,{scope:'campaign',question:'Who owns the tavern?',locale:'en'},{viewer:'u'});
  assert.equal(rules.answer,'answer');assert.equal(campaign.answer,'answer');
  assert.equal(lookups,1);
  assert.equal(packets[0].rulesEvidence.untrusted,true);
  assert.equal(Object.hasOwn(packets[1],'rulesEvidence'),false);
});
