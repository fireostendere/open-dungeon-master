#!/usr/bin/env node
/** Campaign-scoped context collector. Only an explicit operator adapter may
 * answer Ask; the standalone CLI never invents model replies or token usage.
 */
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { atomicWriteJson,readJsonSafe } from './checkpoint-io.mjs';
import { classifyInput,DM_REFUSALS } from './semantic-gate.mjs';
import { NarratorCostTracker } from './cost-tracker.mjs';
import { HostContextMemory } from './compaction.mjs';
import { connectNarrator,drainNarratorStory,readNarratorSnapshot } from './read-session.mjs';
const integer=(value,fallback,min,max)=>Number.isSafeInteger(Number(value))&&Number(value)>=min&&Number(value)<=max?Number(value):fallback;
const hash=value=>crypto.createHash('sha256').update(value).digest();
export class NarratorRunner {
  constructor(options={}) {
    this.campaignId=options.campaignId||process.env.ODM_CAMPAIGN_ID||process.env.ODM_MCP_NARRATOR_CAMPAIGN_ID||'';
    this.controlUrl=(options.controlUrl||process.env.ODM_MCP_URL||process.env.ODM_MCP_CONTROL_URL||'http://127.0.0.1:3005/api/internal/mcp').trim();
    this.token=(options.token||process.env.ODM_MCP_NARRATOR_TOKEN||process.env.ODM_MCP_TOKEN||'').trim();
    this.pollIntervalMs=integer(options.pollIntervalMs??process.env.ODM_NARRATOR_POLL_MS,2000,10,86400000);
    this.readMaxBytes=integer(options.readMaxBytes??process.env.ODM_NARRATOR_READ_BYTES,65536,4096,131072);
    this.readPageRetries=integer(options.readPageRetries??process.env.ODM_NARRATOR_READ_RETRIES,2,0,10);
    this.healthPort=integer(options.healthPort??process.env.ODM_NARRATOR_PORT,3007,0,65535);
    this.statusToken=(options.statusToken||process.env.ODM_NARRATOR_STATUS_TOKEN||'').trim();
    this.fetchImpl=options.fetchImpl||globalThis.fetch;
    this.askResponder=typeof options.askResponder==='function'?options.askResponder:null;
    this.storyController=options.storyController||null;this.adapterModule=options.adapterModule||process.env.ODM_NARRATOR_ADAPTER_MODULE||'';
    this.deltaReads=options.deltaReads??true;this.sectionCache=null;this.hasBaseline=false;
    this.resumeRequested=options.resume??false;this.resumeAfterSeq=options.resumeAfterSeq;
    this.mode=this.storyController?'local-role-orchestrator':this.askResponder?'collector-with-ask-adapter':'collector';
    this.checkpointPath=options.checkpointPath||process.env.ODM_NARRATOR_CHECKPOINT_PATH||path.join(process.env.ODM_STATE_DIR||'./state',`narrator-checkpoint-${this.campaignId||'default'}.json`);
    this.costTracker=options.costTracker||new NarratorCostTracker({storagePath:path.join(path.dirname(this.checkpointPath),`narrator-cost-${this.campaignId||'default'}.json`)});
    this.memory=new HostContextMemory({campaignId:this.campaignId});
    this.lastSeq=0;this.lastAskSeq=0;this.timelineEpoch=null;this.answeredAsks=new Set();this.pendingAskCommands=new Map();
    this.running=false;this.polling=false;this.connected=false;this.timer=null;this.healthServer=null;
    this.startedAt=Date.now();this.lastPollAt=0;this.lastError=null;
  }
  async loadAdapter(){
    if(this.storyController||!this.adapterModule)return;
    const moduleUrl=new URL(this.adapterModule,`file://${process.cwd()}/`);
    if(moduleUrl.protocol!=='file:')throw new Error('Narrator adapter must be an operator-installed local module.');
    const adapterModule=await import(moduleUrl.href),factory=adapterModule.createNarratorAdapter||adapterModule.default;
    if(typeof factory!=='function')throw new Error('Narrator adapter module must export createNarratorAdapter.');
    const configured=await factory({campaignId:this.campaignId});
    if(!configured?.storyController?.tick)throw new Error('Narrator adapter has no storyController.');
    this.storyController=configured.storyController;this.askResponder=configured.askResponder??this.askResponder;this.mode='local-role-orchestrator';
    if(!this.askResponder&&this.storyController.answerAsk)this.askResponder=(ask,context)=>this.storyController.answerAsk(this,ask,context);
  }
  loadCheckpoint() {
    const saved=readJsonSafe(this.checkpointPath);
    if(!saved||typeof saved!=='object'||this.campaignId&&saved.campaignId!==this.campaignId)return;
    if(!this.campaignId&&saved.campaignId)this.campaignId=saved.campaignId;
    this.lastSeq=integer(saved.lastSeq,0,0,Number.MAX_SAFE_INTEGER);this.lastAskSeq=integer(saved.lastAskSeq,0,0,Number.MAX_SAFE_INTEGER);
    this.timelineEpoch=typeof saved.timelineEpoch==='string'?saved.timelineEpoch:typeof saved.memory?.timelineEpoch==='string'?saved.memory.timelineEpoch:typeof saved.memory?.timelineId==='string'?saved.memory.timelineId:null;
    this.answeredAsks=new Set(Array.isArray(saved.answeredAsks)?saved.answeredAsks.filter(id=>typeof id==='string').slice(-200):[]);
    this.pendingAskCommands.clear();
    for(const [askId,command] of Object.entries(saved.pendingAskCommands??{}).slice(-200)){
      if(command?.campaignId===this.campaignId&&command.askId===askId&&typeof command.commandId==='string')this.pendingAskCommands.set(askId,command);
    }
    if(saved.memory)this.memory.restoreState(saved.memory);
    if(saved.storyController&&this.storyController?.restore)this.storyController.restore(saved.storyController);
    // A collector cursor proves delivery to memory, not resolution by a DM.
    else if(this.storyController)this.lastSeq=this.storyController.state.handledSeq;
  }
  saveCheckpoint() {
    atomicWriteJson(this.checkpointPath,{formatVersion:3,version:3,mode:this.mode,campaignId:this.campaignId,timelineEpoch:this.timelineEpoch,
      lastSeq:this.lastSeq,lastAskSeq:this.lastAskSeq,answeredAsks:Array.from(this.answeredAsks).slice(-200),
      pendingAskCommands:Object.fromEntries(Array.from(this.pendingAskCommands.entries()).slice(-200)),storyController:this.storyController?.serialize?.(),
      memory:this.memory.serializeState(),metrics:this.costTracker.getMetrics(),updatedAt:new Date().toISOString(),
      uptimeSeconds:Math.floor((Date.now()-this.startedAt)/1000),lastPollAt:this.lastPollAt||null,lastError:this.lastError?'poll_failed':null});
  }
  async callControl(action,params={}, {timeoutMs=15000}={}) {
    if(!this.token)throw new Error('Narrator authentication token is missing.');
    const response=await this.fetchImpl(this.controlUrl,{method:'POST',headers:{authorization:`Bearer ${this.token}`,'content-type':'application/json',accept:'application/json'},
      body:JSON.stringify({action,params}),redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
    const body=await response.json().catch(()=>null);
    if(!response.ok||body?.ok===false)throw Object.assign(new Error(body?.error||`Control returned HTTP ${response.status}`),{status:response.status,code:body?.code});
    if(!body||!Object.hasOwn(body,'result'))throw new Error('Invalid control response.');return body.result;
  }
  async connect(){
    this.connected=false;const result=await connectNarrator(this);
    if(this.resumeRequested){
      if(this.resumeAfterSeq!==undefined&&(!Number.isSafeInteger(this.resumeAfterSeq)||this.resumeAfterSeq<0||this.resumeAfterSeq>this.lastSeq))throw new Error('Resume cursor must be inside the fully read timeline.');
      this.storyController?.resume({afterSeq:this.resumeAfterSeq});this.resumeRequested=false;this.saveCheckpoint();
    }
    this.connected=true;return result;
  }
  readSnapshot(params){return readNarratorSnapshot(this,params);}
  drainStory(options){return drainNarratorStory(this,options);}
  async drainAskQueue() {
    let cursor=0;
    for(let page=0;page<1000;page++){
      const result=await this.readSnapshot({campaignId:this.campaignId,afterSeq:this.lastSeq,afterAskSeq:cursor,askLimit:20,limit:1,projection:'live',...(this.timelineEpoch?{timelineEpoch:this.timelineEpoch}:{})});
      if(this.timelineEpoch&&result?.timelineEpoch&&result.timelineEpoch!==this.timelineEpoch)throw Object.assign(new Error('Narrator timeline changed.'),{status:409,code:'timeline_changed'});
      for(const item of result?.asks||result?.askQueue?.items||[])await this.handlePendingAsk(item);
      const queue=result?.askQueue||{},next=queue.nextCursor??cursor;
      if(!Number.isSafeInteger(next)||next<cursor||queue.hasMore&&next<=cursor)throw new Error('Ask queue cursor did not advance.');
      if(!queue.hasMore){this.lastAskSeq=next;return;}cursor=next;
    }
    throw new Error('Ask queue exceeded the page safety limit.');
  }
  async pollTick() {
    if(!this.campaignId||this.polling)return false;this.polling=true;
    try{
      for(let attempt=0;attempt<2;attempt++){
        try{
          if(!this.connected)await this.connect();
          // Refresh story/epoch before using player-projected context for Ask.
          const story=await this.drainStory();await this.drainAskQueue();if(this.storyController)await this.storyController.tick(this,story);break;
        }catch(error){
          if(attempt||error?.status!==409)throw error;
          // Only fully assembled authoritative metadata can prove a rewind.
          await this.connect();
        }
      }
      this.lastPollAt=Date.now();this.lastError=this.storyController?.state?.paused?'story_paused':null;this.saveCheckpoint();return !this.lastError;
    }catch{
      this.lastError='poll_failed';console.error('[narrator-runner] poll_failed');this.saveCheckpoint();return false;
    }finally{this.polling=false;}
  }
  async handlePendingAsk(ask) {
    if(!ask?.id||this.answeredAsks.has(ask.id))return;
    let command=this.pendingAskCommands.get(ask.id);
    if(command&&command.expectedVersion!==(ask.version??0)){
      // A fresh queue version is authoritative evidence to rebuild a rejected
      // command. An ambiguous network failure alone never changes its UUID.
      this.pendingAskCommands.delete(ask.id);command=null;this.saveCheckpoint();
    }
    if(!command&&!this.askResponder)return;
    if(!command){
      const locale=ask.locale||'ru',classification=classifyInput(ask.question||'',{locale,source:'ask'});
      let reply;
      if(['safety_pause','decline','ignore_instruction','refuse_secret','clarify'].includes(classification.decision)){
        reply={answer:classification.replyText||DM_REFUSALS[locale]||DM_REFUSALS.ru,citations:[]};
      }else{
        if(typeof ask.userId!=='string'||!ask.userId)throw new Error('Ask author is required for a private context projection.');
        reply=await this.askResponder(structuredClone(ask),this.memory.getPromptContext({viewerUserId:ask.userId}));
      }
      if(reply==null)return;
      if(typeof reply.answer!=='string'||!reply.answer.trim()||reply.answer.length>4000||reply.citations!==undefined&&(!Array.isArray(reply.citations)||reply.citations.length>50))throw new Error('Invalid Ask adapter response.');
      if(reply.usage&&Number.isSafeInteger(reply.usage.promptTokens)&&Number.isSafeInteger(reply.usage.completionTokens)&&reply.usage.promptTokens>=0&&reply.usage.completionTokens>=0)this.costTracker.recordUsage(reply.usage);
      command={campaignId:this.campaignId,askId:ask.id,answer:reply.answer,expectedVersion:ask.version??0,commandId:crypto.randomUUID(),citations:reply.citations??[],...(this.timelineEpoch?{timelineEpoch:this.timelineEpoch}:{})};
      this.pendingAskCommands.set(ask.id,command);this.saveCheckpoint();
    }
    try{
      await this.callControl('narrator.answer_ask',command);this.answeredAsks.add(ask.id);this.pendingAskCommands.delete(ask.id);this.saveCheckpoint();
    }catch(error){
      if(error.status!==409||error.code==='timeline_changed')throw error;
      // A rejected version is not an answered question. Leave it pending for
      // the next authoritative queue read, without retrying a stale payload.
      this.pendingAskCommands.delete(ask.id);this.saveCheckpoint();
    }
  }
  startHealthServer() {
    if(!this.healthPort||this.healthServer)return;
    this.healthServer=http.createServer((request,response)=>{
      const url=new URL(request.url,'http://localhost');response.setHeader('content-type','application/json');response.setHeader('cache-control','no-store');
      if(url.pathname==='/healthz')response.end(JSON.stringify({ok:true,status:this.lastError?'degraded':'healthy',mode:this.mode,uptime:process.uptime()}));
      else if(url.pathname==='/status'){
        if(this.statusToken&&!crypto.timingSafeEqual(hash(request.headers.authorization??''),hash(`Bearer ${this.statusToken}`))){response.writeHead(401);response.end(JSON.stringify({error:'Unauthorized'}));return;}
        response.end(JSON.stringify({ok:true,status:'running',mode:this.mode,campaignId:this.campaignId,lastSeq:this.lastSeq,lastAskSeq:this.lastAskSeq,
          answeredAsksCount:this.answeredAsks.size,pendingAskCommandsCount:this.pendingAskCommands.size,lastPollAt:this.lastPollAt||null,
          lastError:this.lastError?'poll_failed':null,metrics:this.costTracker.getMetrics(),
          story:this.storyController?{paused:this.storyController.state.paused,queued:this.storyController.state.queue.length,
            calls:this.storyController.state.usage.calls,inputBytes:this.storyController.state.usage.inputBytes,outputBytes:this.storyController.state.usage.outputBytes,tokens:null,cost:null}:null,
          memory:this.memory.serializeState({safe:true}),uptime:process.uptime()}));
      }else{response.writeHead(404);response.end(JSON.stringify({error:'Not found'}));}
    });
    this.healthServer.listen(this.healthPort,'127.0.0.1');
  }
  async start(){
    await this.loadAdapter();this.loadCheckpoint();this.startHealthServer();this.running=true;
    try{await this.connect();}catch{console.warn('[narrator-runner] Initial connect failed; collector will retry.');}
    const schedule=()=>{if(this.running)this.timer=setTimeout(async()=>{await this.pollTick();schedule();},this.pollIntervalMs);};schedule();
  }
  async stop(){
    this.running=false;if(this.timer){clearTimeout(this.timer);this.timer=null;}this.saveCheckpoint();
    if(this.healthServer){await new Promise(resolve=>this.healthServer.close(resolve));this.healthServer=null;}
  }
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
  const args=process.argv.slice(2);let campaignId='',once=false,port,resume=false,resumeAfterSeq;
  for(let index=0;index<args.length;index++){
    if(args[index]==='--campaign'&&args[index+1])campaignId=args[++index];else if(args[index]==='--port'&&args[index+1])port=Number(args[++index]);else if(args[index]==='--once')once=true;
    else if(args[index]==='--resume')resume=true;else if(args[index]==='--after'&&args[index+1])resumeAfterSeq=Number(args[++index]);
  }
  const runner=new NarratorRunner({campaignId,healthPort:port,resume,resumeAfterSeq});
  const shutdown=async()=>{await runner.stop();process.exit(0);};process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
  if(once){await runner.loadAdapter();runner.loadCheckpoint();try{await runner.connect();const ok=await runner.pollTick();runner.saveCheckpoint();process.exit(ok?0:1);}catch{console.error('[narrator-runner] Collector once failed.');process.exit(1);}}
  else runner.start().catch(()=>{console.error('[narrator-runner] Collector start failed.');process.exit(1);});
}
