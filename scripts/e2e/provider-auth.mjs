// Production server + Chromium + real ODM client/dice. Only the external
// Codex service is replaced by an explicit offline fixture, never an account.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
const root=process.cwd(),temp=fs.mkdtempSync(path.join(os.tmpdir(),'odm-browser-'));
const artifacts=path.join(root,'provider-test-results');fs.mkdirSync(artifacts,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let server,browser,local,page;let passed=0;const logs=[];
async function check(name,fn){await fn();passed++;console.log(`PASS ${name}`);}
async function freePort(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
const port=await freePort(),origin=`http://127.0.0.1:${port}`;
const env={...process.env,NODE_ENV:'production',PORT:String(port),COOKIE_SECURE:'0',SQLITE_DB_PATH:path.join(temp,'game.sqlite'),DB_ENCRYPTION_KEY:randomBytes(32).toString('hex'),ODM_PROVIDER_AUTH_HOME:path.join(temp,'provider-auth'),ODM_LOCAL_ORIGIN:origin,ODM_CODEX_BINARY:path.join(root,'scripts/fixtures/provider-codex.mjs'),NEXT_TELEMETRY_DISABLED:'1',VOICE_ENABLED:'0'};
for(const key of Object.keys(env))if(/API_KEY|ACCESS_TOKEN|REFRESH_TOKEN/.test(key))delete env[key];
async function start(){
  server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{cwd:root,env,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
  for(const stream of [server.stdout,server.stderr])stream.on('data',b=>logs.push(b.toString()));
  for(let i=0;i<120;i++){if(server.exitCode!==null)throw new Error('Next exited: '+logs.join('').slice(-12000));try{if((await fetch(origin+'/api/health')).ok)return;}catch{}await sleep(250);}
  throw new Error('Server startup timeout');
}
async function stop(){if(!server)return;const p=server;server=null;try{if(process.platform!=='win32')process.kill(-p.pid,'SIGTERM');else p.kill();}catch{}await Promise.race([new Promise(r=>p.once('exit',r)),sleep(2000)]);}
async function runScript(file,args=[],input=''){
  return new Promise((resolve,reject)=>{const p=spawn(process.execPath,[file,...args],{cwd:root,env,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';p.stdout.on('data',d=>stdout+=d);p.stderr.on('data',d=>stderr+=d);p.on('error',reject);const timer=setTimeout(()=>{p.kill();reject(new Error('Script timeout: '+file));},30000);p.on('exit',code=>{clearTimeout(timer);resolve({code,stdout,stderr});});p.stdin.end(input);});
}
const cli=(args,input)=>runScript('scripts/odm-auth.mjs',args,input);
async function register(context,username,isAdmin){
  const response=await context.request.post('/api/auth/register',{data:{username,password:randomBytes(12).toString('hex')}});
  assert.ok(response.ok(),await response.text());
  const account=(await response.json()).user;
  assert.ok(account?.id,'successful signup must create an account');
  assert.equal(account.username,username);assert.equal(account.isAdmin,isAdmin);
  const me=await context.request.get('/api/auth/me');assert.ok(me.ok());
  assert.equal((await me.json()).user.id,account.id,'signup must establish a usable browser session');
}
try{
  await start();browser=await chromium.launch({headless:true});
  const context=await browser.newContext({baseURL:origin});
  await register(context,'provider_admin',true);
  page=await context.newPage();const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
  await page.goto('/admin');await page.getByRole('radio',{name:'Подключения LLM'}).click();
  const post=(data,headers={})=>context.request.post('/api/admin/provider-auth',{data,headers:{Origin:origin,'X-ODM-Provider-Auth':'1',...headers}});
  const modelInput=page.locator('input[list="odm-provider-models"]');
  async function connectButton(name,provider){
    const response=page.waitForResponse(r=>r.url().endsWith('/api/admin/provider-auth')&&r.request().postDataJSON()?.action==='connect'&&r.request().postDataJSON()?.provider===provider);
    await page.getByRole('button',{name,exact:true}).click();const r=await response;
    assert.equal(r.status(),200,await r.text());assert.equal((await r.json()).report.ok,true);
    await page.getByText('Модель проверена и применяется как DM по умолчанию.',{exact:true}).waitFor();
  }
  await check('unauthenticated admin/control/inference rejected',async()=>{
    assert.equal((await fetch(origin+'/api/internal/provider-control',{method:'POST',body:'{}'})).status,401);
    assert.equal((await fetch(origin+'/api/internal/codex/v1/models')).status,401);
    assert.equal((await fetch(origin+'/api/admin/provider-auth',{method:'POST',body:'{}'})).status,401);
  });
  await check('cross-origin and oversized admin requests rejected',async()=>{
    assert.equal((await post({action:'status',provider:'chatgpt'},{Origin:'https://other.example.test'})).status(),403);
    assert.equal((await post({action:'status',provider:'chatgpt',padding:'x'.repeat(66000)})).status(),413);
  });
  await check('device login from browser UI',async()=>{
    await page.getByRole('button',{name:'Войти по коду устройства',exact:true}).click();
    const link=page.getByRole('link',{name:'Открыть официальный вход ChatGPT'});await link.waitFor();assert.match(await link.getAttribute('href'),/^https:\/\/auth.openai.com\//);
    await page.getByText('Подключено:',{exact:false}).waitFor();
  });
  await check('model discovery, native tool probe and apply from browser UI',async()=>{
    await page.getByRole('button',{name:'Получить доступные модели',exact:true}).click();await page.getByLabel('Модель ChatGPT').selectOption('fixture-model');
    await connectButton('Подключить ChatGPT и проверить инструменты','chatgpt');
    const conf=await(await context.request.get('/api/admin/settings')).json();assert.equal(conf.config.text.customModel,'fixture-model');assert.match(conf.config.text.customBaseUrl,/api\/internal\/codex\/v1\/chat\/completions$/);
    const profiles=await(await context.request.get('/api/admin/llm-profiles')).text();for(const name of ['control.key','inference.key'])assert.ok(!profiles.includes(fs.readFileSync(path.join(env.ODM_PROVIDER_AUTH_HOME,name),'utf8').trim()),'secret leaked');
  });
  await check('CLI shares admin account and profiles',async()=>{
    const s=await cli(['status','chatgpt']);assert.equal(s.code,0,s.stderr);assert.equal(JSON.parse(s.stdout).authenticated,true);
    const m=await cli(['models','chatgpt']);assert.equal(m.code,0,m.stderr);assert.equal(JSON.parse(m.stdout).models[0].id,'fixture-model');
    const c=await cli(['connect','chatgpt','--model','fixture-model','--apply']);assert.equal(c.code,0,c.stderr);assert.equal(JSON.parse(c.stdout).report.ok,true);
  });
  await check('actual ODM model client and actual dice round trip',async()=>{
    const r=await runScript('scripts/e2e/provider-model-roundtrip.mjs');assert.equal(r.code,0,r.stderr);console.log(r.stdout.trim());
  });
  await check('invalid model leaves working DM unchanged',async()=>{
    assert.equal((await post({action:'apply',profileId:'missing-profile'})).status(),404);
    assert.equal((await post({action:'connect',provider:'chatgpt',model:'invented-model',apply:true})).status(),400);
    assert.equal((await(await context.request.get('/api/admin/settings')).json()).config.text.customModel,'fixture-model');
  });
  await check('account and profiles survive production server restart',async()=>{
    await stop();await start();await page.reload();await page.getByRole('radio',{name:'Подключения LLM'}).click();await page.getByText('Подключено:',{exact:false}).waitFor();
    assert.equal((await(await context.request.get('/api/admin/settings')).json()).config.text.customModel,'fixture-model');
  });
  await check('browser logout and browser-login mode',async()=>{
    await page.getByRole('button',{name:'Выйти',exact:true}).click();await page.getByText('ChatGPT не подключён',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Войти в браузере на серверном ПК',exact:true}).click();await page.getByRole('link',{name:'Открыть официальный вход ChatGPT'}).waitFor();await page.getByText('Подключено:',{exact:false}).waitFor();
  });
  await check('local runtime UI/CLI and rejection of text-only model',async()=>{
    local=createServer(async(req,res)=>{
      if(req.url==='/v1/models'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:'local-test-model'}]}));return;}
      let raw='';for await(const chunk of req)raw+=chunk;const b=JSON.parse(raw);let message;
      if(b.model==='text-only-broken')message={role:'assistant',content:'I would call a tool'};
      else if(b.tools?.length&&b.tool_choice!=='none')message={role:'assistant',content:null,tool_calls:[{id:'local-call',type:'function',function:{name:'probe_echo',arguments:'{"word":"куб","n":7}'}}]};
      else message={role:'assistant',content:'Готово, результат принят'};
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message}]}));
    });await new Promise(r=>local.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${local.address().port}/v1`;
    await page.getByLabel('Провайдер',{exact:true}).selectOption('qwen-local');await page.getByLabel('Адрес runtime',{exact:true}).fill(base);
    await page.getByRole('button',{name:'Загрузить модели провайдера',exact:true}).click();await modelInput.fill('local-test-model');
    await connectButton('Подключить и проверить инструменты','qwen-local');assert.equal((await(await context.request.get('/api/admin/settings')).json()).config.text.customModel,'local-test-model');
    assert.equal((await post({action:'connect',provider:'qwen-local',model:'text-only-broken',baseUrl:base,apply:true})).status(),409);
    assert.equal((await(await context.request.get('/api/admin/settings')).json()).config.text.customModel,'local-test-model');
    const c=await cli(['connect','qwen-local','--model','local-test-model','--base-url',base,'--apply']);assert.equal(c.code,0,c.stderr);
  });
  await check('Gemini/Qwen API forms require credentials honestly',async()=>{
    for(const provider of ['gemini','qwen']){await page.getByLabel('Провайдер',{exact:true}).selectOption(provider);await modelInput.fill('model-id');assert.equal(await page.getByRole('button',{name:'Подключить и проверить инструменты',exact:true}).isDisabled(),true);assert.equal((await post({action:'connect',provider,model:'model-id'})).status(),400);}
  });
  await check('nonadmin cannot operate provider controls',async()=>{
    assert.equal((await context.request.patch('/api/admin/settings',{data:{signupMode:'open'}})).status(),200);
    const visitor=await browser.newContext({baseURL:origin});await register(visitor,'provider_guest',false);
    assert.equal((await visitor.request.post('/api/admin/provider-auth',{data:{action:'status',provider:'chatgpt'},headers:{Origin:origin,'X-ODM-Provider-Auth':'1'}})).status(),403);await visitor.close();
  });
  await check('no browser exceptions',async()=>assert.deepEqual(pageErrors,[]));
  await page.screenshot({path:path.join(artifacts,'provider-admin.png'),fullPage:true});fs.writeFileSync(path.join(artifacts,'summary.json'),JSON.stringify({passed,provider:'test fixture; not a personal login'},null,2));console.log(`All ${passed} browser/HTTP/CLI integration checks passed.`);
}catch(error){console.error(error);process.exitCode=1;fs.writeFileSync(path.join(artifacts,'failure.txt'),String(error.stack??error));if(page)await page.screenshot({path:path.join(artifacts,'failure.png'),fullPage:true}).catch(()=>{});}
finally{if(browser)await browser.close();await stop();if(local)await new Promise(r=>local.close(r));fs.writeFileSync(path.join(artifacts,'server.log'),logs.join(''));fs.rmSync(temp,{recursive:true,force:true});}
