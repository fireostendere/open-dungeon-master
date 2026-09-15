"use client";

import { useState } from "react";
import { ui } from "@/lib/ui";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";

// Graphics setup step for the admin panel: check ComfyUI reachability from
// the backend, list the INSTALLED checkpoints (never invented names), run a
// real test generation and show the actual image. A placeholder is never
// presented as success: only a real generated file renders here.
type ComfyStatus = {
  ok: boolean;
  error?: string;
  checkpoints: string[];
  url?: string;
};

type ImageProbeResult = {
  ok: boolean;
  error?: string;
  checkpoints?: string[];
  imagePath?: string;
  elapsedSeconds?: number;
  ms?: number;
};

const TEST_PROMPT =
  "a small red dragon statuette on a wooden table, fantasy tavern background, tabletop rpg test image";

export function ComfyTestPanel({
  comfyUrl,
  onUseCheckpoint,
}: {
  comfyUrl: string;
  onUseCheckpoint: (name: string) => void;
}) {
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: {
      serverFailed: "The server did not respond",
      requestFailed: "The request did not reach the server",
      title: "Graphics check (ComfyUI)",
      checking: "Checking...",
      check: "Check availability",
      checkpoints: "Installed checkpoints (choose a real name)",
      useDefault: "Use as default",
      generating: "Generating (may take minutes on a shared GPU)...",
      generate: "Test generation",
      installed: " Installed: ",
      generated: "✓ Real generation in ",
      seconds: "s",
      resultAlt: "ComfyUI test generation result",
    },
    ru: {
      serverFailed: "Сервер не ответил",
      requestFailed: "Запрос не дошёл до сервера",
      title: "Проверка графики (ComfyUI)",
      checking: "Проверка...",
      check: "Проверить доступность",
      checkpoints: "Установленные checkpoint (выбор без выдуманных имён)",
      useDefault: "Использовать по умолчанию",
      generating: "Генерация (может занять минуты на общей GPU)...",
      generate: "Тест генерации",
      installed: " Установлены: ",
      generated: "✓ Реальная генерация за ",
      seconds: "с",
      resultAlt: "Результат тестовой генерации ComfyUI",
    },
    pl: {
      serverFailed: "Serwer nie odpowiedział",
      requestFailed: "Żądanie nie dotarło do serwera",
      title: "Sprawdzanie grafiki (ComfyUI)",
      checking: "Sprawdzanie...",
      check: "Sprawdź dostępność",
      checkpoints: "Zainstalowane checkpointy (wybierz prawdziwą nazwę)",
      useDefault: "Użyj domyślnie",
      generating: "Generowanie (na współdzielonym GPU może potrwać kilka minut)...",
      generate: "Test generowania",
      installed: " Zainstalowane: ",
      generated: "✓ Rzeczywiste generowanie w ",
      seconds: "s",
      resultAlt: "Wynik testowego generowania ComfyUI",
    },
  });
  const [status, setStatus] = useState<ComfyStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkpoint, setCheckpoint] = useState("");
  const [result, setResult] = useState<ImageProbeResult | null>(null);
  const [generating, setGenerating] = useState(false);

  const check = async () => {
    setChecking(true);
    setResult(null);
    try {
      const resp = await fetch("/api/comfy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: comfyUrl }),
      });
      const data = (await resp.json()) as ComfyStatus;
      setStatus(data);
      if (data.ok && data.checkpoints.length && !checkpoint) {
        setCheckpoint(data.checkpoints[0]);
      }
    } catch {
      setStatus({ ok: false, error: copy.serverFailed, checkpoints: [] });
    }
    setChecking(false);
  };

  const generate = async () => {
    setGenerating(true);
    setResult(null);
    try {
      const resp = await fetch("/api/admin/image-probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: comfyUrl || undefined, checkpoint: checkpoint || undefined, prompt: TEST_PROMPT }),
      });
      setResult((await resp.json()) as ImageProbeResult);
    } catch {
      setResult({ ok: false, error: copy.requestFailed });
    }
    setGenerating(false);
  };

  return (
    <div className="rounded border border-stone-700 p-3">
      <div className="mb-2 text-sm text-stone-300">{copy.title}</div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={check} disabled={checking} className={ui.btnSecondary}>
          {checking ? copy.checking : copy.check}
        </button>
        {status && (
          <span className={status.ok ? "text-xs text-green-400" : "text-xs text-red-400"}>
            {status.ok
              ? `✓ ComfyUI available: ${status.checkpoints.length} checkpoints`
              : `✗ ${status.error || "unavailable"}`}
          </span>
        )}
      </div>
      {status?.ok && (
        <div className="mt-3 space-y-2">
          <label className="block text-xs text-stone-400">
            {copy.checkpoints}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className={ui.input}
              value={checkpoint}
              onChange={(event) => setCheckpoint(event.target.value)}
            >
              {status.checkpoints.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            {checkpoint && (
              <button
                type="button"
                className={ui.btnSecondary}
                onClick={() => onUseCheckpoint(checkpoint)}
              >
                {copy.useDefault}
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={generate}
            disabled={generating || !status.checkpoints.length}
            className={ui.btnPrimary}
          >
            {generating ? copy.generating : copy.generate}
          </button>
          {result && !result.ok && (
            <div className="text-xs text-red-400">
              ✗ {result.error}
              {result.checkpoints?.length
                ? `${copy.installed}${result.checkpoints.join(", ")}`
                : ""}
            </div>
          )}
          {result?.ok && result.imagePath && (
            <div className="space-y-1">
              <div className="text-xs text-green-400">
                {copy.generated}{result.elapsedSeconds ?? "?"} {copy.seconds}
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={result.imagePath}
                alt={copy.resultAlt}
                className="max-h-64 rounded border border-stone-700"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
