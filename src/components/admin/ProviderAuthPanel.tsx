'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
type Model={id:string;displayName:string};
type Login={operationId:string;authUrl:string;userCode:string|null;expiresAt:number;state:string};
type ProfileItem={id:string;name:string;model:string;baseUrl?:string;lastCheck:{ok:boolean}|null};
type Reply={available?:boolean;authenticated?:boolean;account?:{email:string|null;planType:string|null}|null;login?:Login|null;operationId?:string;authUrl?:string;userCode?:string|null;expiresAt?:number;state?:string;models?:Model[];profiles?:ProfileItem[];profile?:{id:string};report?:{ok:boolean;stages:Record<string,{ok:boolean;ms?:number;detail?:string}>};applied?:boolean;error?:string};
const field='w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100';
const button='rounded border border-slate-600 px-3 py-2 text-sm disabled:opacity-40';
export default function ProviderAuthPanel(){
  const [status,setStatus]=useState<Reply>({authenticated:false});
  const [models,setModels]=useState<Model[]>([]),[chatModel,setChatModel]=useState('');
  const [provider,setProvider]=useState('qwen-local'),[providerModels,setProviderModels]=useState<Model[]>([]);
  const [model,setModel]=useState(''),[key,setKey]=useState(''),[baseUrl,setBaseUrl]=useState('http://127.0.0.1:11434/v1'),[region,setRegion]=useState('international');
  const [apply,setApply]=useState(true),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[result,setResult]=useState<Reply|null>(null);
  const [savedProfiles,setSavedProfiles]=useState<ProfileItem[]>([]);
  const alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const request=useCallback(async(body:Record<string,unknown>):Promise<Reply>=>{
    const response=await fetch('/api/admin/provider-auth',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-ODM-Provider-Auth':'1'},body:JSON.stringify(body)});
    const data:Reply=await response.json();if(!response.ok)throw new Error(data.error??`HTTP_${response.status}`);return data;
  },[]);
  const refreshProfiles=useCallback(async()=>{
    try{const data=await request({action:'profiles'});if(alive.current&&data.profiles)setSavedProfiles(data.profiles);}catch{}
  },[request]);
  const refresh=useCallback(async()=>{
    const data=await request({action:'status',provider:'chatgpt'});
    if(alive.current){setStatus(data);if(data.error)setNotice(data.error);}
    await refreshProfiles();
  },[request,refreshProfiles]);
  useEffect(()=>{
    let cancelled=false;
    request({action:'status',provider:'chatgpt'}).then(data=>{if(!cancelled){setStatus(data);if(data.error)setNotice(data.error);}}).catch(e=>{if(!cancelled)setNotice(String(e.message));});
    request({action:'profiles'}).then(data=>{if(!cancelled&&data.profiles)setSavedProfiles(data.profiles);}).catch(()=>{});
    return()=>{cancelled=true;};
  },[request]);
  useEffect(()=>{if(!status.login)return;const timer=setInterval(()=>void refresh().catch(e=>{if(alive.current)setNotice(String(e.message));}),2000);return()=>clearInterval(timer);},[status.login,refresh]);
  async function run(fn:()=>Promise<void>){setBusy(true);setNotice('');try{await fn();}catch(e){if(alive.current)setNotice(e instanceof Error?e.message:'PROVIDER_OPERATION_FAILED');}finally{if(alive.current)setBusy(false);}}
  async function login(mode:'browser'|'device'){await run(async()=>{const data=await request({action:'login',provider:'chatgpt',mode});if(data.operationId&&data.authUrl)setStatus(s=>({...s,login:data as Login}));});}
  async function connect(selected:string,id:string){await run(async()=>{try{const data=await request({action:'connect',provider:selected,model:id,apiKey:selected==='chatgpt'?undefined:key,baseUrl,region,apply});setResult(data);setNotice(data.applied?'Модель проверена и применяется как DM по умолчанию.':data.report?.ok?'Профиль проверен и сохранён.':'Проверка не пройдена. Текущая модель DM не изменена.');await refreshProfiles();}finally{setKey('');}});}
  return <section className="space-y-6" aria-label="Подключение LLM">
    <label className="flex gap-2"><input type="checkbox" checked={apply} disabled={busy} onChange={e=>setApply(e.target.checked)}/>После успешной проверки применить как DM по умолчанию</label>
    <div className="rounded border border-slate-700 p-4 space-y-3">
      <h2 className="text-xl font-semibold">ChatGPT: вход через Codex</h2>
      <p className="text-sm">Официальный Codex CLI должен быть установлен на сервере. ODM использует отдельный профиль входа. Для WSL или удалённого сервера выбирайте код устройства.</p>
      <p role="status">{status.authenticated?`Подключено: ${status.account?.email??'ChatGPT'} (${status.account?.planType??'план не указан'})`:'ChatGPT не подключён'}</p>
      <div className="flex flex-wrap gap-2">
        <button className={button} disabled={busy||!!status.login||status.authenticated} onClick={()=>void login('device')}>Войти по коду устройства</button>
        <button className={button} disabled={busy||!!status.login||status.authenticated} onClick={()=>void login('browser')}>Войти в браузере на серверном ПК</button>
        <button className={button} disabled={busy} onClick={()=>void run(refresh)}>Обновить статус</button>
        <button className={button} disabled={busy||!status.authenticated} onClick={()=>void run(async()=>{await request({action:'logout',provider:'chatgpt'});setModels([]);setChatModel('');setResult(null);await refresh();})}>Выйти</button>
      </div>
      {status.login&&<div className="space-y-2" role="status">
        <p><a className="underline" href={status.login.authUrl} target="_blank" rel="noopener noreferrer">Открыть официальный вход ChatGPT</a></p>
        {status.login.userCode&&<p>Код устройства: <code>{status.login.userCode}</code>. Введите его только на официальной странице входа.</p>}
        <button className={button} disabled={busy} onClick={()=>void run(async()=>{await request({action:'cancel',provider:'chatgpt',operationId:status.login?.operationId});await refresh();})}>Отменить вход</button>
      </div>}
      <button className={button} disabled={busy||!status.authenticated} onClick={()=>void run(async()=>{const data=await request({action:'models',provider:'chatgpt'});setModels(data.models??[]);setChatModel(data.models?.[0]?.id??'');})}>Получить доступные модели</button>
      <select className={field} aria-label="Модель ChatGPT" value={chatModel} onChange={e=>setChatModel(e.target.value)} disabled={busy||!models.length}><option value="">Выберите модель</option>{models.map(m=><option key={m.id} value={m.id}>{m.displayName} — {m.id}</option>)}</select>
      <button className={button} disabled={busy||!chatModel||!status.authenticated} onClick={()=>void connect('chatgpt',chatModel)}>Подключить ChatGPT и проверить инструменты</button>
      <p className="text-sm">Используется официальный экспериментальный API dynamicTools. Игровые действия выполняет ODM. Системные инструменты и приложения для модели отключены. Выход прерывает текущие ходы ChatGPT. Лимиты определяются аккаунтом; потоковый вывод пока не поддерживается.</p>
    </div>
    <div className="rounded border border-slate-700 p-4 space-y-3">
      <h2 className="text-xl font-semibold">Gemini и Qwen</h2>
      <p className="text-sm">Gemini: официальный API-ключ, не OAuth подписки Google. Qwen: API-ключ или локальная модель без облачного входа. Старый Qwen OAuth отключён провайдером.</p>
      {/* Explicit names prevent nested option text from becoming the select's label. */}
      <label className="block">Провайдер<select aria-label="Провайдер" className={field} value={provider} disabled={busy} onChange={e=>{setProvider(e.target.value);setKey('');setModel('');setProviderModels([]);setResult(null);setNotice('');}}><option value="qwen-local">Qwen локально / совместимый сервер</option><option value="qwen">Qwen / DashScope API</option><option value="gemini">Gemini Developer API</option></select></label>
      {provider==='qwen-local'&&<div className="space-y-1">
        <label className="block">Адрес runtime (локальный или удалённый сервер)
          <input aria-label="Адрес runtime" className={field} value={baseUrl} disabled={busy} onChange={e=>setBaseUrl(e.target.value)} placeholder="http://127.0.0.1:11434/v1 или http://remote-ip:11434/v1"/>
        </label>
        <div className="flex flex-wrap gap-2 text-xs">
          <button type="button" className="underline text-slate-400 hover:text-slate-200" onClick={()=>setBaseUrl('http://127.0.0.1:11434/v1')}>Локальный (127.0.0.1:11434)</button>
          <button type="button" className="underline text-slate-400 hover:text-slate-200" onClick={()=>setBaseUrl('http://host.docker.internal:11434/v1')}>Docker host (host.docker.internal)</button>
        </div>
      </div>}
      {provider==='qwen'&&<label className="block">Регион ключа<select aria-label="Регион ключа" className={field} value={region} disabled={busy} onChange={e=>{setRegion(e.target.value);setKey('');setModel('');setProviderModels([]);setResult(null);setNotice('');}}><option value="international">International</option><option value="china">China</option><option value="token-plan">Token Plan (Singapore)</option></select></label>}
      <label className="block">{provider==='qwen-local'?'Ключ runtime, если установлен':'API-ключ'}<input className={field} type="password" value={key} disabled={busy} onChange={e=>setKey(e.target.value)} autoComplete="new-password" spellCheck={false}/></label>
      <button className={button} disabled={busy||(provider!=='qwen-local'&&!key)} onClick={()=>void run(async()=>{const data=await request({action:'models',provider,apiKey:key,baseUrl,region});setProviderModels(data.models??[]);})}>Загрузить модели провайдера</button>
      <datalist id="odm-provider-models">{providerModels.map(m=><option key={m.id} value={m.id}/>)}</datalist>
      <label className="block">Точный ID модели<input list="odm-provider-models" className={field} value={model} disabled={busy} onChange={e=>setModel(e.target.value)} autoComplete="off"/></label>
      <button className={button} disabled={busy||!model||(provider!=='qwen-local'&&!key)} onClick={()=>void connect(provider,model)}>Подключить и проверить инструменты</button>
      <p className="text-sm">Модель можно ввести вручную, если провайдер не выдаёт список. Ключ хранится в существующей зашифрованной БД ODM. Неуспешная проверка не меняет текущего DM.</p>
    </div>
    {savedProfiles.length>0&&<div className="rounded border border-slate-700 p-4 space-y-3">
      <h2 className="text-xl font-semibold">Сохранённые профили моделей</h2>
      <p className="text-sm">Список проверенных профилей подключения. Любой проверенный профиль можно переключить как основной DM одним кликом.</p>
      <div className="space-y-2">
        {savedProfiles.map((p)=><div key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-3 rounded bg-slate-800 text-sm">
          <div>
            <span className="font-semibold text-slate-200">{p.name}</span> <span className="text-slate-400">({p.model})</span>
            <div className="text-xs text-slate-400">{p.baseUrl||'Codex / bridge'} — {p.lastCheck?.ok ? '✓ проверен' : '✗ не проверен'}</div>
          </div>
          <button className={button} disabled={busy||!p.lastCheck?.ok} onClick={()=>void run(async()=>{await request({action:'apply',profileId:p.id});setNotice(`Профиль "${p.name}" (${p.model}) успешно применён как основной DM.`);await refresh();})}>Применить как DM</button>
        </div>)}
      </div>
    </div>}
    {busy&&<p role="status">Выполняется запрос к провайдеру…</p>}
    {notice&&<p role="status" className="break-words">{notice}</p>}
    {result?.report&&<pre className="overflow-auto">{JSON.stringify({profileId:result.profile?.id,report:result.report,applied:result.applied},null,2)}</pre>}
  </section>;
}
