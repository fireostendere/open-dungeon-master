"use client";

import { useCallback, useEffect } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { PlayerMessageBadge, PlayerMessageBody } from "@/app/campaigns/[campaignId]/PlayerMessageStyle";
import { parsePlayerMessage } from "@/lib/player-message";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import type { Locale } from "@/lib/i18n";

const PREVIEW_TTS_ENABLED = process.env.NEXT_PUBLIC_ACTION_PREVIEW_TTS === "1";

export function ActionPreviewDialog({
  content,
  name,
  portraitUrl,
  locale,
  queuedActions,
  queuedActionLabels = [],
  planTitle,
  note,
  onEdit,
  onSend,
  disabled,
}: {
  content: string;
  name: string;
  portraitUrl?: string;
  locale: Locale;
  queuedActions: number;
  queuedActionLabels?: string[];
  planTitle?: string;
  note?: string;
  onEdit: () => void;
  onSend: () => void;
  disabled: boolean;
}) {
  const copy = locale === "ru"
    ? { title: "Проверить действие", edit: "Редактировать", send: "Отправить", replay: "Зачитать ещё раз", stop: "Остановить чтение", plan: "В план хода отправятся:", queued: `Также отправятся запланированные боевые действия: ${queuedActions}. Их итоговый текст составит сервер.`, noText: "Ход без дополнительного описания." }
    : { title: "Review action", edit: "Edit", send: "Send", replay: "Read aloud again", stop: "Stop reading", plan: "Actions in this turn:", queued: `${queuedActions} queued combat actions will also be sent. The server will compose their final text.`, noText: "Turn without additional description." };
  const previewText = content || (queuedActionLabels.length ? copy.noText : locale === "ru" ? "Запланированные боевые действия" : "Queued combat actions");
  const speak = useCallback(() => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(parsePlayerMessage(previewText).text);
    utterance.lang = locale === "ru" ? "ru-RU" : "en-US";
    window.speechSynthesis.speak(utterance);
  }, [locale, previewText]);

  useEffect(() => {
    if (!PREVIEW_TTS_ENABLED) return;
    speak();
    return () => {
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, [speak]);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onEdit(); }} title={copy.title}>
      <div className="ml-auto max-w-[92%] sm:max-w-2xl">
        <p className="mb-1 flex flex-wrap items-center justify-end gap-1.5 text-right text-xs font-medium text-amber-200/80">
          {portraitUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={portraitUrl} alt="" className="size-6 rounded-full border border-amber-500/30 object-cover" />
          ) : null}
          <PlayerMessageBadge content={previewText} locale={locale} />
          {name}
        </p>
        <PlayerMessageBody content={previewText} />
      </div>
      {queuedActionLabels.length ? <div className="mt-3 rounded-lg border border-amber-800/60 bg-amber-950/30 p-3 text-sm text-amber-100">
        <b>{planTitle ?? copy.plan}</b>
        <ol className="mt-1 list-inside list-decimal space-y-1">{queuedActionLabels.map((label, index) => <li key={`${index}:${label}`}>{label}</li>)}</ol>
      </div> : queuedActions > 0 ? <p className="mt-3 text-xs text-amber-200/80">{copy.queued}</p> : null}
      {note ? <p className="mt-3 text-xs text-amber-200/80">{note}</p> : null}
      <div className="mt-5 flex items-center gap-2">
        {PREVIEW_TTS_ENABLED && typeof window !== "undefined" && "speechSynthesis" in window ? <>
          <button type="button" onClick={speak} className={ui.btnSmall} aria-label={copy.replay} title={copy.replay}><Volume2 className="size-4" /></button>
          <button type="button" onClick={() => window.speechSynthesis.cancel()} className={ui.btnSmall} aria-label={copy.stop} title={copy.stop}><VolumeX className="size-4" /></button>
        </> : null}
        <div className="ml-auto grid min-w-0 flex-1 grid-cols-2 gap-2 sm:flex sm:flex-initial">
          <button type="button" onClick={onEdit} className={cn(ui.btnSecondary, "min-w-0 w-full px-2 text-[11px] tracking-normal sm:w-auto sm:px-3 sm:text-[13px] sm:tracking-[0.12em]")}>{copy.edit}</button>
          <button type="button" onClick={onSend} disabled={disabled} className={cn(ui.btnPrimary, "min-w-0 w-full px-2 text-[11px] tracking-normal sm:w-auto sm:px-4 sm:text-[13px] sm:tracking-[0.14em]")}>{copy.send}</button>
        </div>
      </div>
    </Dialog>
  );
}
