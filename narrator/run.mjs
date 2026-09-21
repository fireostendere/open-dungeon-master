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
import { explicitYoloRequested } from '../shared/dnd-play-mode.mjs';
import { driveNarratorCycle,narratorPollDelay } from './poll-cycle.mjs';
import { createOdmClient } from '../mcp/control-client.mjs';
const integer=(value,fallback,min,max)=>Number.isSafeInteger(Number(value))&&Number(value)>=min&&Number(value)<=max?Number(value):fallback;
const hash=value=>crypto.createHash('sha256').update(value).digest();
export class NarratorRunner {
  constructor(options={}) {
    this.campaignId=options.campaignId||process.env.ODM_CAMPAIGN_ID||process.env.ODM_MCP_NARRATOR_CAMPAIGN_ID||'';
    this.controlUrl=(options.controlUrl||process.env.ODM_URL||process.env.ODM_MCP_URL||process.env.ODM_MCP_CONTROL_URL||'http://127.0.0.1:3005/api/internal/mcp').trim();
    this.token=(options.token||process.env.ODM_AUTH_TOKEN||process.env.ODM_MCP_NARRATOR_TOKEN||process.env.ODM_MCP_TOKEN||'').trim();
    this.pollIntervalMs=integer(options.pollIntervalMs??process.env.ODM_NARRATOR_POLL_MS,2000,10,86400000);
    this.maxAsksPerTick=integer(options.maxAsksPerTick??process.env.ODM_NARRATOR_ASK_BATCH,1,1,20);
    this.askTask=null;this.askError=null;this.madeProgress=false;this.stopping=false;
    this.readMaxBytes=integer(options.readMaxBytes??process.env.ODM_NARRATOR_READ_BYTES,65536,4096,131072);
    this.readPageRetries=integer(options.readPageRetries??process.env.ODM_NARRATOR_READ_RETRIES,2,0,10);
    this.healthPort=integer(options.healthPort??process.env.ODM_NARRATOR_PORT,3007,0,65535);
    this.statusToken=(options.statusToken||process.env.ODM_NARRATOR_STATUS_TOKEN||'').trim();
    this.odmClient=createOdmClient({url:this.controlUrl,token:this.token,transport:options.transport||process.env.ODM_TRANSPORT,timeoutMs:135000,fetchImpl:options.fetchImpl||globalThis.fetch});
    this.askResponder=typeof options.askResponder==='function'?options.askResponder:null;
    this.yoloRequested=explicitYoloRequested({requested:options.yolo});
    this.storyController=options.storyController||null;this.adapterModule=options.adapterModule||process.env.ODM_NARRATOR_ADAPTER_MODULE||'';
    this.deltaReads=options.deltaReads??true;this.sectionCache=null;this.stateCache=null;
    this.resumeRequested=options.resume??false;this.resumeAfterSeq=options.resumeAfterSeq;
    this.mode=this.storyController?'local-role-orchestrator':this.askResponder?'collector-with-ask-adapter':'collector';
    this.playMode=this.storyController?.playMode??(this.yoloRequested?'yolo':null);
    this.checkpointPath=options.checkpointPath||process.env.ODM_NARRATOR_CHECKPOINT_PATH||path.join(process.env.ODM_STATE_DIR||'./state',`narrator-checkpoint-${this.campaignId||'default'}.json`);
    this.costTracker=options.costTracker||new NarratorCostTracker({storagePath:path.join(path.dirname(this.checkpointPath),`narrator-cost-${this.campaignId||'default'}.json`)});
    this.memory=new HostContextMemory({campaignId:this.campaignId});
    this.lastSeq=0;this.lastAskSeq=0;this.timelineEpoch=null;this.answeredAsks=new Set();this.pendingAskCommands=new Map();
    this.pendingAskAttempts=new Map();this.askBlocked=false;
    this.running=false;this.polling=false;this.connected=false;this.timer=null;this.healthServer=null;
    this.startedAt=Date.now();this.lastPollAt=0;this.lastError=null;
  }
  async loadAdapter(){
    if(this.storyController||!this.adapterModule)return;
    const moduleUrl=new URL(this.adapterModule,`file://${process.cwd()}/`);
    if(moduleUrl.protocol!=='file:')throw new Error('Narrator adapter must be an operator-installed local module.');
    const adapterModule=await import(moduleUrl.href),factory=adapterModule.createNarratorAdapter||adapterModule.default;
    if(typeof factory!=='function')throw new Error('Narrator adapter module must export createNarratorAdapter.');
    const configured=await factory({campaignId:this.campaignId,yolo:this.yoloRequested});
    if(!configured?.storyController?.tick)throw new Error('Narrator adapter has no storyController.');
    this.storyController=configured.storyController;this.askResponder=configured.askResponder??this.askResponder;this.mode='local-role-orchestrator';this.playMode=this.storyController.playMode??(this.yoloRequested?'yolo':null);
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
    this.pendingAskAttempts.clear();
    for(const [askId,command] of Object.entries(saved.pendingAskCommands??{}).slice(-200)){
      if(command?.campaignId===this.campaignId&&command.askId===askId&&typeof command.commandId==='string'){
        this.pendingAskCommands.set(askId,command);
        this.pendingAskAttempts.set(askId,integer(saved.pendingAskAttempts?.[askId],0,0,2));
      }
    }
    if(saved.memory)this.memory.restoreState(saved.memory);
    if(saved.storyController&&this.storyController?.restore)this.storyController.restore(saved.storyController);
    // A collector cursor proves delivery to memory, not resolution by a DM.
    else if(this.storyController)this.lastSeq=this.storyController.state.handledSeq;
  }
  saveCheckpoint() {
    atomicWriteJson(this.checkpointPath,{formatVersion:3,version:3,mode:this.mode,playMode:this.playMode,campaignId:this.campaignId,timelineEpoch:this.timelineEpoch,
      lastSeq:this.lastSeq,lastAskSeq:this.lastAskSeq,answeredAsks:Array.from(this.answeredAsks).slice(-200),
      pendingAskCommands:Object.fromEntries(Array.from(this.pendingAskCommands.entries()).slice(-200)),
      pendingAskAttempts:Object.fromEntries(Array.from(this.pendingAskAttempts.entries()).slice(-200)),storyController:this.storyController?.serialize?.(),
      memory:this.memory.serializeState(),metrics:this.costTracker.getMetrics(),updatedAt:new Date().toISOString(),
      uptimeSeconds:Math.floor((Date.now()-this.startedAt)/1000),lastPollAt:this.lastPollAt||null,lastError:this.lastError?'poll_failed':null});
  }
  async callControl(action,params={}, {timeoutMs=15000}={}) {
    return this.odmClient(action,params,{timeout:timeoutMs});
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
    this.askBlocked=false;
    let cursor=0;
    for(let page=0;page<1000;page++){
      const result=await this.readSnapshot({campaignId:this.campaignId,afterSeq:this.lastSeq,afterAskSeq:cursor,askLimit:20,includeAsks:true,limit:1,projection:'live',...(this.timelineEpoch?{timelineEpoch:this.timelineEpoch}:{})});
      if(this.timelineEpoch&&result?.timelineEpoch&&result.timelineEpoch!==this.timelineEpoch)throw Object.assign(new Error('Narrator timeline changed.'),{status:409,code:'timeline_changed'});
      for(const item of result?.asks||result?.askQueue?.items||[])await this.handlePendingAsk(item);
      const queue=result?.askQueue||{},next=queue.nextCursor??cursor;
      if(!Number.isSafeInteger(next)||next<cursor||queue.hasMore&&next<=cursor)throw new Error('Ask queue cursor did not advance.');
      if(!queue.hasMore){this.lastAskSeq=next;return;}cursor=next;
    }
    throw new Error('Ask queue exceeded the page safety limit.');
  }
  async pollTick() {
    if(!this.campaignId||this.polling||this.stopping)return false;this.polling=true;this.madeProgress=false;
    try{
      for(let attempt=0;attempt<2;attempt++){
        try{
          if(!this.connected)await this.connect();
          await driveNarratorCycle(this);break;
        }catch(error){
          if(attempt||error?.status!==409)throw error;
          // Only fully assembled authoritative metadata can prove a rewind.
          await this.connect();
        }
      }
      this.lastPollAt=Date.now();this.lastError=this.askError||this.askBlocked?'ask_failed':this.storyController?.state?.paused?'story_paused':null;this.saveCheckpoint();return !this.lastError;
    }catch{
      this.lastError='poll_failed';console.error('[narrator-runner] poll_failed');this.saveCheckpoint();return false;
    }finally{this.polling=false;}
  }
  async handlePendingAsk(ask) {
    if(!ask?.id||this.answeredAsks.has(ask.id)||this.stopping)return;
    const epoch=this.timelineEpoch,campaignId=this.campaignId;
    const current=()=>!this.stopping&&this.timelineEpoch===epoch&&this.campaignId===campaignId;
    let command=this.pendingAskCommands.get(ask.id);
    if(command&&command.expectedVersion!==(ask.version??0)){
      // A fresh queue version is authoritative evidence to rebuild a rejected
      // command. An ambiguous network failure alone never changes its UUID.
      this.pendingAskCommands.delete(ask.id);this.pendingAskAttempts.delete(ask.id);command=null;this.saveCheckpoint();
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
      // A model may finish after a rewind/stop. Never attach its old private
      // context or command to the new timeline's checkpoint or Ask queue.
      if(!current()||reply==null)return;
      if(typeof reply.answer!=='string'||!reply.answer.trim()||reply.answer.length>4000||reply.citations!==undefined&&(!Array.isArray(reply.citations)||reply.citations.length>50))throw new Error('Invalid Ask adapter response.');
      if(reply.usage&&Number.isSafeInteger(reply.usage.promptTokens)&&Number.isSafeInteger(reply.usage.completionTokens)&&reply.usage.promptTokens>=0&&reply.usage.completionTokens>=0)this.costTracker.recordUsage(reply.usage);
      command={campaignId:this.campaignId,askId:ask.id,answer:reply.answer,expectedVersion:ask.version??0,commandId:crypto.randomUUID(),citations:reply.citations??[],...(this.timelineEpoch?{timelineEpoch:this.timelineEpoch}:{})};
      this.pendingAskCommands.set(ask.id,command);this.saveCheckpoint();
    }
    const attempts=this.pendingAskAttempts.get(ask.id)??0;
    if(attempts>=2){this.askBlocked=true;return;}
    this.pendingAskAttempts.set(ask.id,attempts+1);this.saveCheckpoint();
    try{
      await this.callControl('narrator.answer_ask',command);
      if(!current())return;
      this.answeredAsks.add(ask.id);this.pendingAskCommands.delete(ask.id);this.pendingAskAttempts.delete(ask.id);this.saveCheckpoint();
    }catch(error){
      if(!current())return;
      if(error.status!==409||error.code==='timeline_changed')throw error;
      // A rejected version is not an answered question. Leave it pending for
      // the next authoritative queue read, without retrying a stale payload.
      this.pendingAskCommands.delete(ask.id);this.pendingAskAttempts.delete(ask.id);this.saveCheckpoint();
    }
  }
  startHealthServer() {
    if(!this.healthPort||this.healthServer)return;
    this.healthServer=http.createServer((request,response)=>{
      const url=new URL(request.url,'http://localhost');response.setHeader('content-type','application/json');response.setHeader('cache-control','no-store');
      if(url.pathname==='/healthz'){
        if(this.lastError)response.statusCode=503;
        response.end(JSON.stringify({ok:!this.lastError,status:this.lastError?'degraded':'healthy',mode:this.mode,playMode:this.playMode,uptime:process.uptime()}));
      }
      else if(url.pathname==='/status'){
        if(this.statusToken&&!crypto.timingSafeEqual(hash(request.headers.authorization??''),hash(`Bearer ${this.statusToken}`))){response.writeHead(401);response.end(JSON.stringify({error:'Unauthorized'}));return;}
        response.end(JSON.stringify({ok:!this.lastError,status:this.lastError?'degraded':'running',mode:this.mode,playMode:this.playMode,campaignId:this.campaignId,lastSeq:this.lastSeq,lastAskSeq:this.lastAskSeq,
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
    await this.loadAdapter();this.loadCheckpoint();this.startHealthServer();this.running=true;this.stopping=false;
    try{await this.connect();}catch{console.warn('[narrator-runner] Initial connect failed; collector will retry.');}
    // Productive tool steps continue immediately; idle/error polls keep their
    // bounded interval. A timer still yields the event loop between decisions.
    const schedule=(delay=0)=>{if(this.running)this.timer=setTimeout(async()=>{await this.pollTick();schedule(narratorPollDelay(this));},delay);};schedule();
  }
  async stop(){
    this.stopping=true;this.running=false;if(this.timer){clearTimeout(this.timer);this.timer=null;}this.saveCheckpoint();
    if(this.healthServer){await new Promise(resolve=>this.healthServer.close(resolve));this.healthServer=null;}
    await this.odmClient.close();
  }
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
  const args=process.argv.slice(2);let campaignId='',once=false,port,resume=false,resumeAfterSeq,yolo=false;
  for(let index=0;index<args.length;index++){
    if(args[index]==='--campaign'&&args[index+1])campaignId=args[++index];else if(args[index]==='--port'&&args[index+1])port=Number(args[++index]);else if(args[index]==='--once')once=true;
    else if(args[index]==='--resume')resume=true;else if(args[index]==='--after'&&args[index+1])resumeAfterSeq=Number(args[++index]);else if(args[index]==='--yolo')yolo=true;
  }
  const runner=new NarratorRunner({campaignId,healthPort:port,resume,resumeAfterSeq,yolo});
  const shutdown=async()=>{await runner.stop();process.exit(0);};process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
  if(once){await runner.loadAdapter();runner.loadCheckpoint();try{await runner.connect();const ok=await runner.pollTick();await runner.askTask;runner.saveCheckpoint();process.exit(ok&&!runner.askError?0:1);}catch{console.error('[narrator-runner] Collector once failed.');process.exit(1);}}
  else runner.start().catch(()=>{console.error('[narrator-runner] Collector start failed.');process.exit(1);});
}
