"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { useI18n, type Locale } from "@/lib/i18n";
import { ui } from "@/lib/ui";
import type { BlockKind, ContextTrace } from "@/lib/dm/context-budget";

// "What the DM was actually sent." Lead only, because the underlying prompt
// carries DM-only facts and the secret story arc; see the route for why even
// the token counts stay behind that gate.

const KIND_COLOR: Record<BlockKind, string> = {
  contract: "text-amber-300",
  rules: "text-stone-300",
  state: "text-amber-200",
  retrieval: "text-ember-300",
  chapters: "text-ember-400",
  history: "text-stone-200",
};

const COPY = {
  en: {
    kinds: {
      contract: "Engine boundary",
      rules: "Rules",
      state: "Game state",
      retrieval: "Lore and house rules",
      chapters: "Chapters",
      history: "Transcript",
    },
    leadOnly: "Party lead only.",
    loadFailed: "Could not load the context.",
    title: "What the DM was sent",
    lastTurn: "Last turn",
    estimates: "Token counts are estimates.",
    refresh: "Refresh",
    empty:
      "No turn has been taken yet. Play a round and this will show every block the DM received, what it cost, and anything the budget cut.",
    tokens: "tokens",
    dropped: "dropped",
    alwaysIncluded: "always included",
    fits: "fits",
    overKind: (kind: string, used: string, left: string) =>
      `over the ${kind} budget (${used} > ${left} tokens left)`,
    overTotal: (used: string, limit: string) =>
      `over the total context budget (${used} > ${limit} tokens)`,
  },
  ru: {
    kinds: {
      contract: "Граница движка",
      rules: "Правила",
      state: "Состояние игры",
      retrieval: "Лор и домашние правила",
      chapters: "Главы",
      history: "Стенограмма",
    },
    leadOnly: "Только для лидера группы.",
    loadFailed: "Не удалось загрузить контекст.",
    title: "Что было отправлено Мастеру",
    lastTurn: "Последний ход",
    estimates: "Количество токенов приблизительное.",
    refresh: "Обновить",
    empty:
      "Ходов пока не было. После первого раунда здесь появятся все блоки, отправленные Мастеру, их размер и всё, что было отброшено из-за бюджета контекста.",
    tokens: "токенов",
    dropped: "отброшено",
    alwaysIncluded: "включается всегда",
    fits: "помещается",
    overKind: (kind: string, used: string, left: string) =>
      `превышен бюджет «${kind}» (${used} > осталось ${left} токенов)`,
    overTotal: (used: string, limit: string) =>
      `превышен общий бюджет контекста (${used} > ${limit} токенов)`,
  },
} as const;

function localizeReason(reason: string, kind: BlockKind, locale: Locale): string {
  const copy = COPY[locale];
  if (reason === "always included") return copy.alwaysIncluded;
  if (reason === "fits") return copy.fits;
  const kindMatch = reason.match(/^over the (.+) budget \((\d+) > (\d+) tokens left\)$/);
  if (kindMatch) {
    return copy.overKind(copy.kinds[kind] ?? kindMatch[1], kindMatch[2], kindMatch[3]);
  }
  const totalMatch = reason.match(/^over the total context budget \((\d+) > (\d+) tokens\)$/);
  if (totalMatch) return copy.overTotal(totalMatch[1], totalMatch[2]);
  return reason;
}

export function ContextPanel({ campaignId }: { campaignId: string }) {
  const { locale } = useI18n();
  const copy = COPY[locale];
  const [trace, setTrace] = useState<ContextTrace | null>(null);
  const [at, setAt] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const load = useCallback(() => setReload((count) => count + 1), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/campaigns/${campaignId}/context-trace`);
        if (cancelled) return;
        if (!response.ok) {
          setError(response.status === 403 ? copy.leadOnly : copy.loadFailed);
          setLoading(false);
          return;
        }
        const data = (await response.json()) as { trace: ContextTrace | null; at?: string };
        if (cancelled) return;
        setError("");
        setTrace(data.trace);
        setAt(data.at ?? "");
      } catch {
        if (!cancelled) setError(copy.loadFailed);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [campaignId, copy.leadOnly, copy.loadFailed, reload]);

  const pct = trace ? Math.min(100, Math.round((trace.promptTokens / trace.limitTokens) * 100)) : 0;
  const over = trace ? trace.promptTokens > trace.limitTokens : false;

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-[10px] font-medium uppercase tracking-wide text-stone-500">{copy.title}</h3>
          <p className="text-[11px] text-stone-500">
            {copy.lastTurn}
            {at ? `, ${new Date(at).toLocaleTimeString(locale)}` : ""}. {copy.estimates}
          </p>
        </div>
        <button type="button" onClick={load} className={cn(ui.iconAction, "-my-1")} aria-label={copy.refresh}>
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
        </button>
      </div>

      {error ? <p className="text-xs text-red-400">{error}</p> : null}

      {!error && !loading && !trace ? <p className="text-xs text-stone-500">{copy.empty}</p> : null}

      {trace ? (
        <>
          <div>
            <div className="mb-1 flex justify-between font-mono text-[11px] text-stone-400">
              <span>
                {trace.promptTokens.toLocaleString(locale)} / {trace.limitTokens.toLocaleString(locale)} {copy.tokens}
              </span>
              <span className={over ? "text-red-400" : "text-stone-500"}>{pct}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-stone-800">
              <div
                className={cn("h-full rounded-full", over ? "bg-red-500" : "bg-amber-500/70")}
                style={{ width: `${Math.max(2, pct)}%` }}
              />
            </div>
          </div>

          <ul className="space-y-1">
            {trace.blocks.map((block) => (
              <li
                key={`${block.position}-${block.id}`}
                className={cn(
                  "rounded-lg border px-2 py-1.5 text-xs shadow-elev-1",
                  block.included ? "border-stone-700/60 bg-stone-900/50" : "border-red-900/50 bg-red-950/20",
                )}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className={cn("font-medium", KIND_COLOR[block.kind])}>
                    {copy.kinds[block.kind]}
                    <span className="ml-1 font-normal text-stone-500">{block.id}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-stone-400">
                    {block.tokens.toLocaleString(locale)}
                  </span>
                </div>
                <p className={cn("mt-0.5 text-[11px]", block.included ? "text-stone-500" : "text-red-300")}>
                  {block.included
                    ? localizeReason(block.reason, block.kind, locale)
                    : `${copy.dropped}: ${localizeReason(block.reason, block.kind, locale)}`}
                </p>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
