"use client";

import { useEffect, useState } from "react";
import { ui } from "@/lib/ui";
import { LlmWizard } from "@/app/admin/LlmWizard";

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
    label: "Qwen Token Plan (Alibaba, Сингапур)",
    baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
    needsKey: true,
    modelHint: "qwen3.8-max",
  },
  {
    id: "dashscope",
    label: "Qwen / DashScope (международный ключ)",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    needsKey: true,
    modelHint: "qwen-plus",
  },
  {
    id: "dashscope-cn",
    label: "Qwen / DashScope (Китай)",
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
    modelHint: "модель с openrouter.ai/models",
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
    label: "Ollama (локально, без ключа)",
    baseUrl: "http://127.0.0.1:11434/v1",
    needsKey: false,
    modelHint: "qwen3.8-dm",
  },
  {
    id: "custom",
    label: "Другой OpenAI-совместимый сервер",
    baseUrl: "",
    needsKey: false,
    modelHint: "имя модели вашего сервера",
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
  models: "Список моделей",
  chat: "Чат (русский ответ)",
  stream: "Стриминг",
  tool_call: "Tool call",
  tool_result: "Результат инструмента",
};

function StageList({ stages }: { stages: StageReport }) {
  return (
    <div className="mt-1 grid gap-0.5 text-[11px] text-stone-400">
      {Object.entries(stages).map(([key, result]) => (
        <div key={key}>
          <span className={result.ok ? "text-green-400" : "text-red-400"}>{result.ok ? "✓" : "✗"}</span>{" "}
          {STAGE_LABELS[key] ?? key}
          {result.ms !== undefined ? ` · ${Math.round(result.ms / 100) / 10}с` : ""}
          {result.detail ? ` — ${result.detail}` : ""}
        </div>
      ))}
    </div>
  );
}

export function AdminModelsPanel() {
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

  async function reload() {
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
      setError("Не удалось загрузить список профилей.");
    } finally {
      setLoading(false);
    }
  }

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
          setError(`OpenRouter: не удалось обменять код авторизации (HTTP ${res.status}).`);
          return;
        }
        const create = await fetch("/api/admin/llm-profiles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "OpenRouter (вход через браузер)",
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
          setError(created?.error || "Ключ получен, но профиль не сохранился.");
          return;
        }
        setNotice(
          "OpenRouter подключён ссылкой: профиль создан. Нажмите «Проверить», затем «Применить как DM».",
        );
        await reload();
      } catch {
        setError("OpenRouter: обмен кода прервался сетью.");
      } finally {
        setBusy("");
      }
    });
  }, []);

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
        setError(data.error || "Список моделей недоступен — впишите имя модели вручную.");
        setModels([]);
      } else {
        setModels(data.models || []);
        if ((data.models || []).length === 0) {
          setNotice("Сервер не отдал список — впишите имя модели вручную, это нормально.");
        }
      }
    } catch {
      setError("Сервер не ответил при запросе списка моделей.");
    } finally {
      setBusy("");
    }
  }

  async function addAndVerify() {
    if (!model.trim()) {
      setError("Укажите модель (кнопка «Загрузить список» или вручную).");
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
        setError(created?.error || "Не удалось сохранить профиль.");
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
            ? `Профиль «${created.profile.name}» добавлен и проверен — можно применять как DM.`
            : `Профиль сохранён, но проверка не пройдена (детали ниже). Как DM он не включится.`,
        );
      } else {
        setNotice(`Профиль «${created.profile.name}» сохранён; проверку запустите кнопкой «Проверить» в списке.`);
      }
      setApiKey("");
      setModel("");
      setModels([]);
      await reload();
    } catch {
      setError("Сервер не ответил. Проверьте, что ODM запущен, и попробуйте ещё раз.");
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
        setError(data?.error || "Проверка не выполнена.");
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
        setError(data?.error || "Не удалось применить профиль.");
      } else {
        setNotice("Профиль применён как DM по умолчанию для новых кампаний. В лобби каждой кампании выбор остаётся за вами.");
      }
      await reload();
    } finally {
      setBusy("");
    }
  }

  async function removeProfile(id: string) {
    if (!confirm("Удалить профиль?")) return;
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
        <h2 className="mb-1 text-sm font-medium text-stone-200">Добавить модель</h2>
        <p className="mb-3 text-xs text-stone-500">
          Один экран: пресет → ключ → модель → «Добавить и проверить». Проверка настоящая: чат,
          стриминг и tool calling (без него модель нельзя поставить DM).
        </p>
        {error ? <p className="mb-2 text-xs text-red-400">{error}</p> : null}
        {notice ? <p className="mb-2 text-xs text-green-400">{notice}</p> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-stone-400">
            Провайдер
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
            API-ключ {preset.needsKey ? "" : "(не нужен)"}
            <input
              type="password"
              className={inputClass + " mt-1 w-full"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={preset.needsKey ? "sk-..." : "оставьте пустым"}
              autoComplete="off"
            />
          </label>
          <label className="block text-xs text-stone-400">
            Модель
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
            {busy === "models" ? "Загрузка..." : "Загрузить список моделей"}
          </button>
          <button type="button" className={btnPrimary} onClick={() => void addAndVerify()} disabled={busy !== ""}>
            {busy === "add" ? "Добавляю и проверяю (может занять пару минут)..." : "Добавить и проверить"}
          </button>
          <button
            type="button"
            className={btnSecondary}
            onClick={() => void initiateOpenRouterOAuth()}
            disabled={busy !== ""}
            title="Официальный OAuth PKCE: браузер → openrouter.ai → ключ прилетает сам"
          >
            Войти через OpenRouter (ссылкой)
          </button>
          <span className="text-[11px] text-stone-500">Название профиля можно задать ниже в списке через «Изменить».</span>
        </div>
        {addReport ? (
          <div className="mt-3 rounded border border-stone-700 p-2">
            <div className={"text-xs " + (addReportOk ? "text-green-400" : "text-red-400")}>
              {addReportOk ? "✓ Проверка пройдена — модель умеет всё, что нужно DM" : "✗ Проверка не пройдена"}
            </div>
            <StageList stages={addReport} />
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border border-stone-800 bg-stone-950/60 p-4">
        <h2 className="mb-3 text-sm font-medium text-stone-200">Сохранённые профили</h2>
        {loading ? (
          <p className="text-xs text-stone-500">Загрузка...</p>
        ) : profiles.length === 0 ? (
          <p className="text-xs text-stone-500">
            Пока пусто. Добавьте первый профиль формой выше — например, Qwen Token Plan: выберите
            пресет, вставьте ключ sk-sp-..., нажмите «Добавить и проверить».
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
                        активный DM по умолчанию
                      </span>
                    ) : null}
                    {p.lastCheck ? (
                      <span className={p.lastCheck.ok ? "text-[11px] text-green-400" : "text-[11px] text-red-400"}>
                        {p.lastCheck.ok ? "✓ проверен" : "✗ проверка не пройдена"}{" "}
                        {new Date(p.lastCheck.at).toLocaleString("ru-RU")}
                      </span>
                    ) : (
                      <span className="text-[11px] text-stone-500">не проверен</span>
                    )}
                    {p.hasApiKey || p.authMode === "none" ? null : (
                      <span className="text-[11px] text-yellow-400">нет ключа</span>
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
                      title={toolsOk ? "" : "Сначала пройдьте проверку — без tool calling DM не подключается"}
                      onClick={() => void applyGlobal(p.id)}
                    >
                      {busy === p.id ? "..." : "Применить как DM"}
                    </button>
                    <button type="button" className={btnSecondary} disabled={busy === p.id} onClick={() => void probeProfile(p.id)}>
                      {busy === p.id ? "Проверка..." : "Проверить"}
                    </button>
                    <button type="button" className={btnSecondary} onClick={() => setEditing(p.id)}>
                      Изменить
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-400 hover:text-red-400"
                      disabled={busy === p.id}
                      onClick={() => void removeProfile(p.id)}
                    >
                      Удалить
                    </button>
                  </div>
                  {report ? <StageList stages={report.stages} /> : null}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
