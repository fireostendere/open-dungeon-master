"use client";

import { useCallback, useEffect, useState } from "react";
import { ui } from "@/lib/ui";
import { LlmWizard } from "@/app/admin/LlmWizard";
import { useI18n } from "@/lib/i18n";

// Admin «Модели» panel: the no-fuss way to add and manage LLM connections.
// Top: one-screen quick add (preset → key → model → add & verify).
// Bottom: the saved profile table with apply/probe/edit/delete actions and
// the live "active DM" marker. Keys are write-only: the server returns
// hasApiKey, never the value.

type MaskedProfile = {
  id: string;
  name: string;
  kind: string;
  preset?: string;
  protocol: string;
  baseUrl: string;
  model: string;
  authMode: "none" | "api-key";
  hasApiKey: boolean;
  thinking?: string;
  lastCheck: { at: string; ok: boolean; stages: Record<string, { ok: boolean; detail?: string; ms?: number }> } | null;
};

type StageReport = Record<string, { ok: boolean; detail?: string; ms?: number }>;

const PRESETS: Array<{
  id: string;
  label: string;
  baseUrl: string;
  needsKey: boolean;
  modelHint: string;
}> = [
  {
    id: "qwen-tokenplan",
    label: "Qwen Token Plan (Alibaba, Singapore)",
    baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
    needsKey: true,
    modelHint: "qwen3.8-max",
  },
  {
    id: "dashscope",
    label: "Qwen / DashScope (international key)",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    needsKey: true,
    modelHint: "qwen-plus",
  },
  {
    id: "dashscope-cn",
    label: "Qwen / DashScope (China)",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    needsKey: true,
    modelHint: "qwen-plus",
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    needsKey: true,
    modelHint: "gpt-5.2",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    needsKey: true,
    modelHint: "model from openrouter.ai/models",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    needsKey: true,
    modelHint: "deepseek-chat",
  },
  {
    id: "ollama",
    label: "Ollama (local, no key)",
    baseUrl: "http://127.0.0.1:11434/v1",
    needsKey: false,
    modelHint: "qwen3.8-dm",
  },
  {
    id: "custom",
    label: "Other OpenAI-compatible server",
    baseUrl: "",
    needsKey: false,
    modelHint: "your server's model name",
  },
];

const inputClass = ui.input;
const btnPrimary = ui.btnPrimary;
const btnSecondary = ui.btnSecondary;

// --- OpenRouter OAuth PKCE ("sign in by link") ---------------------------
// Official flow, no client registration: verifier in sessionStorage, S256
// challenge in the redirect, code exchanged straight from this browser for a
// user-scoped API key, which is then handed to the server once and dropped.
const OR_VERIFIER_KEY = "odm-or-verifier";

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function initiateOpenRouterOAuth() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  sessionStorage.setItem(OR_VERIFIER_KEY, verifier);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = b64url(new Uint8Array(digest));
  const callback = window.location.origin + window.location.pathname;
  window.location.href = `https://openrouter.ai/auth?${new URLSearchParams({
    callback_url: callback,
    code_challenge: challenge,
    code_challenge_method: "S256",
  })}`;
}

const STAGE_LABELS: Record<string, string> = {
  models: "Model list",
  chat: "Chat (Russian response)",
  stream: "Streaming",
  tool_call: "Tool call",
  tool_result: "Tool result",
};

const COPY = {
  en: {
    seconds: "s",
    loadFailed: "Could not load model profiles.",
    oauthExchangeFailed: (status: number) => `OpenRouter: authorization-code exchange failed (HTTP ${status}).`,
    oauthProfileName: "OpenRouter (browser sign-in)",
    oauthProfileFailed: "The key was received, but the profile was not saved.",
    oauthNotice: "OpenRouter connected by link: profile created. Click Check, then Apply as DM.",
    oauthNetworkFailed: "OpenRouter: code exchange failed because of a network error.",
    modelsUnavailable: "The model list is unavailable — enter the model name manually.",
    modelsEmpty: "The server returned no models — enter the model name manually; this is fine.",
    modelsNetworkFailed: "The server did not respond while loading the model list.",
    modelRequired: "Enter a model (use Load model list or type it manually).",
    profileSaveFailed: "Could not save the profile.",
    profilePassed: (name: string) => `Profile “${name}” was added and checked — it can be applied as DM.`,
    profileFailed: "The profile was saved, but the check failed (details below). It cannot be used as DM.",
    profileSaved: (name: string) => `Profile “${name}” was saved; run the check with the Check button below.`,
    serverFailed: "The server did not respond. Check that ODM is running and try again.",
    checkFailed: "The check did not run.",
    applyFailed: "Could not apply the profile.",
    applyNotice: "The profile is now the default DM for new campaigns. Each campaign can still choose its own model in the lobby.",
    deleteConfirm: "Delete this profile?",
    addTitle: "Add model",
    addIntro: "One screen: preset → key → model → Add and check. The check is real: chat, streaming, and tool calling (without it the model cannot run the DM).",
    provider: "Provider",
    apiKey: "API key",
    keyNotNeeded: "(not needed)",
    leaveEmpty: "leave empty",
    model: "Model",
    loadModels: "Load model list",
    loading: "Loading...",
    addAndCheck: "Add and check",
    adding: "Adding and checking (may take a few minutes)...",
    oauthTitle: "Official OAuth PKCE: browser → openrouter.ai → key arrives automatically",
    oauthLogin: "Sign in with OpenRouter (by link)",
    profileNameHelp: "Set the profile name below in the list with Edit.",
    checkPassed: "✓ Check passed — the model supports everything the DM needs",
    checkFailedLabel: "✗ Check failed",
    savedProfiles: "Saved profiles",
    emptyProfiles: "Nothing here yet. Add the first profile above — for example, choose Qwen Token Plan, paste the sk-sp-... key, and click Add and check.",
    activeDefault: "active default DM",
    checked: "✓ checked",
    notChecked: "✗ check failed",
    unchecked: "not checked",
    noKey: "no key",
    toolRequired: "Run the check first — the DM cannot connect without tool calling",
    applyAsDm: "Apply as DM",
    checking: "Checking...",
    check: "Check",
    edit: "Edit",
    delete: "Delete",
  },
  ru: {
    seconds: "с",
    loadFailed: "Не удалось загрузить список профилей.",
    oauthExchangeFailed: (status: number) => `OpenRouter: не удалось обменять код авторизации (HTTP ${status}).`,
    oauthProfileName: "OpenRouter (вход через браузер)",
    oauthProfileFailed: "Ключ получен, но профиль не сохранился.",
    oauthNotice: "OpenRouter подключён ссылкой: профиль создан. Нажмите «Проверить», затем «Применить как DM».",
    oauthNetworkFailed: "OpenRouter: обмен кода прервался сетью.",
    modelsUnavailable: "Список моделей недоступен — впишите имя модели вручную.",
    modelsEmpty: "Сервер не отдал список — впишите имя модели вручную, это нормально.",
    modelsNetworkFailed: "Сервер не ответил при запросе списка моделей.",
    modelRequired: "Укажите модель (кнопка «Загрузить список» или вручную).",
    profileSaveFailed: "Не удалось сохранить профиль.",
    profilePassed: (name: string) => `Профиль «${name}» добавлен и проверен — можно применять как DM.`,
    profileFailed: "Профиль сохранён, но проверка не пройдена (детали ниже). Как DM он не включится.",
    profileSaved: (name: string) => `Профиль «${name}» сохранён; проверку запустите кнопкой «Проверить» в списке.`,
    serverFailed: "Сервер не ответил. Проверьте, что ODM запущен, и попробуйте ещё раз.",
    checkFailed: "Проверка не выполнена.",
    applyFailed: "Не удалось применить профиль.",
    applyNotice: "Профиль применён как DM по умолчанию для новых кампаний. В лобби каждой кампании выбор остаётся за вами.",
    deleteConfirm: "Удалить профиль?",
    addTitle: "Добавить модель",
    addIntro: "Один экран: пресет → ключ → модель → «Добавить и проверить». Проверка настоящая: чат, стриминг и tool calling (без него модель нельзя поставить DM).",
    provider: "Провайдер",
    apiKey: "API-ключ",
    keyNotNeeded: "(не нужен)",
    leaveEmpty: "оставьте пустым",
    model: "Модель",
    loadModels: "Загрузить список моделей",
    loading: "Загрузка...",
    addAndCheck: "Добавить и проверить",
    adding: "Добавляю и проверяю (может занять пару минут)...",
    oauthTitle: "Официальный OAuth PKCE: браузер → openrouter.ai → ключ прилетает сам",
    oauthLogin: "Войти через OpenRouter (ссылкой)",
    profileNameHelp: "Название профиля можно задать ниже в списке через «Изменить».",
    checkPassed: "✓ Проверка пройдена — модель умеет всё, что нужно DM",
    checkFailedLabel: "✗ Проверка не пройдена",
    savedProfiles: "Сохранённые профили",
    emptyProfiles: "Пока пусто. Добавьте первый профиль формой выше — например, выберите Qwen Token Plan, вставьте ключ sk-sp-... и нажмите «Добавить и проверить».",
    activeDefault: "активный DM по умолчанию",
    checked: "✓ проверен",
    notChecked: "✗ проверка не пройдена",
    unchecked: "не проверен",
    noKey: "нет ключа",
    toolRequired: "Сначала пройдите проверку — без tool calling DM не подключается",
    applyAsDm: "Применить как DM",
    checking: "Проверка...",
    check: "Проверить",
    edit: "Изменить",
    delete: "Удалить",
  },
  pl: {
    seconds: "s",
    loadFailed: "Nie udało się wczytać profili modeli.",
    oauthExchangeFailed: (status: number) => `OpenRouter: wymiana kodu autoryzacji nie powiodła się (HTTP ${status}).`,
    oauthProfileName: "OpenRouter (logowanie w przeglądarce)",
    oauthProfileFailed: "Klucz został odebrany, ale profil nie został zapisany.",
    oauthNotice: "OpenRouter połączono przez link: profil utworzony. Kliknij Sprawdź, a następnie Zastosuj jako MG.",
    oauthNetworkFailed: "OpenRouter: wymiana kodu przerwana przez błąd sieci.",
    modelsUnavailable: "Lista modeli jest niedostępna — wpisz nazwę modelu ręcznie.",
    modelsEmpty: "Serwer nie zwrócił modeli — wpisz nazwę ręcznie; to normalne.",
    modelsNetworkFailed: "Serwer nie odpowiedział podczas pobierania listy modeli.",
    modelRequired: "Wpisz model (użyj opcji Wczytaj listę modeli albo wpisz go ręcznie).",
    profileSaveFailed: "Nie udało się zapisać profilu.",
    profilePassed: (name: string) => `Profil „${name}” został dodany i sprawdzony — można zastosować go jako MG.`,
    profileFailed: "Profil zapisano, ale sprawdzanie nie powiodło się (szczegóły poniżej). Nie może działać jako MG.",
    profileSaved: (name: string) => `Profil „${name}” zapisano; uruchom sprawdzanie przyciskiem Sprawdź na liście.`,
    serverFailed: "Serwer nie odpowiedział. Sprawdź, czy ODM działa, i spróbuj ponownie.",
    checkFailed: "Nie udało się wykonać sprawdzania.",
    applyFailed: "Nie udało się zastosować profilu.",
    applyNotice: "Profil jest domyślnym MG dla nowych kampanii. Każda kampania nadal może wybrać własny model w lobby.",
    deleteConfirm: "Usunąć ten profil?",
    addTitle: "Dodaj model",
    addIntro: "Jeden ekran: preset → klucz → model → Dodaj i sprawdź. Sprawdzanie jest rzeczywiste: czat, streaming i wywoływanie narzędzi (bez tego model nie może prowadzić gry).",
    provider: "Dostawca",
    apiKey: "Klucz API",
    keyNotNeeded: "(niepotrzebny)",
    leaveEmpty: "zostaw puste",
    model: "Model",
    loadModels: "Wczytaj listę modeli",
    loading: "Ładowanie...",
    addAndCheck: "Dodaj i sprawdź",
    adding: "Dodawanie i sprawdzanie (może potrwać kilka minut)...",
    oauthTitle: "Oficjalny OAuth PKCE: przeglądarka → openrouter.ai → klucz przychodzi automatycznie",
    oauthLogin: "Zaloguj przez OpenRouter (linkiem)",
    profileNameHelp: "Nazwę profilu ustawisz niżej na liście przyciskiem Edytuj.",
    checkPassed: "✓ Sprawdzanie zakończone — model obsługuje wszystko, czego potrzebuje MG",
    checkFailedLabel: "✗ Sprawdzanie nieudane",
    savedProfiles: "Zapisane profile",
    emptyProfiles: "Jeszcze nic tu nie ma. Dodaj pierwszy profil powyżej — wybierz Qwen Token Plan, wklej klucz sk-sp-... i kliknij Dodaj i sprawdź.",
    activeDefault: "aktywny domyślny MG",
    checked: "✓ sprawdzony",
    notChecked: "✗ sprawdzanie nieudane",
    unchecked: "niesprawdzony",
    noKey: "brak klucza",
    toolRequired: "Najpierw uruchom sprawdzanie — bez wywoływania narzędzi MG nie może się połączyć",
    applyAsDm: "Zastosuj jako MG",
    checking: "Sprawdzanie...",
    check: "Sprawdź",
    edit: "Edytuj",
    delete: "Usuń",
  },
} as const;

function StageList({ stages, labels }: { stages: StageReport; labels: Record<string, string> }) {
  return (
    <div className="mt-1 grid gap-0.5 text-[11px] text-stone-400">
      {Object.entries(stages).map(([key, result]) => (
        <div key={key}>
          <span className={result.ok ? "text-green-400" : "text-red-400"}>{result.ok ? "✓" : "✗"}</span>{" "}
          {labels[key] ?? key}
          {result.ms !== undefined ? ` · ${Math.round(result.ms / 100) / 10}s` : ""}
          {result.detail ? ` — ${result.detail}` : ""}
        </div>
      ))}
    </div>
  );
}

export function AdminModelsPanel() {
  const { locale } = useI18n();
  const copy = COPY[locale];
  const [profiles, setProfiles] = useState<MaskedProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Quick-add form state.
  const [presetId, setPresetId] = useState(PRESETS[0].id);
  const [baseUrl, setBaseUrl] = useState(PRESETS[0].baseUrl);
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [name, setName] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [addReport, setAddReport] = useState<StageReport | null>(null);
  const [addReportOk, setAddReportOk] = useState(false);

  // Per-profile probe reports and the editing wizard target.
  const [probeReports, setProbeReports] = useState<Record<string, { ok: boolean; stages: StageReport }>>({});
  const [editing, setEditing] = useState<string | null>(null);

  // Which profile currently drives the global DM defaults.
  const [active, setActive] = useState<{ baseUrl: string; model: string } | null>(null);

  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0];

  const reload = useCallback(async () => {
    try {
      const [listResp, cfgResp] = await Promise.all([
        fetch("/api/admin/llm-profiles"),
        fetch("/api/admin/settings"),
      ]);
      const list = listResp.ok ? await listResp.json() : null;
      const cfg = cfgResp.ok ? await cfgResp.json() : null;
      if (list?.profiles) setProfiles(list.profiles);
      if (cfg?.config?.text) {
        setActive({
          baseUrl: cfg.config.text.customBaseUrl || "",
          model: cfg.config.text.customModel || "",
        });
      }
    } catch {
      setError(copy.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [copy.loadFailed]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const verifier = sessionStorage.getItem(OR_VERIFIER_KEY);
    const oauth = Boolean(code && verifier);
    if (oauth) {
      sessionStorage.removeItem(OR_VERIFIER_KEY);
      window.history.replaceState({}, "", window.location.pathname);
    }
    // Everything that touches state runs in a microtask/async continuation,
    // never synchronously in the effect body.
    void Promise.resolve().then(async () => {
      await reload();
      if (!oauth || !code || !verifier) return;
      setBusy("or-oauth");
      setError("");
      try {
        const res = await fetch("https://openrouter.ai/api/v1/auth/keys", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
        });
        const data = (await res.json().catch(() => ({}))) as { key?: string; data?: { key?: string } };
        const key = data?.key || data?.data?.key;
        if (!res.ok || !key) {
          setError(copy.oauthExchangeFailed(res.status));
          return;
        }
        const create = await fetch("/api/admin/llm-profiles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: copy.oauthProfileName,
            kind: "cloud-preset",
            preset: "openrouter",
            protocol: "openai-compatible",
            baseUrl: "https://openrouter.ai/api/v1",
            model: "openrouter/auto",
            authMode: "api-key",
            apiKey: key,
          }),
        });
        const created = (await create.json().catch(() => ({}))) as { error?: string };
        if (!create.ok) {
          setError(created?.error || copy.oauthProfileFailed);
          return;
        }
        setNotice(
          copy.oauthNotice,
        );
        await reload();
      } catch {
        setError(copy.oauthNetworkFailed);
      } finally {
        setBusy("");
      }
    });
  }, [copy, reload]);

  function pickPreset(id: string) {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    setPresetId(id);
    setBaseUrl(p.baseUrl);
    setModels([]);
    setAddReport(null);
    if (!name) setName(p.label.split(" (")[0]);
  }

  async function loadModels() {
    setBusy("models");
    setError("");
    try {
      const resp = await fetch("/api/admin/llm-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl, apiKey: apiKey || undefined }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setError(data.error || copy.modelsUnavailable);
        setModels([]);
      } else {
        setModels(data.models || []);
        if ((data.models || []).length === 0) {
          setNotice(copy.modelsEmpty);
        }
      }
    } catch {
      setError(copy.modelsNetworkFailed);
    } finally {
      setBusy("");
    }
  }

  async function addAndVerify() {
    if (!model.trim()) {
      setError(copy.modelRequired);
      return;
    }
    setBusy("add");
    setError("");
    setNotice("");
    setAddReport(null);
    try {
      const profileName = (name || preset.label.split(" (")[0]).trim() + " · " + model.trim();
      const createResp = await fetch("/api/admin/llm-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: profileName.slice(0, 60),
          kind: preset.id === "custom" ? "custom" : preset.id === "ollama" ? "local-runtime" : "cloud-preset",
          preset: ["openai", "openrouter", "deepseek", "ollama"].includes(preset.id) ? preset.id : preset.id.startsWith("dashscope") || preset.id === "qwen-tokenplan" ? "dashscope" : undefined,
          protocol: "openai-compatible",
          baseUrl: baseUrl.trim(),
          model: model.trim(),
          authMode: apiKey || preset.needsKey ? "api-key" : "none",
          ...(apiKey ? { apiKey } : {}),
        }),
      });
      const created = await createResp.json().catch(() => ({}));
      if (!createResp.ok || !created?.profile?.id) {
        setError(created?.error || copy.profileSaveFailed);
        return;
      }
      // Verify right away — the whole point is one screen, no surprises later.
      const probeResp = await fetch(
        `/api/admin/llm-profiles/${created.profile.id}/probe`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ timeoutMs: 180000 }) },
      );
      const probed = await probeResp.json().catch(() => ({}));
      if (probed?.report) {
        setAddReport(probed.report.stages);
        setAddReportOk(Boolean(probed.report.ok));
        setNotice(
          probed.report.ok
            ? copy.profilePassed(created.profile.name)
            : copy.profileFailed,
        );
      } else {
        setNotice(copy.profileSaved(created.profile.name));
      }
      setApiKey("");
      setModel("");
      setModels([]);
      await reload();
    } catch {
      setError(copy.serverFailed);
    } finally {
      setBusy("");
    }
  }

  async function probeProfile(id: string) {
    setBusy(id);
    setError("");
    try {
      const resp = await fetch(`/api/admin/llm-profiles/${id}/probe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeoutMs: 180000 }),
      });
      const data = await resp.json().catch(() => ({}));
      if (data?.report) {
        setProbeReports((prev) => ({ ...prev, [id]: { ok: data.report.ok, stages: data.report.stages } }));
      } else {
        setError(data?.error || copy.checkFailed);
      }
      await reload();
    } finally {
      setBusy("");
    }
  }

  async function applyGlobal(id: string) {
    setBusy(id);
    setError("");
    try {
      const resp = await fetch(`/api/admin/llm-profiles/${id}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "global" }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setError(data?.error || copy.applyFailed);
      } else {
        setNotice(copy.applyNotice);
      }
      await reload();
    } finally {
      setBusy("");
    }
  }

  async function removeProfile(id: string) {
    if (!confirm(copy.deleteConfirm)) return;
    setBusy(id);
    try {
      await fetch(`/api/admin/llm-profiles/${id}`, { method: "DELETE" });
      await reload();
    } finally {
      setBusy("");
    }
  }

  if (editing) {
    return (
      <LlmWizard
        profileId={editing}
        onClose={() => {
          setEditing(null);
          void reload();
        }}
        onSaved={() => void reload()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-stone-800 bg-stone-950/60 p-4">
        <h2 className="mb-1 text-sm font-medium text-stone-200">{copy.addTitle}</h2>
        <p className="mb-3 text-xs text-stone-500">
          {copy.addIntro}
        </p>
        {error ? <p className="mb-2 text-xs text-red-400">{error}</p> : null}
        {notice ? <p className="mb-2 text-xs text-green-400">{notice}</p> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-stone-400">
            {copy.provider}
            <select className={inputClass + " mt-1 w-full"} value={presetId} onChange={(e) => pickPreset(e.target.value)}>
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-stone-400">
            Base URL
            <input
              className={inputClass + " mt-1 w-full"}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://127.0.0.1:11434/v1"
            />
          </label>
          <label className="block text-xs text-stone-400">
            {copy.apiKey} {preset.needsKey ? "" : copy.keyNotNeeded}
            <input
              type="password"
              className={inputClass + " mt-1 w-full"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={preset.needsKey ? "sk-..." : copy.leaveEmpty}
              autoComplete="off"
            />
          </label>
          <label className="block text-xs text-stone-400">
            {copy.model}
            <input
              className={inputClass + " mt-1 w-full"}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={preset.modelHint}
              list="odm-quick-models"
            />
            <datalist id="odm-quick-models">
              {models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className={btnSecondary} onClick={() => void loadModels()} disabled={busy !== "" || !baseUrl}>
            {busy === "models" ? copy.loading : copy.loadModels}
          </button>
          <button type="button" className={btnPrimary} onClick={() => void addAndVerify()} disabled={busy !== ""}>
            {busy === "add" ? copy.adding : copy.addAndCheck}
          </button>
          <button
            type="button"
            className={btnSecondary}
            onClick={() => void initiateOpenRouterOAuth()}
            disabled={busy !== ""}
            title={copy.oauthTitle}
          >
            {copy.oauthLogin}
          </button>
          <span className="text-[11px] text-stone-500">{copy.profileNameHelp}</span>
        </div>
        {addReport ? (
          <div className="mt-3 rounded border border-stone-700 p-2">
            <div className={"text-xs " + (addReportOk ? "text-green-400" : "text-red-400")}>
              {addReportOk ? copy.checkPassed : copy.checkFailedLabel}
            </div>
            <StageList stages={addReport} labels={STAGE_LABELS} />
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border border-stone-800 bg-stone-950/60 p-4">
        <h2 className="mb-3 text-sm font-medium text-stone-200">{copy.savedProfiles}</h2>
        {loading ? (
          <p className="text-xs text-stone-500">{copy.loading}</p>
        ) : profiles.length === 0 ? (
          <p className="text-xs text-stone-500">
            {copy.emptyProfiles}
          </p>
        ) : (
          <div className="space-y-3">
            {profiles.map((p) => {
              const isActive =
                active && active.baseUrl === p.baseUrl && active.model === p.model;
              const report = probeReports[p.id];
              const toolsOk = p.lastCheck
                ? Boolean(p.lastCheck.ok && p.lastCheck.stages?.tool_call?.ok)
                : false;
              return (
                <div key={p.id} className="rounded border border-stone-700 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-stone-200">{p.name}</span>
                    {isActive ? (
                      <span className="rounded bg-amber-950/60 px-1.5 py-0.5 text-[10px] text-amber-300">
                        {copy.activeDefault}
                      </span>
                    ) : null}
                    {p.lastCheck ? (
                      <span className={p.lastCheck.ok ? "text-[11px] text-green-400" : "text-[11px] text-red-400"}>
                        {p.lastCheck.ok ? copy.checked : copy.notChecked}{" "}
                        {new Date(p.lastCheck.at).toLocaleString("ru-RU")}
                      </span>
                    ) : (
                      <span className="text-[11px] text-stone-500">{copy.unchecked}</span>
                    )}
                    {p.hasApiKey || p.authMode === "none" ? null : (
                      <span className="text-[11px] text-yellow-400">{copy.noKey}</span>
                    )}
                  </div>
                  <div className="mt-1 text-[11px] text-stone-500">
                    {p.model} · {p.baseUrl}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={btnSecondary}
                      disabled={busy === p.id || !toolsOk}
                      title={toolsOk ? "" : copy.toolRequired}
                      onClick={() => void applyGlobal(p.id)}
                    >
                      {busy === p.id ? "..." : copy.applyAsDm}
                    </button>
                    <button type="button" className={btnSecondary} disabled={busy === p.id} onClick={() => void probeProfile(p.id)}>
                      {busy === p.id ? copy.checking : copy.check}
                    </button>
                    <button type="button" className={btnSecondary} onClick={() => setEditing(p.id)}>
                      {copy.edit}
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-400 hover:text-red-400"
                      disabled={busy === p.id}
                      onClick={() => void removeProfile(p.id)}
                    >
                      {copy.delete}
                    </button>
                  </div>
                  {report ? <StageList stages={report.stages} labels={STAGE_LABELS} /> : null}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
