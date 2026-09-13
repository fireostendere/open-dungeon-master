// Test-only app-server process. Selected explicitly by ODM_CODEX_BINARY in CI.
// It does not authenticate any real provider account or make network requests.
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
const file=path.join(process.env.CODEX_HOME,'fixture-account.json');
let authenticated=fs.existsSync(file),login=null,counter=0;
const threads=new Map(),requests=new Map();
const send=m=>process.stdout.write(JSON.stringify(m)+'\n');
function finish(id,text){send({method:'item/completed',params:{threadId:id,item:{type:'agentMessage',text}}});send({method:'turn/completed',params:{threadId:id,turn:{id:'t1',status:'completed'}}});}
const input=readline.createInterface({input:process.stdin});
input.on('line',line=>{
  const m=JSON.parse(line),p=m.params??{};let result={};
  if(!m.method){const id=requests.get(m.id);if(id){requests.delete(m.id);finish(id,`Принят результат движка: ${m.result?.contentItems?.[0]?.text??'нет результата'}`);}return;}
  switch(m.method){
    case 'initialize':result={userAgent:'odm-ci-fixture'};break;
    case 'account/read':result={account:authenticated?{type:'chatgpt',email:'fixture@example.test',planType:'test-only'}:null};break;
    case 'account/login/start':{
      login='test-login-'+(++counter);const id=login;
      result=p.type==='chatgptDeviceCode'?{type:'chatgptDeviceCode',loginId:id,verificationUrl:'https://auth.openai.com/codex/device',userCode:'TEST-ONLY'}:{type:'chatgpt',loginId:id,authUrl:'https://auth.openai.com/authorize?state=test-only'};
      setTimeout(()=>{if(login!==id)return;authenticated=true;login=null;fs.writeFileSync(file,'fixture',{mode:0o600});send({method:'account/login/completed',params:{loginId:id,success:true,error:null}});},700);break;
    }
    case 'account/login/cancel':login=null;break;
    case 'account/logout':authenticated=false;fs.rmSync(file,{force:true});break;
    case 'model/list':result={data:[{id:'fixture-internal',model:'fixture-model',displayName:'CI fixture model'}],nextCursor:null};break;
    case 'thread/start':{const id='thread-'+(++counter);threads.set(id,p);result={thread:{id}};break;}
    case 'turn/start':{
      result={turn:{id:'t1'}};
      setTimeout(()=>{const t=threads.get(p.threadId);if(!t)return;const spec=t.dynamicTools?.[0];if(!spec){finish(p.threadId,'Готово');return;}const id='tool-'+(++counter);requests.set(id,p.threadId);send({id,method:'item/tool/call',params:{threadId:p.threadId,turnId:'t1',tool:spec.name,namespace:null,callId:id,arguments:spec.description.includes('probe_echo')?{word:'куб',n:7}:{sides:20}}});},10);break;
    }
    case 'thread/archive':threads.delete(p.threadId);break;
  }
  if(m.id!==undefined)send({id:m.id,result});
});
