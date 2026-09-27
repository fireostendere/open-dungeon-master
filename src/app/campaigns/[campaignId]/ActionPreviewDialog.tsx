"use client";

import { useCallback, useEffect } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { PlayerMessageBadge, PlayerMessageBody } from "@/app/campaigns/[campaignId]/PlayerMessageStyle";
import { parsePlayerMessage } from "@/lib/player-message";
import { ui } from "@/lib/ui";
import type { Locale } from "@/lib/i18n";

export function ActionPreviewDialog({
  content,
  name,
  portraitUrl,
  locale,
  queuedActions,
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
  note?: string;
  onEdit: () => void;
  onSend: () => void;
  disabled: boolean;
}) {
  const copy = locale === "ru"
    ? { title: "Проверить действие", edit: "Редактировать", send: "Отправить", replay: "Зачитать ещё раз", stop: "Остановить чтение", queued: `Также отправятся запланированные боевые действия: ${queuedActions}. Их итоговый текст составит сервер.` }
    : { title: "Review action", edit: "Edit", send: "Send", replay: "Read aloud again", stop: "Stop reading", queued: `${queuedActions} queued combat actions will also be sent. The server will compose their final text.` };
  const previewText = content || (locale === "ru" ? "Запланированные боевые действия" : "Queued combat actions");
  const speak = useCallback(() => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(parsePlayerMessage(previewText).text);
    utterance.lang = locale === "ru" ? "ru-RU" : "en-US";
    window.speechSynthesis.speak(utterance);
  }, [locale, previewText]);

  useEffect(() => {
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
      {queuedActions > 0 ? <p className="mt-3 text-xs text-amber-200/80">{copy.queued}</p> : null}
      {note ? <p className="mt-3 text-xs text-amber-200/80">{note}</p> : null}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        {typeof window !== "undefined" && "speechSynthesis" in window ? <>
          <button type="button" onClick={speak} className={ui.btnSmall} aria-label={copy.replay} title={copy.replay}><Volume2 className="size-4" /></button>
          <button type="button" onClick={() => window.speechSynthesis.cancel()} className={ui.btnSmall} aria-label={copy.stop} title={copy.stop}><VolumeX className="size-4" /></button>
        </> : null}
        <button type="button" onClick={onEdit} className={`${ui.btnSecondary} ml-auto`}>{copy.edit}</button>
        <button type="button" onClick={onSend} disabled={disabled} className={ui.btnPrimary}>{copy.send}</button>
      </div>
    </Dialog>
  );
}
