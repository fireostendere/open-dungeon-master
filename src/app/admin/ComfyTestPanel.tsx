"use client";

import { useState } from "react";
import { ui } from "@/lib/ui";

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
      setStatus({ ok: false, error: "Сервер не ответил", checkpoints: [] });
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
      setResult({ ok: false, error: "Запрос не дошёл до сервера" });
    }
    setGenerating(false);
  };

  return (
    <div className="rounded border border-stone-700 p-3">
      <div className="mb-2 text-sm text-stone-300">Проверка графики (ComfyUI)</div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={check} disabled={checking} className={ui.btnSecondary}>
          {checking ? "Проверка..." : "Проверить доступность"}
        </button>
        {status && (
          <span className={status.ok ? "text-xs text-green-400" : "text-xs text-red-400"}>
            {status.ok
              ? `✓ ComfyUI доступен: ${status.checkpoints.length} checkpoint(ов)`
              : `✗ ${status.error || "недоступен"}`}
          </span>
        )}
      </div>
      {status?.ok && (
        <div className="mt-3 space-y-2">
          <label className="block text-xs text-stone-400">
            Установленные checkpoint (выбор без выдуманных имён)
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
                Использовать по умолчанию
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={generate}
            disabled={generating || !status.checkpoints.length}
            className={ui.btnPrimary}
          >
            {generating ? "Генерация (может занять минуты на общей GPU)..." : "Тест генерации"}
          </button>
          {result && !result.ok && (
            <div className="text-xs text-red-400">
              ✗ {result.error}
              {result.checkpoints?.length
                ? ` Установлены: ${result.checkpoints.join(", ")}`
                : ""}
            </div>
          )}
          {result?.ok && result.imagePath && (
            <div className="space-y-1">
              <div className="text-xs text-green-400">
                ✓ Реальная генерация за {result.elapsedSeconds ?? "?"} с
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={result.imagePath}
                alt="Результат тестовой генерации ComfyUI"
                className="max-h-64 rounded border border-stone-700"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
