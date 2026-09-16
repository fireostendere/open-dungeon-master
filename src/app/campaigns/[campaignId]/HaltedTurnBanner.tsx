"use client";

import { Loader2, RotateCcw, TriangleAlert } from "lucide-react";
import { useRef, useState } from "react";
import { DM_HALTED_PREFIX } from "@/lib/campaign-types";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";
import { displaySystemText } from "@/lib/i18n/session-system-text";
import { messageText } from "@/lib/i18n/message-text";
import { sessionRequest } from "@/lib/i18n/session-request";

// Retrying claims the saved turn. Only the persisted message_updated event
// removes this banner; a localized HTTP failure must not look like success.
export function HaltedTurnBanner({ campaignId, turnId, content, canRetry }: {
  campaignId: string;
  turnId: string;
  content: string;
  canRetry: boolean;
}) {
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: { halted: "DM halted, context preserved", retry: "Retry the turn", retrying: "Picking the thread back up...", unavailable: "The party lead can send the DM back in from here.", restartFailed: "Could not restart that turn." },
    ru: { halted: "Мастер остановился, контекст сохранён", retry: "Повторить ход", retrying: "Возобновляем ход...", unavailable: "Лидер отряда может повторить ход Мастера.", restartFailed: "Не удалось повторить этот ход." },
    pl: { halted: "MG zatrzymał się, kontekst zachowany", retry: "Ponów turę", retrying: "Wznawianie tury...", unavailable: "Lider drużyny może wznowić turę MG.", restartFailed: "Nie udało się wznowić tej tury." },
  });
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  // Preserve the canonical prefix in storage, including old provider errors.
  // The projection localizes known diagnostics and gives a safe localized
  // fallback for unknown diagnostics without changing their stored content.
  const displayedReason = displaySystemText(content.startsWith(DM_HALTED_PREFIX) ? content : DM_HALTED_PREFIX + content, locale);

  async function retry() {
    if (pending.current || !canRetry) return;
    pending.current = true;
    setRetrying(true);
    setError("");
    try {
      await sessionRequest(locale, "continueFailed", `/api/campaigns/${campaignId}/dm-turn/retry`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turnId }),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.restartFailed);
    } finally {
      pending.current = false;
      setRetrying(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl rounded-lg border border-amber-900/60 bg-amber-950/20 px-4 py-2.5">
      <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-amber-300">
        <TriangleAlert className="size-3.5 shrink-0" /> {copy.halted}
      </p>
      <p className="mt-0.5 text-sm text-stone-400">{displayedReason}</p>
      {canRetry ? (
        <button type="button" onClick={retry} disabled={retrying}
          title={messageText(locale, "Send the DM back into this turn with everything it already had")}
          className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-amber-800/70 px-2.5 py-1 text-xs text-amber-200 hover:border-amber-600 hover:text-amber-100 disabled:opacity-50">
          {retrying ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
          {retrying ? copy.retrying : copy.retry}
        </button>
      ) : <p className="mt-1 text-xs text-stone-600">{copy.unavailable}</p>}
      {error ? <p role="alert" className="mt-1 text-xs text-red-400">{error}</p> : null}
    </div>
  );
}
