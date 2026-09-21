import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';

const ALLOWED_TOOLS = new Set(['rules_search','rules_get','rules_sources','rules_status']);
const REQUIRED_TOOLS = [...ALLOWED_TOOLS].sort();
const clip = (value,max) => typeof value === 'string' ? value.slice(0,max) : '';

function integer(value,fallback,min,max){
  const number=Number(value);
  return Number.isSafeInteger(number)&&number>=min&&number<=max?number:fallback;
}

export class RulesMcpClient {
  constructor(options={}){
    this.python=options.python;
    if(typeof this.python!=='string'||!path.isAbsolute(this.python))throw new Error('Rules MCP Python executable must be an absolute path.');
    this.cwd=options.cwd||undefined;
    if(this.cwd!==undefined&&(!path.isAbsolute(this.cwd)||typeof this.cwd!=='string'))throw new Error('Rules MCP cwd must be absolute.');
    this.edition=String(options.edition??'').trim();
    if(!this.edition||this.edition.length>80)throw new Error('Set an explicit rules edition.');
    this.collection=String(options.collection??'dnd_srd').trim();
    if(!this.collection||this.collection.length>80)throw new Error('Invalid rules collection.');
    this.timeoutMs=integer(options.timeoutMs,15000,1000,60000);
    this.topK=integer(options.topK,3,1,8);
    this.env={...process.env,...(options.env??{}),KB_DND_EDITION:this.edition,KB_DND_COLLECTION:this.collection};
    this.spawn=options.spawnImpl??spawn;
    this.child=null;this.reader=null;this.pending=new Map();this.nextId=1;this.starting=null;this.closed=false;
    this.lastRevision=null;this.lastError=null;
  }
  send(message){
    if(!this.child?.stdin?.writable)throw new Error('Rules MCP stdin is unavailable.');
    const payload=JSON.stringify(message)+'\n';
    if(Buffer.byteLength(payload)>131072)throw new Error('Rules MCP request exceeds byte budget.');
    this.child.stdin.write(payload);
  }
  request(method,params={},timeoutMs=this.timeoutMs){
    if(!this.child)return Promise.reject(new Error('Rules MCP is not started.'));
    const id=this.nextId++;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{
        this.pending.delete(id);
        reject(Object.assign(new Error(`Rules MCP ${method} timed out.`),{code:'RULES_TIMEOUT'}));
      },timeoutMs);
      timer.unref?.();
      this.pending.set(id,{resolve,reject,timer});
      try{this.send({jsonrpc:'2.0',id,method,params});}
      catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);}
    });
  }
  onMessage(line){
    if(Buffer.byteLength(line)>1048576){this.fail(new Error('Rules MCP response exceeds byte budget.'));return;}
    let message;try{message=JSON.parse(line);}catch{return;}
    if(!Object.hasOwn(message,'id'))return;
    const pending=this.pending.get(message.id);if(!pending)return;
    clearTimeout(pending.timer);this.pending.delete(message.id);
    if(message.error)pending.reject(Object.assign(new Error(clip(message.error.message,500)||'Rules MCP error.'),{code:message.error.code}));
    else pending.resolve(message.result);
  }
  fail(error){
    this.lastError=error instanceof Error?error.message:'rules_mcp_failed';
    for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(error);}
    this.pending.clear();
  }
  async start(){
    if(this.closed)throw new Error('Rules MCP client is closed.');
    if(this.child)return;
    if(this.starting)return this.starting;
    this.starting=(async()=>{
      const child=this.spawn(this.python,['-m','knowledge_base.dnd_mcp_server'],{
        cwd:this.cwd,env:this.env,stdio:['pipe','pipe','pipe'],shell:false,windowsHide:true,
      });
      this.child=child;
      child.stderr?.on('data',()=>{}); // drain without copying corpus/process details to logs
      child.once('error',error=>this.fail(error));
      child.once('exit',(code,signal)=>{
        const error=new Error(`Rules MCP exited (${code??signal??'unknown'}).`);
        this.fail(error);this.child=null;this.reader?.close?.();this.reader=null;
      });
      const reader=readline.createInterface({input:child.stdout,crlfDelay:Infinity});
      this.reader=reader;reader.on('line',line=>this.onMessage(line));
      const initialized=await this.request('initialize',{
        protocolVersion:'2024-11-05',
        capabilities:{},
        clientInfo:{name:'odm-narrator-rules',version:'1.0.0'},
      });
      if(!initialized?.serverInfo)throw new Error('Rules MCP initialize response is invalid.');
      this.send({jsonrpc:'2.0',method:'notifications/initialized',params:{}});
      const tools=await this.request('tools/list',{});
      const names=(tools?.tools??[]).map(tool=>tool?.name).filter(Boolean).sort();
      if(JSON.stringify(names)!==JSON.stringify(REQUIRED_TOOLS))throw new Error('Rules MCP exposes an unexpected tool surface.');
      this.lastError=null;
    })().catch(error=>{
      this.fail(error);try{this.child?.kill();}catch{}this.child=null;throw error;
    }).finally(()=>{this.starting=null;});
    return this.starting;
  }
  async call(name,args){
    if(!ALLOWED_TOOLS.has(name))throw new Error('Rules MCP tool is not allowed.');
    await this.start();
    const result=await this.request('tools/call',{name,arguments:args});
    if(result?.isError)throw new Error('Rules MCP tool returned an error.');
    const text=(result?.content??[]).find(item=>item?.type==='text')?.text;
    if(typeof text!=='string'||Buffer.byteLength(text)>262144)throw new Error('Rules MCP tool response is invalid.');
    let value;try{value=JSON.parse(text);}catch{throw new Error('Rules MCP tool returned malformed JSON.');}
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Rules MCP tool returned invalid data.');
    return value;
  }
  sanitizeSearch(value,query){
    if(value.error)return {ok:false,error:clip(value.error,300),retryable:Boolean(value.retryable),query:clip(query,500),untrusted:true};
    const hits=Array.isArray(value.hits)?value.hits.slice(0,8).map(hit=>({
      documentId:clip(hit?.document_id,120),title:clip(hit?.title,240),source:clip(hit?.source,300),
      section:clip(hit?.section,200),pageStart:Number.isSafeInteger(hit?.page_start)?hit.page_start:null,
      pageEnd:Number.isSafeInteger(hit?.page_end)?hit.page_end:null,
      lexicalCoverage:Number(hit?.lexical_coverage)||0,snippet:clip(hit?.snippet,700),
    })): [];
    const confidence=value.confidence&&typeof value.confidence==='object'?{
      level:clip(value.confidence.level,20),knowledgeGap:Boolean(value.confidence.knowledge_gap),
      reason:clip(value.confidence.reason,400),lexicalCoverage:Number(value.confidence.lexical_coverage)||0,
    }:null;
    const result={ok:true,query:clip(query,500),edition:clip(value.edition,80),source:clip(value.source,200),
      audience:'public_rules',corpusRevision:/^[a-f0-9]{64}$/.test(value.corpus_revision??'')?value.corpus_revision:null,
      cacheHit:Boolean(value.cache_hit),confidence,hits,context:clip(value.context,12000),untrusted:true};
    this.lastRevision=result.corpusRevision;return result;
  }
  async search(query){
    query=String(query??'').trim();
    if(!query||query.length>500)throw new Error('Rules lookup query must be 1..500 characters.');
    let value;
    for(let attempt=0;attempt<2;attempt++){
      try{value=await this.call('rules_search',{query,top_k:this.topK,edition:this.edition,audience:'public_rules'});break;}
      catch(error){
        if(attempt)throw error;
        this.fail(error);try{this.child?.kill();}catch{}this.child=null;this.reader?.close?.();this.reader=null;
      }
    }
    return this.sanitizeSearch(value,query);
  }
  async close(){
    this.closed=true;
    if(this.starting)await this.starting.catch(()=>{});
    this.fail(new Error('Rules MCP client closed.'));
    const child=this.child;this.child=null;this.reader?.close?.();this.reader=null;
    if(child){
      try{child.stdin?.end();}catch{}
      try{child.kill('SIGTERM');}catch{}
    }
  }
}

export function createRulesMcpClientFromEnv(options={}){
  const python=options.python??process.env.ODM_RULES_MCP_PYTHON;
  if(!python)return null;
  return new RulesMcpClient({
    python,cwd:options.cwd??process.env.ODM_RULES_MCP_CWD,
    edition:options.edition??process.env.ODM_RULES_EDITION,
    collection:options.collection??process.env.ODM_RULES_MCP_COLLECTION??'dnd_srd',
    timeoutMs:options.timeoutMs??process.env.ODM_RULES_MCP_TIMEOUT_MS,
    topK:options.topK??process.env.ODM_RULES_MCP_TOP_K,
    env:options.env,
  });
}
