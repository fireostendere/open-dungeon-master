// Browser + CLI + production server integration with an explicit test-only
// Codex process. Never uses a personal account or external model service.
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
let server,browser,local;const logs=[];let passed=0;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function check(name,fn){await fn();passed++;console.log(`PASS ${name}`);}
async function freePort(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
const port=await freePort(),origin=`http://127.0.0.1:${port}`;
const env={...process.env,NODE_ENV:'production',PORT:String(port),COOKIE_SECURE:'0',SQLITE_DB_PATH:path.join(temp,'game.sqlite'),DB_ENCRYPTION_KEY:randomBytes(32).toString('hex'),ODM_PROVIDER_AUTH_HOME:path.join(temp,'provider-auth'),ODM_LOCAL_ORIGIN:origin,ODM_CODEX_BINARY:path.join(root,'scripts/fixtures/provider-codex.mjs'),NEXT_TELEMETRY_DISABLED:'1',VOICE_ENABLED:'0'};
// Integration tests are isolated from whatever API keys may exist in a dev shell.
for(const key of Object.keys(env))if(/API_KEY|ACCESS_TOKEN|REFRESH_TOKEN/.test(key))delete env[key];
async function start(){
  server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{cwd:root,env,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
  for(const stream of [server.stdout,server.stderr])stream.on('data',b=>logs.push(b.toString()));
  for(let i=0;i<120;i++){if(server.exitCode!==null)throw new Error('Next server exited: '+logs.join('').slice(-12000));try{const r=await fetch(origin+'/api/health');if(r.ok)return;}catch{}await sleep(250);}
  throw new Error('Server did not become healthy');
}
async function stop(){if(!server)return;const p=server;server=null;try{if(process.platform!=='win32')process.kill(-p.pid,'SIGTERM');else p.kill();}catch{}await Promise.race([new Promise(r=>p.once('exit',r)),sleep(2000)]);}
async function cli(args,input=''){
  return new Promise((resolve,reject)=>{const p=spawn(process.execPath,['scripts/odm-auth.mjs',...args],{cwd:root,env,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';p.stdout.on('data',d=>stdout+=d);p.stderr.on('data',d=>stderr+=d);p.on('error',reject);const timer=setTimeout(()=>{p.kill();reject(new Error('CLI timed out'));},20000);p.on('exit',code=>{clearTimeout(timer);resolve({code,stdout,stderr});});p.stdin.end(input);});
}
try{
  await start();browser=await chromium.launch({headless:true});
  const context=await browser.newContext({baseURL:origin});
  const reg=await context.request.post('/api/auth/register',{data:{username:'provider_admin',password:randomBytes(12).toString('hex')}});
  assert.equal(reg.status(),201,await reg.text());
  const page=await context.newPage();const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
  await page.goto('/admin');await page.getByRole('radio',{name:'Подключения LLM'}).click();
  const post=(data,headers={})=>context.request.post('/api/admin/provider-auth',{data,headers:{Origin:origin,'X-ODM-Provider-Auth':'1',...headers}});
  await check('unauthenticated control and inference endpoints reject requests',async()=>{
    assert.equal((await fetch(origin+'/api/internal/provider-control',{method:'POST',body:'{}'})).status,401);
    assert.equal((await fetch(origin+'/api/internal/codex/v1/models')).status,401);
    assert.equal((await fetch(origin+'/api/admin/provider-auth',{method:'POST',body:'{}'})).status,401);
  });
  await check('admin endpoint rejects cross-origin writes and oversize bodies',async()=>{
    assert.equal((await post({action:'status',provider:'chatgpt'},{Origin:'https://other.example.test'})).status(),403);
    assert.equal((await post({action:'status',provider:'chatgpt',padding:'x'.repeat(66000)})).status(),413);
  });
  await check('device login is usable from the admin page',async()=>{
    await page.getByRole('button',{name:'Войти по коду устройства',exact:true}).click();
    const link=page.getByRole('link',{name:'Открыть официальный вход ChatGPT'});await link.waitFor();
    assert.match(await link.getAttribute('href'),/^https:\/\/auth.openai.com\//);
    await page.getByText('Подключено:',{exact:false}).waitFor();
  });
  await check('model list and native tool probe connect ChatGPT through actual HTTP routes',async()=>{
    await page.getByRole('button',{name:'Получить доступные модели',exact:true}).click();
    await page.getByLabel('Модель ChatGPT').selectOption('fixture-model');
    await page.getByRole('button',{name:'Подключить ChatGPT и проверить инструменты',exact:true}).click();
    await page.getByText('Модель проверена и применяется как DM по умолчанию.',{exact:true}).waitFor({timeout:30000});
    const conf=await(await context.request.get('/api/admin/settings')).json();
    assert.equal(conf.config.text.customModel,'fixture-model');assert.match(conf.config.text.customBaseUrl,/api\/internal\/codex\/v1\/chat\/completions$/);
    const profiles=await(await context.request.get('/api/admin/llm-profiles')).text();
    for(const name of ['control.key','inference.key'])assert.ok(!profiles.includes(fs.readFileSync(path.join(env.ODM_PROVIDER_AUTH_HOME,name),'utf8').trim()),'credential leaked into profile API');
  });
  await check('CLI uses the same connected account and model list',async()=>{
    const status=await cli(['status','chatgpt']);assert.equal(status.code,0,status.stderr);assert.equal(JSON.parse(status.stdout).authenticated,true);
    const models=await cli(['models','chatgpt']);assert.equal(models.code,0,models.stderr);assert.equal(JSON.parse(models.stdout).models[0].id,'fixture-model');
    const connect=await cli(['connect','chatgpt','--model','fixture-model','--apply']);assert.equal(connect.code,0,connect.stderr);assert.equal(JSON.parse(connect.stdout).report.ok,true);
  });
  await check('profile cannot apply without successful tool probe',async()=>{
    const r=await post({action:'apply',profileId:'missing-profile'});assert.equal(r.status(),404);
    const bad=await post({action:'connect',provider:'chatgpt',model:'invented-model',apply:true});assert.equal(bad.status(),400);
    assert.equal((await(await context.request.get('/api/admin/settings')).json()).config.text.customModel,'fixture-model');
  });
  await check('account and profiles survive production server restart',async()=>{
    await stop();await start();await page.reload();await page.getByRole('radio',{name:'Подключения LLM'}).click();await page.getByText('Подключено:',{exact:false}).waitFor();
    assert.equal((await(await context.request.get('/api/admin/settings')).json()).config.text.customModel,'fixture-model');
  });
  await check('browser logout and browser-login mode work',async()=>{
    await page.getByRole('button',{name:'Выйти',exact:true}).click();await page.getByText('ChatGPT не подключён',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Войти в браузере на серверном ПК',exact:true}).click();await page.getByRole('link',{name:'Открыть официальный вход ChatGPT'}).waitFor();await page.getByText('Подключено:',{exact:false}).waitFor();
  });
  await check('local Qwen can be selected in the admin without an API key',async()=>{
    local=createServer(async(req,res)=>{
      if(req.url==='/v1/models'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:'local-test-model'}]}));return;}
      let raw='';for await(const chunk of req)raw+=chunk;const b=JSON.parse(raw);let message;
      if(b.model==='text-only-broken')message={role:'assistant',content:'I would call a tool'};
      else if(b.tools?.length&&b.tool_choice!=='none')message={role:'assistant',content:null,tool_calls:[{id:'local-call',type:'function',function:{name:'probe_echo',arguments:'{"word":"куб","n":7}'}}]};
      else message={role:'assistant',content:'Готово, результат принят'};
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message}]}));
    });await new Promise(r=>local.listen(0,'127.0.0.1',r));
    const base=`http://127.0.0.1:${local.address().port}/v1`;
    await page.getByLabel('Провайдер',{exact:true}).selectOption('qwen-local');await page.getByLabel('Адрес runtime',{exact:true}).fill(base);
    await page.getByRole('button',{name:'Загрузить модели провайдера',exact:true}).click();await page.getByLabel('Точный ID модели',{exact:true}).fill('local-test-model');
    await page.getByRole('button',{name:'Подключить и проверить инструменты',exact:true}).click();await page.getByText('Модель проверена и применяется как DM по умолчанию.',{exact:true}).waitFor();
    assert.equal((await(await context.request.get('/api/admin/settings')).json()).config.text.customModel,'local-test-model');
    const failed=await post({action:'connect',provider:'qwen-local',model:'text-only-broken',baseUrl:base,apply:true});assert.equal(failed.status(),409);
    assert.equal((await(await context.request.get('/api/admin/settings')).json()).config.text.customModel,'local-test-model');
    const c=await cli(['connect','qwen-local','--model','local-test-model','--base-url',base,'--apply']);assert.equal(c.code,0,c.stderr);
  });
  await check('Gemini and Qwen API forms require keys rather than claiming OAuth success',async()=>{
    for(const provider of ['gemini','qwen']){
      await page.getByLabel('Провайдер',{exact:true}).selectOption(provider);await page.getByLabel('Точный ID модели',{exact:true}).fill('model-id');
      assert.equal(await page.getByRole('button',{name:'Подключить и проверить инструменты',exact:true}).isDisabled(),true);
      assert.equal((await post({action:'connect',provider,model:'model-id'})).status(),400);
    }
  });
  await check('nonadmin account cannot operate provider connections',async()=>{
    assert.equal((await context.request.patch('/api/admin/settings',{data:{signupMode:'open'}})).status(),200);
    const visitor=await browser.newContext({baseURL:origin});const r=await visitor.request.post('/api/auth/register',{data:{username:'provider_guest',password:randomBytes(12).toString('hex')}});assert.equal(r.status(),201);
    assert.equal((await visitor.request.post('/api/admin/provider-auth',{data:{action:'status',provider:'chatgpt'},headers:{Origin:origin,'X-ODM-Provider-Auth':'1'}})).status(),403);await visitor.close();
  });
  await check('rendering produced no browser exceptions',async()=>assert.deepEqual(pageErrors,[]));
  await page.screenshot({path:path.join(artifacts,'provider-admin.png'),fullPage:true});
  fs.writeFileSync(path.join(artifacts,'summary.json'),JSON.stringify({passed,provider:'test fixture; not a real personal login'},null,2));
  console.log(`All ${passed} browser/HTTP/CLI integration checks passed.`);
}catch(error){console.error(error);process.exitCode=1;fs.writeFileSync(path.join(artifacts,'failure.txt'),String(error.stack??error));}
finally{if(browser)await browser.close();await stop();if(local)await new Promise(r=>local.close(r));fs.writeFileSync(path.join(artifacts,'server.log'),logs.join(''));fs.rmSync(temp,{recursive:true,force:true});}
