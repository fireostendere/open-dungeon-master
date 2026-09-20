import assert from 'node:assert/strict';
import vm from 'node:vm';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HostContextMemory } from '../../narrator/compaction.mjs';
import * as reader from '../../narrator/read-session.mjs';
import * as playMode from '../../shared/dnd-play-mode.mjs';
export async function narratorHarness(options={}){
 const saved=[],calls=[],usage=[];
 const deps={
  'node:http':{default:options.http??http},'node:path':{default:path},'node:crypto':{default:crypto},'node:url':{fileURLToPath},
  './checkpoint-io.mjs':{atomicWriteJson:(_file,value)=>{if(options.failCheckpoint)throw new Error('Checkpoint write failed');saved.push(structuredClone(value));},readJsonSafe:()=>options.checkpoint??null},
  './semantic-gate.mjs':{classifyInput:()=>({decision:'allow'}),DM_REFUSALS:{ru:'Game only'}},
  './cost-tracker.mjs':{NarratorCostTracker:class{getMetrics(){return{};}recordUsage(value){usage.push(value);}}},
  './compaction.mjs':{HostContextMemory},'./read-session.mjs':reader,
  '../shared/dnd-play-mode.mjs':playMode,
 };
 const context=vm.createContext({console:{...console,error(){}},process,Buffer,structuredClone,URL,AbortSignal,setTimeout,clearTimeout});
 const url=new URL('../../narrator/run.mjs',import.meta.url),vmModule=new vm.SourceTextModule(readFileSync(url,'utf8'),{context,initializeImportMeta:meta=>{meta.url=url.href;}});
 await vmModule.link(name=>{assert.ok(deps[name],`Missing dependency ${name}`);return new vm.SyntheticModule(Object.keys(deps[name]),function(){for(const[key,value]of Object.entries(deps[name]))this.setExport(key,value);},{context});});
 await vmModule.evaluate();
 const instance=new vmModule.namespace.NarratorRunner({campaignId:'c',token:'test-only',healthPort:0,readPageRetries:0,...options,
  fetchImpl:async(_url,init)=>{const request=JSON.parse(init.body);calls.push(request);const result=await options.control?.(request.action,request.params);return Response.json({ok:true,result});}});
 return{instance,saved,calls,usage};
}
export const snapshot=(cursor,nextCursor,currentSeq,hasMore,messages=[],extra={})=>({campaign:{id:'c'},cursor,nextCursor,currentSeq,hasMore,messages,asks:[],askQueue:{nextCursor:0,hasMore:false},...extra});
export const message=(seq,content=`m${seq}`)=>({id:`m${seq}`,seq,content,roomId:'tavern',witnessUserIds:['A'],authorType:'player'});
export function pages(value){
 const shape=Object.fromEntries(Object.entries(value).map(([key,item])=>[key,Array.isArray(item)?'array':'value']));
 const entries=Object.entries(value).flatMap(([key,item])=>Array.isArray(item)?item.map((value,index)=>({key,index,value})):[{key,value:item}]);
 const hash=crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'),split=Math.ceil(entries.length/2);
 return[{format:'odm.read.page.v1',shape,hash,offset:0,complete:false,nextPage:'p2',entries:entries.slice(0,split)},
 {format:'odm.read.page.v1',shape,hash,offset:split,complete:true,nextPage:null,entries:entries.slice(split)}];
}
