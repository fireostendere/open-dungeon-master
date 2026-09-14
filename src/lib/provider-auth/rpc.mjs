/** Bounded JSON-RPC over the official Codex app-server's stdio. No token extraction. */
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { ProviderError } from './core.mjs';

export class CodexRpc extends EventEmitter {
  constructor({command = 'codex', args = ['app-server'], cwd, env, spawnProcess = spawn, timeoutMs = 30000}) {
    super();
    this.nextId = 1; this.pending = new Map(); this.buffer = ''; this.timeoutMs = timeoutMs; this.closed = false;
    this.child = spawnProcess(/*turbopackIgnore: true*/ command, args, {cwd, env, shell:false, windowsHide:true, stdio:['pipe','pipe','pipe']});
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', chunk => this.feed(chunk));
    // Diagnostics may contain credentials. Do not forward raw stderr to clients or logs.
    this.child.stderr.on('data', () => {});
    this.child.on('error', () => this.close(new ProviderError('CODEX_NOT_INSTALLED_OR_NOT_EXECUTABLE', 503)));
    this.child.on('exit', () => this.close(new ProviderError('CODEX_PROCESS_EXITED', 503)));
    this.child.stdin.on('error', () => this.close(new ProviderError('CODEX_PIPE_CLOSED', 503)));
  }
  async initialize() {
    await this.request('initialize', {clientInfo:{name:'odm_provider_bridge',title:'Open Dungeon Master',version:'0.1.0'},capabilities:{experimentalApi:true}});
    this.notify('initialized', {});
  }
  feed(chunk) {
    if (this.closed) return;
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer) > 4 * 1024 * 1024) return this.close(new ProviderError('CODEX_FRAME_TOO_LARGE',502));
    let i;
    while ((i = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0,i).trim(); this.buffer = this.buffer.slice(i+1);
      if (!line) continue;
      let msg;
      try { msg=JSON.parse(line); } catch { return this.close(new ProviderError('CODEX_INVALID_JSON',502)); }
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return this.close(new ProviderError('CODEX_INVALID_MESSAGE',502));
      if (msg.method && msg.id !== undefined) {
        if (this.listenerCount('request')) this.emit('request',msg);
        else this.replyError(msg.id,'Unsupported server request');
      } else if (msg.method) this.emit('notification',msg);
      else if (msg.id !== undefined) {
        const p=this.pending.get(msg.id); if (!p) continue;
        this.pending.delete(msg.id); clearTimeout(p.timer);
        if (msg.error) p.reject(new ProviderError(`CODEX_RPC_ERROR_${Number.isInteger(msg.error.code) ? msg.error.code : 'UNKNOWN'}`,502));
        else p.resolve(msg.result);
      }
    }
  }
  send(msg) {
    if (this.closed) throw new ProviderError('CODEX_PIPE_CLOSED',503);
    this.child.stdin.write(JSON.stringify(msg)+'\n');
  }
  request(method, params, timeoutMs=this.timeoutMs) {
    if (this.closed) return Promise.reject(new ProviderError('CODEX_PIPE_CLOSED',503));
    if (this.pending.size >= 64) return Promise.reject(new ProviderError('CODEX_TOO_MANY_REQUESTS',429));
    const id=this.nextId++;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id); reject(new ProviderError('CODEX_RPC_TIMEOUT',504));},timeoutMs);
      this.pending.set(id,{resolve,reject,timer});
      try { this.send({id,method,params}); } catch(e) {clearTimeout(timer); this.pending.delete(id);reject(e);}
    });
  }
  notify(method,params) { this.send({method,params}); }
  reply(id,result) { this.send({id,result}); }
  replyError(id,message='Unsupported server request') { this.send({id,error:{code:-32601,message}}); }
  close(reason=new ProviderError('CODEX_CLOSED',503)) {
    if (this.closed) return;
    this.closed=true;
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(reason);} this.pending.clear();
    this.buffer=''; this.child.kill(); this.emit('closed',reason);
  }
}
