// Actual public MCP boundary with explicit action-registry/domain doubles.
// Exercises dry-run policy, prevalidation and domain-event payloads; not SDK
// initialize/tools/list, live providers, Next HTTP or browser rendering.
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { loadReviewModule } from "./lib/review-module.mjs";
const source=path.resolve(import.meta.dirname,"../src/lib/mcp-control.ts");
function fixture(){
  const state={global:0,campaign:0,probes:0,exists:true,events:[],sheet:{id:"s",campaignId:"c",userId:"u",currentHp:10}};
  const control=loadReviewModule(source,{
    "@/lib/mcp-control-actions":{executeMcpControl:async(action,params)=>{
      if(action==="campaigns.get"){if(params.campaignId!=="c"||!state.exists)throw Error("Campaign not found");return{campaign:{id:"c"}};}
      if(action.startsWith("models.")){state.probes++;if(params.apply!==false&&!params.campaignId)state.global++;if(params.campaignId)state.campaign++;
        return{profile:{id:"p"},report:{ok:true},applied:params.apply!==false&&!params.campaignId,campaignApplied:!!params.campaignId,target:params.campaignId?"campaign":params.apply===false?"profile_saved":"global"};}
      if(action==="sheets.patch")state.sheet={...state.sheet,...params.patch};
      return{sheet:state.sheet};
    }},
    "@/lib/db/sheets":{getSheetById:()=>state.sheet},"@/lib/db/campaigns":{listMembers:()=>[{userId:"u",ready:true}]},
    "@/lib/events":{publishPersisted:(campaignId,type,payload)=>state.events.push({campaignId,type,payload})},
  });return{state,control};
}
for(const action of ["models.test_and_connect","models.switch_remote"]){
  test(`R13: ${action} apply:false saves/probes without touching either target`,async()=>{
    const f=fixture();const result=await f.control.executeMcpControl(action,{campaignId:"c",apply:false,model:"model"});
    assert.equal(f.state.probes,1);assert.equal(f.state.global,0);assert.equal(f.state.campaign,0);
    assert.equal(result.campaignApplied,false);assert.equal(result.target,"profile_saved");
  });
  test(`R13: ${action} rejects a nonexistent target before the costly probe`,async()=>{
    const f=fixture();f.state.exists=false;await assert.rejects(()=>f.control.executeMcpControl(action,{campaignId:"c",apply:true}),/not found/);
    assert.equal(f.state.probes,0);assert.equal(f.state.campaign,0);
  });
  test(`R13: ${action} explicit apply still targets the requested campaign`,async()=>{
    const f=fixture();await f.control.executeMcpControl(action,{campaignId:"c",apply:true});assert.equal(f.state.campaign,1);assert.equal(f.state.global,0);
  });
}
test("R15: HP patch emits the complete sheet in the browser's domain event",async()=>{
  const f=fixture();await f.control.executeMcpControl("sheets.patch",{sheetId:"s",patch:{currentHp:4}});
  assert.deepEqual(f.state.events,[{campaignId:"c",type:"sheet_updated",payload:{sheet:f.state.sheet}}]);
  assert.equal(f.state.events[0].payload.sheet.currentHp,4);
});
test("R15: instantiation emits sheet and membership updates without a page reload",async()=>{
  const f=fixture();await f.control.executeMcpControl("characters.instantiate",{characterId:"hero",campaignId:"c"});
  assert.deepEqual(f.state.events.map(x=>x.type),["sheet_updated","member_updated"]);assert.equal(f.state.events[1].payload.member.userId,"u");
});
