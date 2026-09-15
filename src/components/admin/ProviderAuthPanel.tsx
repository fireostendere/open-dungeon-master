'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {useI18n} from '@/lib/i18n';
import {localeText} from '@/lib/i18n/locale-text';
type Model={id:string;displayName:string};
type Login={operationId:string;authUrl:string;userCode:string|null;expiresAt:number;state:string};
type ProfileItem={id:string;name:string;model:string;baseUrl?:string;lastCheck:{ok:boolean}|null};
type Reply={available?:boolean;authenticated?:boolean;account?:{email:string|null;planType:string|null}|null;login?:Login|null;operationId?:string;authUrl?:string;userCode?:string|null;expiresAt?:number;state?:string;models?:Model[];profiles?:ProfileItem[];profile?:{id:string};report?:{ok:boolean;stages:Record<string,{ok:boolean;ms?:number;detail?:string}>};applied?:boolean;error?:string};
const field='w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100';
const button='rounded border border-slate-600 px-3 py-2 text-sm disabled:opacity-40';
const COPY={
  en:{
    ariaLabel:'LLM connection', afterCheck:'Apply as the default DM after a successful check',
    chatTitle:'ChatGPT: sign in through Codex', chatDescription:'The official Codex CLI must be installed on the server. ODM uses a separate sign-in profile. For WSL or a remote server, choose the device code.',
    connected:(email:string,plan:string)=>`Connected: ${email} (${plan})`, notConnected:'ChatGPT is not connected',
    deviceLogin:'Sign in with a device code', browserLogin:'Sign in in a browser on the server PC', refresh:'Refresh status', logout:'Sign out',
    officialLogin:'Open official ChatGPT sign-in', deviceCode:'Device code', officialOnly:'Enter it only on the official sign-in page.', cancelLogin:'Cancel sign-in',
    loadModels:'Load available models', modelAria:'ChatGPT model', chooseModel:'Choose a model', connectChat:'Connect ChatGPT and check tools',
    chatFootnote:'Uses the official experimental dynamicTools API. ODM performs game actions. System tools and apps are disabled for the model. Signing out interrupts current ChatGPT turns. Limits depend on the account; streaming is not supported yet.',
    providersTitle:'Gemini and Qwen', providersDescription:'Gemini: an official API key, not a Google subscription OAuth login. Qwen: an API key or a local model without cloud sign-in. Legacy Qwen OAuth is disabled by the provider.',
    provider:'Provider', qwenLocal:'Qwen local / compatible server', qwenCloud:'Qwen / DashScope API', gemini:'Gemini Developer API', runtime:'Runtime address (local or remote server)', local:'Local (127.0.0.1:11434)', docker:'Docker host (host.docker.internal)', keyRegion:'Key region',
    runtimeKey:'Runtime key, if set', apiKey:'API key', loadProvider:'Load provider models', exactId:'Exact model ID', connect:'Connect and check tools', modelFootnote:'You can enter a model manually if the provider does not return a list. The key is stored in ODM\'s existing encrypted database. A failed check does not change the current DM.',
    savedTitle:'Saved model profiles', savedDescription:'Verified connection profiles. Any verified profile can become the primary DM with one click.', checked:'✓ checked', notChecked:'✗ not checked', bridge:'Codex / bridge', applyAsDm:'Apply as DM', appliedProfile:(name:string,model:string)=>`Profile "${name}" (${model}) was applied as the primary DM.`, request:'Requesting the provider…',
    profileOk:'The model was checked and is now the default DM.', profileSaved:'The profile was checked and saved.', profileFailed:'The check failed. The current DM was not changed.', operationFailed:'PROVIDER_OPERATION_FAILED',
  },
  ru:{
    ariaLabel:'Подключение LLM', afterCheck:'После успешной проверки применить как DM по умолчанию',
    chatTitle:'ChatGPT: вход через Codex', chatDescription:'Официальный Codex CLI должен быть установлен на сервере. ODM использует отдельный профиль входа. Для WSL или удалённого сервера выбирайте код устройства.',
    connected:(email:string,plan:string)=>`Подключено: ${email} (${plan})`, notConnected:'ChatGPT не подключён',
    deviceLogin:'Войти по коду устройства', browserLogin:'Войти в браузере на серверном ПК', refresh:'Обновить статус', logout:'Выйти',
    officialLogin:'Открыть официальный вход ChatGPT', deviceCode:'Код устройства', officialOnly:'Введите его только на официальной странице входа.', cancelLogin:'Отменить вход',
    loadModels:'Получить доступные модели', modelAria:'Модель ChatGPT', chooseModel:'Выберите модель', connectChat:'Подключить ChatGPT и проверить инструменты',
    chatFootnote:'Используется официальный экспериментальный API dynamicTools. Игровые действия выполняет ODM. Системные инструменты и приложения для модели отключены. Выход прерывает текущие ходы ChatGPT. Лимиты определяются аккаунтом; потоковый вывод пока не поддерживается.',
    providersTitle:'Gemini и Qwen', providersDescription:'Gemini: официальный API-ключ, не OAuth подписки Google. Qwen: API-ключ или локальная модель без облачного входа. Старый Qwen OAuth отключён провайдером.',
    provider:'Провайдер', qwenLocal:'Qwen локально / совместимый сервер', qwenCloud:'Qwen / DashScope API', gemini:'Gemini Developer API', runtime:'Адрес runtime (локальный или удалённый сервер)', local:'Локальный (127.0.0.1:11434)', docker:'Docker host (host.docker.internal)', keyRegion:'Регион ключа',
    runtimeKey:'Ключ runtime, если установлен', apiKey:'API-ключ', loadProvider:'Загрузить модели провайдера', exactId:'Точный ID модели', connect:'Подключить и проверить инструменты', modelFootnote:'Модель можно ввести вручную, если провайдер не выдаёт список. Ключ хранится в существующей зашифрованной БД ODM. Неуспешная проверка не меняет текущего DM.',
    savedTitle:'Сохранённые профили моделей', savedDescription:'Список проверенных профилей подключения. Любой проверенный профиль можно переключить как основной DM одним кликом.', checked:'✓ проверен', notChecked:'✗ не проверен', bridge:'Codex / bridge', applyAsDm:'Применить как DM', appliedProfile:(name:string,model:string)=>`Профиль "${name}" (${model}) успешно применён как основной DM.`, request:'Выполняется запрос к провайдеру…',
    profileOk:'Модель проверена и применяется как DM по умолчанию.', profileSaved:'Профиль проверен и сохранён.', profileFailed:'Проверка не пройдена. Текущая модель DM не изменена.', operationFailed:'PROVIDER_OPERATION_FAILED',
  },
  pl:{
    ariaLabel:'Połączenie LLM', afterCheck:'Po pomyślnej weryfikacji ustaw jako domyślnego MG',
    chatTitle:'ChatGPT: logowanie przez Codex', chatDescription:'Oficjalny Codex CLI musi być zainstalowany na serwerze. ODM używa osobnego profilu logowania. W WSL lub na serwerze zdalnym wybierz kod urządzenia.',
    connected:(email:string,plan:string)=>`Połączono: ${email} (${plan})`, notConnected:'ChatGPT nie jest połączony',
    deviceLogin:'Zaloguj kodem urządzenia', browserLogin:'Zaloguj w przeglądarce na komputerze serwera', refresh:'Odśwież status', logout:'Wyloguj',
    officialLogin:'Otwórz oficjalne logowanie ChatGPT', deviceCode:'Kod urządzenia', officialOnly:'Wpisz go tylko na oficjalnej stronie logowania.', cancelLogin:'Anuluj logowanie',
    loadModels:'Pobierz dostępne modele', modelAria:'Model ChatGPT', chooseModel:'Wybierz model', connectChat:'Połącz ChatGPT i sprawdź narzędzia',
    chatFootnote:'Używane jest oficjalne eksperymentalne API dynamicTools. ODM wykonuje działania w grze. Narzędzia systemowe i aplikacje są wyłączone dla modelu. Wylogowanie przerywa bieżące tury ChatGPT. Limity zależą od konta; strumieniowanie nie jest jeszcze obsługiwane.',
    providersTitle:'Gemini i Qwen', providersDescription:'Gemini: oficjalny klucz API, nie logowanie OAuth z subskrypcji Google. Qwen: klucz API lub model lokalny bez logowania w chmurze. Starsze Qwen OAuth jest wyłączone przez dostawcę.',
    provider:'Dostawca', qwenLocal:'Qwen lokalnie / zgodny serwer', qwenCloud:'Qwen / API DashScope', gemini:'Gemini Developer API', runtime:'Adres runtime (serwer lokalny lub zdalny)', local:'Lokalny (127.0.0.1:11434)', docker:'Host Dockera (host.docker.internal)', keyRegion:'Region klucza',
    runtimeKey:'Klucz runtime, jeśli ustawiony', apiKey:'Klucz API', loadProvider:'Pobierz modele dostawcy', exactId:'Dokładny identyfikator modelu', connect:'Połącz i sprawdź narzędzia', modelFootnote:'Jeśli dostawca nie zwraca listy, możesz wpisać model ręcznie. Klucz jest przechowywany w istniejącej szyfrowanej bazie ODM. Nieudana weryfikacja nie zmienia bieżącego MG.',
    savedTitle:'Zapisane profile modeli', savedDescription:'Sprawdzone profile połączeń. Każdy sprawdzony profil można jednym kliknięciem ustawić jako głównego MG.', checked:'✓ sprawdzony', notChecked:'✗ niesprawdzony', bridge:'Codex / bridge', applyAsDm:'Ustaw jako MG', appliedProfile:(name:string,model:string)=>`Profil "${name}" (${model}) ustawiono jako głównego MG.`, request:'Wysyłanie żądania do dostawcy…',
    profileOk:'Model został sprawdzony i ustawiony jako domyślny MG.', profileSaved:'Profil został sprawdzony i zapisany.', profileFailed:'Weryfikacja nie powiodła się. Bieżący MG nie został zmieniony.', operationFailed:'PROVIDER_OPERATION_FAILED',
  },
};
export default function ProviderAuthPanel(){
  const {locale}=useI18n();
  const copy=localeText(locale,COPY);
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
  },[request,refreshProfiles,setNotice]);
  useEffect(()=>{
    let cancelled=false;
    request({action:'status',provider:'chatgpt'}).then(data=>{if(!cancelled){setStatus(data);if(data.error)setNotice(data.error);}}).catch(e=>{if(!cancelled)setNotice(String(e.message));});
    request({action:'profiles'}).then(data=>{if(!cancelled&&data.profiles)setSavedProfiles(data.profiles);}).catch(()=>{});
    return()=>{cancelled=true;};
  },[request]);
  useEffect(()=>{if(!status.login)return;const timer=setInterval(()=>void refresh().catch(e=>{if(alive.current)setNotice(String(e.message));}),2000);return()=>clearInterval(timer);},[status.login,refresh]);
  async function run(fn:()=>Promise<void>){setBusy(true);setNotice('');try{await fn();}catch(e){if(alive.current)setNotice(e instanceof Error?e.message:copy.operationFailed);}finally{if(alive.current)setBusy(false);}}
  async function login(mode:'browser'|'device'){await run(async()=>{const data=await request({action:'login',provider:'chatgpt',mode});if(data.operationId&&data.authUrl)setStatus(s=>({...s,login:data as Login}));});}
  async function connect(selected:string,id:string){await run(async()=>{try{const data=await request({action:'connect',provider:selected,model:id,apiKey:selected==='chatgpt'?undefined:key,baseUrl,region,apply});setResult(data);setNotice(data.applied?copy.profileOk:data.report?.ok?copy.profileSaved:copy.profileFailed);await refreshProfiles();}finally{setKey('');}});}
  return <section className="space-y-6" aria-label={copy.ariaLabel}>
    <label className="flex gap-2"><input type="checkbox" checked={apply} disabled={busy} onChange={e=>setApply(e.target.checked)}/>{copy.afterCheck}</label>
    <div className="rounded border border-slate-700 p-4 space-y-3">
      <h2 className="text-xl font-semibold">{copy.chatTitle}</h2>
      <p className="text-sm">{copy.chatDescription}</p>
      <p role="status">{status.authenticated?copy.connected(status.account?.email??'ChatGPT',status.account?.planType??'plan not specified'):copy.notConnected}</p>
      <div className="flex flex-wrap gap-2">
        <button className={button} disabled={busy||!!status.login||status.authenticated} onClick={()=>void login('device')}>{copy.deviceLogin}</button>
        <button className={button} disabled={busy||!!status.login||status.authenticated} onClick={()=>void login('browser')}>{copy.browserLogin}</button>
        <button className={button} disabled={busy} onClick={()=>void run(refresh)}>{copy.refresh}</button>
        <button className={button} disabled={busy||!status.authenticated} onClick={()=>void run(async()=>{await request({action:'logout',provider:'chatgpt'});setModels([]);setChatModel('');setResult(null);await refresh();})}>{copy.logout}</button>
      </div>
      {status.login&&<div className="space-y-2" role="status">
        <p><a className="underline" href={status.login.authUrl} target="_blank" rel="noopener noreferrer">{copy.officialLogin}</a></p>
        {status.login.userCode&&<p>{copy.deviceCode}: <code>{status.login.userCode}</code>. {copy.officialOnly}</p>}
        <button className={button} disabled={busy} onClick={()=>void run(async()=>{await request({action:'cancel',provider:'chatgpt',operationId:status.login?.operationId});await refresh();})}>{copy.cancelLogin}</button>
      </div>}
      <button className={button} disabled={busy||!status.authenticated} onClick={()=>void run(async()=>{const data=await request({action:'models',provider:'chatgpt'});setModels(data.models??[]);setChatModel(data.models?.[0]?.id??'');})}>{copy.loadModels}</button>
      <select className={field} aria-label={copy.modelAria} value={chatModel} onChange={e=>setChatModel(e.target.value)} disabled={busy||!models.length}><option value="">{copy.chooseModel}</option>{models.map(m=><option key={m.id} value={m.id}>{m.displayName} — {m.id}</option>)}</select>
      <button className={button} disabled={busy||!chatModel||!status.authenticated} onClick={()=>void connect('chatgpt',chatModel)}>{copy.connectChat}</button>
      <p className="text-sm">{copy.chatFootnote}</p>
    </div>
    <div className="rounded border border-slate-700 p-4 space-y-3">
      <h2 className="text-xl font-semibold">{copy.providersTitle}</h2>
      <p className="text-sm">{copy.providersDescription}</p>
      {/* Explicit names prevent nested option text from becoming the select's label. */}
      <label className="block">{copy.provider}<select aria-label={copy.provider} className={field} value={provider} disabled={busy} onChange={e=>{setProvider(e.target.value);setKey('');setModel('');setProviderModels([]);setResult(null);setNotice('');}}><option value="qwen-local">{copy.qwenLocal}</option><option value="qwen">{copy.qwenCloud}</option><option value="gemini">{copy.gemini}</option></select></label>
      {provider==='qwen-local'&&<div className="space-y-1">
        <label className="block">{copy.runtime}
          <input aria-label={copy.runtime} className={field} value={baseUrl} disabled={busy} onChange={e=>setBaseUrl(e.target.value)} placeholder="http://127.0.0.1:11434/v1 or http://remote-ip:11434/v1"/>
        </label>
        <div className="flex flex-wrap gap-2 text-xs">
          <button type="button" className="underline text-slate-400 hover:text-slate-200" onClick={()=>setBaseUrl('http://127.0.0.1:11434/v1')}>{copy.local}</button>
          <button type="button" className="underline text-slate-400 hover:text-slate-200" onClick={()=>setBaseUrl('http://host.docker.internal:11434/v1')}>{copy.docker}</button>
        </div>
      </div>}
      {provider==='qwen'&&<label className="block">{copy.keyRegion}<select aria-label={copy.keyRegion} className={field} value={region} disabled={busy} onChange={e=>{setRegion(e.target.value);setKey('');setModel('');setProviderModels([]);setResult(null);setNotice('');}}><option value="international">International</option><option value="china">China</option><option value="token-plan">Token Plan (Singapore)</option></select></label>}
      <label className="block">{provider==='qwen-local'?copy.runtimeKey:copy.apiKey}<input aria-label={provider==='qwen-local'?copy.runtimeKey:copy.apiKey} className={field} type="password" value={key} disabled={busy} onChange={e=>setKey(e.target.value)} autoComplete="new-password" spellCheck={false}/></label>
      <button className={button} disabled={busy||(provider!=='qwen-local'&&!key)} onClick={()=>void run(async()=>{const data=await request({action:'models',provider,apiKey:key,baseUrl,region});setProviderModels(data.models??[]);})}>{copy.loadProvider}</button>
      <datalist id="odm-provider-models">{providerModels.map(m=><option key={m.id} value={m.id}/>)}</datalist>
      <label className="block">{copy.exactId}<input aria-label={copy.exactId} list="odm-provider-models" className={field} value={model} disabled={busy} onChange={e=>setModel(e.target.value)} autoComplete="off"/></label>
      <button className={button} disabled={busy||!model||(provider!=='qwen-local'&&!key)} onClick={()=>void connect(provider,model)}>{copy.connect}</button>
      <p className="text-sm">{copy.modelFootnote}</p>
    </div>
    {savedProfiles.length>0&&<div className="rounded border border-slate-700 p-4 space-y-3">
      <h2 className="text-xl font-semibold">{copy.savedTitle}</h2>
      <p className="text-sm">{copy.savedDescription}</p>
      <div className="space-y-2">
        {savedProfiles.map((p)=><div key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-3 rounded bg-slate-800 text-sm">
          <div>
            <span className="font-semibold text-slate-200">{p.name}</span> <span className="text-slate-400">({p.model})</span>
            <div className="text-xs text-slate-400">{p.baseUrl||copy.bridge} — {p.lastCheck?.ok ? copy.checked : copy.notChecked}</div>
          </div>
          <button className={button} disabled={busy||!p.lastCheck?.ok} onClick={()=>void run(async()=>{await request({action:'apply',profileId:p.id});setNotice(copy.appliedProfile(p.name,p.model));await refresh();})}>{copy.applyAsDm}</button>
        </div>)}
      </div>
    </div>}
    {busy&&<p role="status">{copy.request}</p>}
    {notice&&<p role="status" className="break-words">{notice}</p>}
    {result?.report&&<pre className="overflow-auto">{JSON.stringify({profileId:result.profile?.id,report:result.report,applied:result.applied},null,2)}</pre>}
  </section>;
}
