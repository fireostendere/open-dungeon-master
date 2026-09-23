"use client";

import { Pin, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { PIN_TOKEN_CAP, pinTokens, totalPinTokens } from "@/lib/dm/pin-logic";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";

// Pinned memories: excerpts that ride in every prompt, unconditionally.
//
// The gauge is the point of the panel, following NE-P's PinnedMemoriesPanel:
// pins are the one memory mechanism with no eviction, so the table needs to
// see how much of the budget they have spent before the next pin is refused.
// NE-P colours it amber at 70 percent and red at 90; same thresholds here.

type PinRow = {
  id: string;
  messageId: string;
  text: string;
  isFullMessage: boolean;
  createdAt: string;
};

const COLLAPSE_AT = 160;

function PinItem({ pin, isLead, onDelete }: { pin: PinRow; isLead: boolean; onDelete: (id: string) => void }) {
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: { full: "Full message", excerpt: "Excerpt", delete: "Delete", less: "Show less", more: "Show more", jump: "Jump to message" },
    ru: { full: "Всё сообщение", excerpt: "Фрагмент", delete: "Удалить", less: "Свернуть", more: "Показать больше", jump: "Перейти к сообщению" },
  });
  const [expanded, setExpanded] = useState(false);
  const long = pin.text.length > COLLAPSE_AT;
  const shown = !expanded && long ? `${pin.text.slice(0, COLLAPSE_AT)}...` : pin.text;

  return (
    <li className="rounded-lg border border-stone-700/60 bg-stone-900/50 p-2.5 shadow-elev-1">
      <div className="mb-1 flex items-center gap-2">
        <Pin className="size-3 shrink-0 text-amber-400" />
        <span className="text-[10px] font-medium uppercase tracking-wide text-amber-300/70">
          {pin.isFullMessage ? copy.full : copy.excerpt}
        </span>
        <span className="ml-auto shrink-0 font-mono text-[10px] text-stone-500">
          {pinTokens(pin.text)}t
        </span>
        {isLead ? (
          <button
            type="button"
            onClick={() => onDelete(pin.id)}
            aria-label={copy.delete}
            title={copy.delete}
            className="inline-flex min-h-7 shrink-0 items-center gap-1 rounded border border-red-900/50 px-2 text-[10px] text-stone-400 hover:border-red-500/50 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60"
          >
            <Trash2 className="size-3" /> {copy.delete}
          </button>
        ) : null}
      </div>
      <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-stone-300">
        {shown}
      </p>
      <div className="mt-1 flex gap-3">
        {long ? (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="text-[10px] text-stone-500 hover:text-stone-300"
          >
            {expanded ? copy.less : copy.more}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            document
              .querySelector(`[data-message-id="${pin.messageId}"]`)
              ?.scrollIntoView({ behavior: "smooth", block: "center" });
          }}
          className="text-[10px] text-stone-500 hover:text-stone-300"
        >
          {copy.jump}
        </button>
      </div>
    </li>
  );
}

export function PinsPanel({ campaignId, version, isLead }: { campaignId: string; version: number; isLead: boolean }) {
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: { title: "Pinned memories", empty: "Nothing pinned. Select text in one of the DM's messages and press the pin icon to put it in front of the DM every turn, whether or not it looks relevant." },
    ru: { title: "Закреплённые воспоминания", empty: "Пока ничего не закреплено. Выделите текст в сообщении мастера и нажмите значок закрепления, чтобы он попадал к мастеру каждый ход, даже если кажется неважным." },
  });
  const [pins, setPins] = useState<PinRow[]>([]);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/campaigns/${campaignId}/pins`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data) {
          setPins(data.pins ?? []);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [campaignId, reload, version]);

  const deletePin = useCallback(
    async (pinId: string) => {
      const response = await fetch(`/api/campaigns/${campaignId}/pins`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinId }),
      });
      if (response.ok) setReload((count) => count + 1);
    },
    [campaignId],
  );

  const used = totalPinTokens(pins);
  const pct = Math.min(100, Math.round((used / PIN_TOKEN_CAP) * 100));

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h3 className="px-1 text-[10px] font-medium uppercase tracking-wide text-amber-400">{copy.title}</h3>
        <span
          className={cn(
            "font-mono text-[10px]",
            used >= PIN_TOKEN_CAP * 0.9
              ? "text-red-400"
              : used >= PIN_TOKEN_CAP * 0.7
                ? "text-amber-400"
                : "text-stone-500",
          )}
        >
          {used.toLocaleString()} / {PIN_TOKEN_CAP.toLocaleString()}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-stone-800">
        <div
          className={cn(
            "h-full rounded-full",
            used >= PIN_TOKEN_CAP * 0.9
              ? "bg-red-500"
              : used >= PIN_TOKEN_CAP * 0.7
                ? "bg-amber-400"
                : "bg-amber-500/60",
          )}
          style={{ width: `${Math.max(1, pct)}%` }}
        />
      </div>

      {pins.length ? (
        <ul className="space-y-1.5">
          {pins.map((pin) => (
            <PinItem key={pin.id} pin={pin} isLead={isLead} onDelete={deletePin} />
          ))}
        </ul>
      ) : (
        <p className="text-[11px] leading-relaxed text-stone-500">
          {copy.empty}
        </p>
      )}
    </div>
  );
}
