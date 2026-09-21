import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRolePacketDelta, createRolePacketDelta, ROLE_DELTA_FORMAT } from '../narrator/role-delta.mjs';
import { NarratorOrchestrator } from '../narrator/orchestration.mjs';

const before={
  instructions:'rules',
  input:{id:'m1',seq:1,content:'attack'},
  campaign:{scene:'gate',clock:{day:1,hour:8}},
  state:{
    sheets:[{id:'hero',hp:12,ac:16},{id:'cleric',hp:9,ac:15}],
    encounter:{encounter:{id:'enc',round:1},enemies:[{id:'goblin',hp:7,ac:13}]},
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
    sheets:[{id:'hero',hp:10,ac:16},{id:'cleric',hp:9,ac:15}],
    encounter:{...before.state.encounter,enemies:[{id:'goblin',hp:2,ac:13}]},
  },
  outcomes:[{name:'pc_attack',result:{hit:true,damage:5}}],
};

test('role packet delta reconstructs nested entity and scalar changes exactly',()=>{
  const delta=createRolePacketDelta(before,after);
  assert.equal(delta.format,ROLE_DELTA_FORMAT);
  assert.deepEqual(applyRolePacketDelta(before,delta),after);
  assert.equal(delta.patch.objects.state.entities.sheets.upsert.length,1);
  assert.equal(delta.patch.objects.state.entities.sheets.upsert[0].hp,10);
  assert.equal(delta.patch.objects.state.objects.encounter.entities.enemies.upsert[0].hp,2);
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
  assert.deepEqual(applyRolePacketDelta(JSON.parse(prompts[0].prompt),delta),after);
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
  assert.deepEqual(prompts[1],after);
});
