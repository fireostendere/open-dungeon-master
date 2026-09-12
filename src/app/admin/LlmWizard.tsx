"use client";

import { useEffect, useState } from "react";
import { Wizard, type WizardStep } from "@/components/ui/Wizard";
import { ui } from "@/lib/ui";

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
      title: "Тип подключения",
      blurb: "Выберите тип LLM-сервера",
      canContinue: profile.kind !== "custom" || Boolean(profile.baseUrl),
      content: (
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setProfile({ ...profile, kind: "cloud-preset", preset: undefined })}
            className={ui.btnSecondary + (profile.kind === "cloud-preset" ? " ring-2 ring-amber-400" : "")}
          >
            ☁️ Облачный провайдер
            <div className="mt-1 text-xs text-stone-400">OpenRouter, OpenAI, DeepSeek, DashScope</div>
          </button>
          <button
            type="button"
            onClick={() => setProfile({ ...profile, kind: "local-runtime", preset: undefined })}
            className={ui.btnSecondary + (profile.kind === "local-runtime" ? " ring-2 ring-amber-400" : "")}
          >
            💻 Локальный runtime
            <div className="mt-1 text-xs text-stone-400">Ollama, llama.cpp, LM Studio, vLLM</div>
          </button>
          <button
            type="button"
            onClick={() => setProfile({ ...profile, kind: "custom", preset: undefined, baseUrl: "", protocol: "openai-compatible" })}
            className={ui.btnSecondary + (profile.kind === "custom" ? " ring-2 ring-amber-400" : "")}
          >
            🔧 Произвольный endpoint
            <div className="mt-1 text-xs text-stone-400">OpenAI-совместимый сервер</div>
          </button>
        </div>
      ),
    },
    {
      key: "connection",
      title: "Адрес и доступ",
      blurb: "URL сервера и ключ API",
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
            <label className="mb-1 block text-sm text-stone-300">API Key</label>
            <input
              type="password"
              className={ui.input}
              value={profile.apiKey}
              onChange={(e) => setProfile({ ...profile, apiKey: e.target.value })}
              placeholder={profile.hasApiKey ? "•••••••• (оставьте пустым чтобы сохранить)" : "Необязательно для локальных серверов"}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-stone-400">Context limit (tokens)</label>
              <input
                type="number"
                className={ui.input}
                value={profile.contextLimit ?? ""}
                onChange={(e) => setProfile({ ...profile, contextLimit: e.target.value ? Number(e.target.value) : null })}
                placeholder="16384"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-400">Max output tokens</label>
              <input
                type="number"
                className={ui.input}
                value={profile.maxOutputTokens ?? ""}
                onChange={(e) => setProfile({ ...profile, maxOutputTokens: e.target.value ? Number(e.target.value) : undefined })}
                placeholder="4096"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-400">Thinking</label>
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
              <label className="mb-1 block text-xs text-stone-400">Timeout (ms)</label>
              <input
                type="number"
                className={ui.input}
                value={profile.timeoutMs ?? ""}
                onChange={(e) => setProfile({ ...profile, timeoutMs: e.target.value ? Number(e.target.value) : undefined })}
                placeholder="60000"
              />
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "model",
      title: "Модель",
      blurb: "Выберите модель или введите имя вручную",
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
              {loadingModels ? "Загрузка..." : "Загрузить список"}
            </button>
            <span className="ml-2 text-xs text-stone-400">Протокол: {profile.protocol}</span>
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
            <label className="mb-1 block text-sm text-stone-300">Model name</label>
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
      title: "Проверка",
      blurb: "Проверьте подключение и возможности модели",
      content: (
        <div className="space-y-3">
          <button
            type="button"
            onClick={runProbe}
            disabled={probing || !profile.baseUrl || !profile.model}
            className={ui.btnPrimary}
          >
            {probing ? "Проверка..." : "Проверить подключение"}
          </button>
          {report && (
            <div className="space-y-2 rounded border border-stone-700 p-3">
              <div className="flex items-center gap-2">
                <span className={report.ok ? "text-green-400" : "text-red-400"}>
                  {report.ok ? "✓ Подключение работает" : "✗ Подключение не работает"}
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
                <span>Tools: {report.capabilities.tools ? "✓" : "✗"}</span>
                <span>Streaming: {report.capabilities.streaming ? "✓" : "✗"}</span>
                {report.capabilities.modelListed !== null && (
                  <span>Model listed: {report.capabilities.modelListed ? "✓" : "✗"}</span>
                )}
              </div>
              {!report.capabilities.tools && (
                <div className="rounded bg-yellow-900/30 p-2 text-xs text-yellow-200">
                  ⚠ Без надёжных инструментов модель нельзя включать как автоматического DM
                </div>
              )}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "save",
      title: "Сохранение",
      blurb: "Сохраните профиль и примените",
      canContinue: canSave,
      content: (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm text-stone-300">Название профиля</label>
            <input
              type="text"
              className={ui.input}
              value={profile.name}
              onChange={(e) => setProfile({ ...profile, name: e.target.value })}
              placeholder="Моя модель"
            />
          </div>
          <button
            type="button"
            onClick={saveProfile}
            disabled={saving || !canSave}
            className={ui.btnPrimary}
          >
            {saving ? "Сохранение..." : "Сохранить профиль"}
          </button>
          {profile.id && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={applyGlobal}
                disabled={!toolsVerified}
                className={ui.btnSecondary}
              >
                Применить как DM (глобально)
              </button>
              {!toolsVerified && (
                <div className="text-xs text-yellow-300">
                  Нельзя применить: инструменты не прошли проверку
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
      title="Мастер подключения модели"
      onDone={onClose}
      doneLabel="Готово"
      onCancel={onClose}
      step={step}
      onStepChange={setStep}
    />
  );
}
