"use client";

import { useEffect, useState } from "react";
import { Wizard, type WizardStep } from "@/components/ui/Wizard";
import { ui } from "@/lib/ui";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";

// LLM connection wizard. Reuses Wizard.tsx for step navigation.
// Steps: Type → Connection → Model → Check → Save

type LlmProfile = {
  id?: string;
  name: string;
  kind: "cloud-preset" | "local-runtime" | "custom";
  preset?: string;
  protocol: "openai-compatible" | "ollama-native";
  baseUrl: string;
  model: string;
  authMode: "none" | "api-key";
  apiKey: string;
  contextLimit?: number | null;
  contextVerified: boolean;
  maxOutputTokens?: number;
  thinking: "on" | "off" | "auto";
  timeoutMs?: number;
  sampling?: {
    temperature?: number;
    top_p?: number;
    top_k?: number;
    min_p?: number;
  };
  lastCheck?: {
    at: string;
    ok: boolean;
    stages: Record<string, { ok: boolean; detail?: string; ms?: number }>;
  } | null;
  hasApiKey?: boolean;
};

type ProbeReport = {
  ok: boolean;
  capabilities: { tools: boolean; streaming: boolean; modelListed: boolean | null };
  stages: Record<string, { ok: boolean; detail?: string; ms?: number }>;
};

type Props = {
  profileId?: string; // if editing existing
  onClose: () => void;
  onSaved?: () => void;
};

const PRESETS = {
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", protocol: "openai-compatible" as const, authMode: "api-key" as const, kind: "cloud-preset" as const },
  openai: { baseUrl: "https://api.openai.com/v1", protocol: "openai-compatible" as const, authMode: "api-key" as const, kind: "cloud-preset" as const },
  deepseek: { baseUrl: "https://api.deepseek.com/v1", protocol: "openai-compatible" as const, authMode: "api-key" as const, kind: "cloud-preset" as const },
  dashscope: { baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", protocol: "openai-compatible" as const, authMode: "api-key" as const, kind: "cloud-preset" as const },
  ollama: { baseUrl: "http://127.0.0.1:11434/v1", protocol: "openai-compatible" as const, authMode: "none" as const, kind: "local-runtime" as const },
  llamacpp: { baseUrl: "http://127.0.0.1:8080/v1", protocol: "openai-compatible" as const, authMode: "none" as const, kind: "local-runtime" as const },
  lmstudio: { baseUrl: "http://127.0.0.1:1234/v1", protocol: "openai-compatible" as const, authMode: "none" as const, kind: "local-runtime" as const },
  vllm: { baseUrl: "http://127.0.0.1:8000/v1", protocol: "openai-compatible" as const, authMode: "none" as const, kind: "local-runtime" as const },
};

export function LlmWizard({ profileId, onClose, onSaved }: Props) {
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: {
      typeTitle: "Connection type",
      typeBlurb: "Choose the type of LLM server",
      cloud: "Cloud provider",
      cloudHint: "OpenRouter, OpenAI, DeepSeek, DashScope",
      local: "Local runtime",
      localHint: "Ollama, llama.cpp, LM Studio, vLLM",
      custom: "Custom endpoint",
      customHint: "OpenAI-compatible server",
      connectionTitle: "Address and access",
      connectionBlurb: "Server URL and API key",
      apiKey: "API key",
      apiKeySaved: "•••••••• (leave empty to keep it)",
      apiKeyLocal: "Optional for local servers",
      contextLimit: "Context limit (tokens)",
      maxOutput: "Max output tokens",
      thinking: "Thinking",
      timeout: "Timeout (ms)",
      tweaks: "Tweaks apply to the DM when you use Apply as DM: sampling, output limit, timeout, and thinking. Empty means server default.",
      modelTitle: "Model",
      modelBlurb: "Choose a model or enter its name manually",
      load: "Load list",
      loading: "Loading...",
      protocol: "Protocol",
      modelName: "Model name",
      checkTitle: "Check",
      checkBlurb: "Check the connection and model capabilities",
      checking: "Checking...",
      checkConnection: "Check connection",
      connectionWorks: "✓ Connection works",
      connectionFails: "✗ Connection failed",
      tools: "Tools",
      streaming: "Streaming",
      modelListed: "Model listed",
      toolsWarning: "⚠ Without reliable tools, this model cannot run as an automatic DM",
      saveTitle: "Save",
      saveBlurb: "Save and apply the profile",
      profileName: "Profile name",
      profilePlaceholder: "My model",
      saving: "Saving...",
      saveProfile: "Save profile",
      apply: "Apply as DM (global)",
      cannotApply: "Cannot apply: tools did not pass the check",
      done: "Done",
    },
    ru: {
      typeTitle: "Тип подключения",
      typeBlurb: "Выберите тип LLM-сервера",
      cloud: "Облачный провайдер",
      cloudHint: "OpenRouter, OpenAI, DeepSeek, DashScope",
      local: "Локальный runtime",
      localHint: "Ollama, llama.cpp, LM Studio, vLLM",
      custom: "Произвольный endpoint",
      customHint: "OpenAI-совместимый сервер",
      connectionTitle: "Адрес и доступ",
      connectionBlurb: "URL сервера и ключ API",
      apiKey: "API-ключ",
      apiKeySaved: "•••••••• (оставьте пустым, чтобы сохранить)",
      apiKeyLocal: "Необязательно для локальных серверов",
      contextLimit: "Лимит контекста (токены)",
      maxOutput: "Максимум токенов вывода",
      thinking: "Размышление",
      timeout: "Тайм-аут (мс)",
      tweaks: "Твики применяются к DM при «Применить как DM»: sampling, лимит вывода, таймаут и thinking. Пусто = настройка сервера/дефолт.",
      modelTitle: "Модель",
      modelBlurb: "Выберите модель или введите имя вручную",
      load: "Загрузить список",
      loading: "Загрузка...",
      protocol: "Протокол",
      modelName: "Название модели",
      checkTitle: "Проверка",
      checkBlurb: "Проверьте подключение и возможности модели",
      checking: "Проверка...",
      checkConnection: "Проверить подключение",
      connectionWorks: "✓ Подключение работает",
      connectionFails: "✗ Подключение не работает",
      tools: "Инструменты",
      streaming: "Стриминг",
      modelListed: "Модель в списке",
      toolsWarning: "⚠ Без надёжных инструментов модель нельзя включать как автоматического DM",
      saveTitle: "Сохранение",
      saveBlurb: "Сохраните профиль и примените",
      profileName: "Название профиля",
      profilePlaceholder: "Моя модель",
      saving: "Сохранение...",
      saveProfile: "Сохранить профиль",
      apply: "Применить как DM (глобально)",
      cannotApply: "Нельзя применить: инструменты не прошли проверку",
      done: "Готово",
    },
    pl: {
      typeTitle: "Typ połączenia",
      typeBlurb: "Wybierz typ serwera LLM",
      cloud: "Dostawca chmurowy",
      cloudHint: "OpenRouter, OpenAI, DeepSeek, DashScope",
      local: "Lokalny runtime",
      localHint: "Ollama, llama.cpp, LM Studio, vLLM",
      custom: "Własny endpoint",
      customHint: "Serwer zgodny z OpenAI",
      connectionTitle: "Adres i dostęp",
      connectionBlurb: "URL serwera i klucz API",
      apiKey: "Klucz API",
      apiKeySaved: "•••••••• (zostaw puste, aby zachować)",
      apiKeyLocal: "Opcjonalne dla serwerów lokalnych",
      contextLimit: "Limit kontekstu (tokeny)",
      maxOutput: "Maksymalna liczba tokenów wyjściowych",
      thinking: "Rozumowanie",
      timeout: "Limit czasu (ms)",
      tweaks: "Zmiany obowiązują po użyciu Zastosuj jako MG: sampling, limit wyjścia, limit czasu i rozumowanie. Puste oznacza domyślne ustawienia serwera.",
      modelTitle: "Model",
      modelBlurb: "Wybierz model lub wpisz jego nazwę ręcznie",
      load: "Wczytaj listę",
      loading: "Ładowanie...",
      protocol: "Protokół",
      modelName: "Nazwa modelu",
      checkTitle: "Sprawdź",
      checkBlurb: "Sprawdź połączenie i możliwości modelu",
      checking: "Sprawdzanie...",
      checkConnection: "Sprawdź połączenie",
      connectionWorks: "✓ Połączenie działa",
      connectionFails: "✗ Połączenie nie działa",
      tools: "Narzędzia",
      streaming: "Streaming",
      modelListed: "Model na liście",
      toolsWarning: "⚠ Bez niezawodnych narzędzi ten model nie może prowadzić gry automatycznie",
      saveTitle: "Zapisz",
      saveBlurb: "Zapisz i zastosuj profil",
      profileName: "Nazwa profilu",
      profilePlaceholder: "Mój model",
      saving: "Zapisywanie...",
      saveProfile: "Zapisz profil",
      apply: "Zastosuj jako MG (globalnie)",
      cannotApply: "Nie można zastosować: narzędzia nie przeszły sprawdzania",
      done: "Gotowe",
    },
  });
  const [profile, setProfile] = useState<LlmProfile>({
    name: "",
    kind: "custom",
    protocol: "openai-compatible",
    baseUrl: "",
    model: "",
    authMode: "api-key",
    apiKey: "",
    contextVerified: false,
    thinking: "auto",
  });
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [report, setReport] = useState<ProbeReport | null>(null);
  const [probing, setProbing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(0);

  // Load existing profile if editing
  useEffect(() => {
    if (profileId) {
      fetch(`/api/admin/llm-profiles/${profileId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.profile) {
            setProfile({ ...data.profile, apiKey: "" }); // don't load apiKey
          }
        });
    }
  }, [profileId]);

  const selectPreset = (preset: string) => {
    const p = PRESETS[preset as keyof typeof PRESETS];
    if (p) {
      setProfile({ ...profile, kind: p.kind, preset, baseUrl: p.baseUrl, protocol: p.protocol, authMode: p.authMode });
    }
  };

  const loadModels = async () => {
    setLoadingModels(true);
    try {
      const resp = await fetch("/api/admin/llm-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: profile.baseUrl, apiKey: profile.apiKey || undefined }),
      });
      const data = await resp.json();
      if (data.models) setModels(data.models);
    } catch {}
    setLoadingModels(false);
  };

  const runProbe = async () => {
    setProbing(true);
    setReport(null);
    try {
      const resp = await fetch("/api/admin/llm-probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: profile.baseUrl,
          model: profile.model,
          apiKey: profile.apiKey || undefined,
          protocol: profile.protocol,
        }),
      });
      const data = await resp.json();
      setReport(data.report);
    } catch {}
    setProbing(false);
  };

  const saveProfile = async () => {
    setSaving(true);
    try {
      const resp = await fetch("/api/admin/llm-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // An empty apiKey on an existing profile means "keep the saved one";
        // the store treats undefined as keep and "" as clear, so send the
        // field only when the admin actually typed a key.
        body: JSON.stringify(
          profile.apiKey || !profile.id ? profile : { ...profile, apiKey: undefined },
        ),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data?.profile?.id) {
          setProfile((prev) => ({ ...prev, id: data.profile.id, apiKey: "" }));
        }
        if (onSaved) onSaved();
      }
    } catch {}
    setSaving(false);
  };

  const applyGlobal = async () => {
    if (!profile.id) return;
    await fetch(`/api/admin/llm-profiles/${profile.id}/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "global" }),
    });
    onClose();
  };

  const canProceedToConnection =
    profile.kind !== "custom" || Boolean(profile.baseUrl && profile.protocol);
  const canProceedToModel = Boolean(profile.baseUrl && profile.model);
  const canSave = Boolean(profile.name && profile.baseUrl && profile.model);
  // Tools verified in THIS session's probe, or in the profile's persisted
  // lastCheck (so reopening a saved profile can apply it without re-probing).
  const toolsVerified = report
    ? report.ok && report.capabilities.tools
    : Boolean(profile.lastCheck?.ok && profile.lastCheck?.stages?.tool_call?.ok);

  const steps: WizardStep[] = [
    {
      key: "type",
      title: copy.typeTitle,
      blurb: copy.typeBlurb,
      canContinue: profile.kind !== "custom" || Boolean(profile.baseUrl),
      content: (
        <div className="grid gap-3 md:grid-cols-3">
          {(
            [
              ["cloud-preset", "☁️", copy.cloud, copy.cloudHint],
              ["local-runtime", "💻", copy.local, copy.localHint],
              ["custom", "🔧", copy.custom, copy.customHint],
            ] as const
          ).map(([kind, icon, title, hint]) => (
            <button
              key={kind}
              type="button"
              onClick={() =>
                setProfile(
                  kind === "custom"
                    ? { ...profile, kind: "custom", preset: undefined, baseUrl: "", protocol: "openai-compatible" }
                    : { ...profile, kind, preset: undefined },
                )
              }
              className={
                "flex h-auto items-start gap-3 rounded-xl border p-3 text-left normal-case tracking-normal transition-all " +
                (profile.kind === kind
                  ? "border-amber-500 bg-amber-950/30 shadow-glow-gold"
                  : "border-stone-700 bg-stone-900/40 hover:border-stone-500")
              }
            >
              <span className="text-xl leading-none">{icon}</span>
              <span>
                <span className="block text-sm font-medium normal-case tracking-normal text-stone-100">
                  {title}
                </span>
                <span className="mt-0.5 block text-xs normal-case tracking-normal text-stone-400">
                  {hint}
                </span>
              </span>
            </button>
          ))}
        </div>
      ),
    },
    {
      key: "connection",
      title: copy.connectionTitle,
      blurb: copy.connectionBlurb,
      canContinue: canProceedToConnection,
      content: (
        <div className="space-y-3">
          {profile.kind !== "custom" && (
            <div className="grid gap-2 sm:grid-cols-2">
              {profile.kind === "cloud-preset" &&
                Object.entries(PRESETS)
                  .filter(([k]) => ["openrouter", "openai", "deepseek", "dashscope"].includes(k))
                  .map(([key]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => selectPreset(key)}
                      className={ui.btnSmall + (profile.preset === key ? " ring-2 ring-amber-400" : "")}
                    >
                      {key.charAt(0).toUpperCase() + key.slice(1)}
                    </button>
                  ))}
              {profile.kind === "local-runtime" &&
                Object.entries(PRESETS)
                  .filter(([k]) => ["ollama", "llamacpp", "lmstudio", "vllm"].includes(k))
                  .map(([key]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => selectPreset(key)}
                      className={ui.btnSmall + (profile.preset === key ? " ring-2 ring-amber-400" : "")}
                    >
                      {key.charAt(0).toUpperCase() + key.slice(1)}
                    </button>
                  ))}
            </div>
          )}
          <div>
            <label className="mb-1 block text-sm text-stone-300">Base URL</label>
            <input
              type="text"
              className={ui.input}
              value={profile.baseUrl}
              onChange={(e) => setProfile({ ...profile, baseUrl: e.target.value })}
              placeholder="http://127.0.0.1:11434/v1"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-stone-300">{copy.apiKey}</label>
            <input
              type="password"
              className={ui.input}
              value={profile.apiKey}
              onChange={(e) => setProfile({ ...profile, apiKey: e.target.value })}
              placeholder={profile.hasApiKey ? copy.apiKeySaved : copy.apiKeyLocal}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-stone-400">{copy.contextLimit}</label>
              <input
                type="number"
                className={ui.input}
                value={profile.contextLimit ?? ""}
                onChange={(e) => setProfile({ ...profile, contextLimit: e.target.value ? Number(e.target.value) : null })}
                placeholder="16384"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-400">{copy.maxOutput}</label>
              <input
                type="number"
                className={ui.input}
                value={profile.maxOutputTokens ?? ""}
                onChange={(e) => setProfile({ ...profile, maxOutputTokens: e.target.value ? Number(e.target.value) : undefined })}
                placeholder="4096"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-400">{copy.thinking}</label>
              <select
                className={ui.input}
                value={profile.thinking}
                onChange={(e) => setProfile({ ...profile, thinking: e.target.value as "on" | "off" | "auto" })}
              >
                <option value="auto">Auto</option>
                <option value="on">On</option>
                <option value="off">Off</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-400">{copy.timeout}</label>
              <input
                type="number"
                className={ui.input}
                value={profile.timeoutMs ?? ""}
                onChange={(e) => setProfile({ ...profile, timeoutMs: e.target.value ? Number(e.target.value) : undefined })}
                placeholder="60000"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["temperature", "Temperature", "0.1", "0.7"],
                  ["top_p", "Top-p", "0.05", "0.8"],
                  ["top_k", "Top-k", "1", "20"],
                  ["min_p", "Min-p", "0.01", "0"],
                ] as const
              ).map(([field, label, step, placeholder]) => (
                <div key={field}>
                  <label className="mb-1 block text-xs text-stone-400">{label}</label>
                  <input
                    type="number"
                    step={step}
                    className={ui.input}
                    value={profile.sampling?.[field] ?? ""}
                    onChange={(e) =>
                      setProfile({
                        ...profile,
                        sampling: {
                          ...profile.sampling,
                          [field]: e.target.value === "" ? undefined : Number(e.target.value),
                        },
                      })
                    }
                    placeholder={placeholder}
                  />
                </div>
              ))}
            </div>
            <p className="text-[11px] text-stone-500">
              {copy.tweaks}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "model",
      title: copy.modelTitle,
      blurb: copy.modelBlurb,
      canContinue: canProceedToModel,
      content: (
        <div className="space-y-3">
          <div>
            <button
              type="button"
              onClick={loadModels}
              disabled={loadingModels || !profile.baseUrl}
              className={ui.btnSmall}
            >
              {loadingModels ? copy.loading : copy.load}
            </button>
            <span className="ml-2 text-xs text-stone-400">{copy.protocol}: {profile.protocol}</span>
          </div>
          {models.length > 0 && (
            <div className="max-h-48 overflow-y-auto rounded border border-stone-700">
              {models.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setProfile({ ...profile, model: m })}
                  className={
                    "block w-full px-3 py-2 text-left text-sm hover:bg-stone-800 " +
                    (profile.model === m ? "bg-stone-700 text-amber-200" : "")
                  }
                >
                  {m}
                </button>
              ))}
            </div>
          )}
          <div>
            <label className="mb-1 block text-sm text-stone-300">{copy.modelName}</label>
            <input
              type="text"
              className={ui.input}
              value={profile.model}
              onChange={(e) => setProfile({ ...profile, model: e.target.value })}
              placeholder="qwen3.6-dm"
            />
          </div>
        </div>
      ),
    },
    {
      key: "check",
      title: copy.checkTitle,
      blurb: copy.checkBlurb,
      content: (
        <div className="space-y-3">
          <button
            type="button"
            onClick={runProbe}
            disabled={probing || !profile.baseUrl || !profile.model}
            className={ui.btnPrimary}
          >
            {probing ? copy.checking : copy.checkConnection}
          </button>
          {report && (
            <div className="space-y-2 rounded border border-stone-700 p-3">
              <div className="flex items-center gap-2">
                <span className={report.ok ? "text-green-400" : "text-red-400"}>
                  {report.ok ? copy.connectionWorks : copy.connectionFails}
                </span>
              </div>
              <div className="grid gap-1 text-xs">
                {Object.entries(report.stages).map(([stage, result]) => (
                  <div key={stage} className="flex items-center justify-between">
                    <span>
                      {result.ok ? "✓" : "✗"} {stage}
                    </span>
                    <span className="text-stone-400">
                      {result.ms ? `${result.ms}ms` : ""} {result.detail || ""}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex gap-3 text-xs">
                <span>{copy.tools}: {report.capabilities.tools ? "✓" : "✗"}</span>
                <span>{copy.streaming}: {report.capabilities.streaming ? "✓" : "✗"}</span>
                {report.capabilities.modelListed !== null && (
                  <span>{copy.modelListed}: {report.capabilities.modelListed ? "✓" : "✗"}</span>
                )}
              </div>
              {!report.capabilities.tools && (
                <div className="rounded bg-yellow-900/30 p-2 text-xs text-yellow-200">
                  {copy.toolsWarning}
                </div>
              )}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "save",
      title: copy.saveTitle,
      blurb: copy.saveBlurb,
      canContinue: canSave,
      content: (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm text-stone-300">{copy.profileName}</label>
            <input
              type="text"
              className={ui.input}
              value={profile.name}
              onChange={(e) => setProfile({ ...profile, name: e.target.value })}
              placeholder={copy.profilePlaceholder}
            />
          </div>
          <button
            type="button"
            onClick={saveProfile}
            disabled={saving || !canSave}
            className={ui.btnPrimary}
          >
            {saving ? copy.saving : copy.saveProfile}
          </button>
          {profile.id && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={applyGlobal}
                disabled={!toolsVerified}
                className={ui.btnSecondary}
              >
                {copy.apply}
              </button>
              {!toolsVerified && (
                <div className="text-xs text-yellow-300">
                  {copy.cannotApply}
                </div>
              )}
            </div>
          )}
        </div>
      ),
    },
  ];

  return (
    <Wizard
      steps={steps}
      title={copy.connectionTitle}
      onDone={onClose}
      doneLabel={copy.done}
      onCancel={onClose}
      step={step}
      onStepChange={setStep}
    />
  );
}
