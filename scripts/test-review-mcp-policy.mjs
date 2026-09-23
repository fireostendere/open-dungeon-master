// Actual public MCP boundary with explicit action-registry/domain doubles.
// Exercises dry-run policy, prevalidation and domain-event payloads; not SDK
// initialize/tools/list, live providers, Next HTTP or browser rendering.
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { loadReviewModule } from "./lib/review-module.mjs";
const source=path.resolve(import.meta.dirname,"../src/lib/mcp-control.ts");
function fixture(){
  const state={events:[],sheet:{id:"s",campaignId:"c",userId:"u",currentHp:10}};
  const control=loadReviewModule(source,{
    "@/lib/mcp-control-actions":{executeMcpControl:async(action,params)=>{
      if(action==="sheets.patch")state.sheet={...state.sheet,...params.patch};
      return{sheet:state.sheet};
    }},
    "@/lib/db/sheets":{getSheetById:()=>state.sheet},"@/lib/db/campaigns":{listMembers:()=>[{userId:"u",ready:true}]},
    "@/lib/events":{publishPersisted:(campaignId,type,payload)=>state.events.push({campaignId,type,payload})},
  });return{state,control};
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
