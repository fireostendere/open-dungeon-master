"use client";

import { Loader2, RotateCcw, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { DM_HALTED_PREFIX } from "@/lib/campaign-types";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";
import { displaySystemText } from "@/lib/i18n/session-system-text";

// A DM turn that threw. Everything the turn had (its conversation, tool calls
// and tool results) is still on the dm_turns row, so the lead can send the DM
// back in where it stopped instead of retyping the action, which would leave
// the same action in the transcript twice.
//
// The retry itself is durable server state: the moment it is claimed the
// notice loses its dmTurnId and this banner disappears for every client via
// message_updated. Local state here only covers the request in flight.
export function HaltedTurnBanner({
  campaignId,
  turnId,
  content,
  canRetry,
}: {
  campaignId: string;
  turnId: string;
  content: string;
  canRetry: boolean;
}) {
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: { halted: "DM halted, context preserved", retry: "Retry the turn", retrying: "Picking the thread back up...", unavailable: "The party lead can send the DM back in from here.", restartFailed: "Could not restart that turn.", offline: "Could not reach the server.", noStoryteller: "This world has no AI storyteller configured." },
    ru: { halted: "Мастер остановился, контекст сохранён", retry: "Повторить ход", retrying: "Возобновляем ход...", unavailable: "Лидер отряда может повторить ход Мастера.", restartFailed: "Не удалось повторить этот ход.", offline: "Не удалось связаться с сервером.", noStoryteller: "Для этого мира не настроен ИИ-ведущий." },
    pl: { halted: "MG zatrzymał się, kontekst zachowany", retry: "Ponów turę", retrying: "Wznawianie tury...", unavailable: "Lider drużyny może wznowić turę MG.", restartFailed: "Nie udało się wznowić tej tury.", offline: "Nie udało się połączyć z serwerem.", noStoryteller: "Ten świat nie ma skonfigurowanego prowadzącego AI." },
  });
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState("");
  const reason = content.startsWith(DM_HALTED_PREFIX)
    ? content.slice(DM_HALTED_PREFIX.length)
    : content;
  const displayedReason = displaySystemText(reason, locale);

  async function retry() {
    if (retrying) {
      return;
    }
    setRetrying(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/dm-turn/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turnId }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error || copy.restartFailed);
      }
      // On success nothing is done here: the banner goes away when the
      // message_updated event lands, and the narration streams in as usual.
    } catch {
      setError(copy.offline);
    } finally {
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
        <button
          type="button"
          onClick={retry}
          disabled={retrying}
          title="Send the DM back into this turn with everything it already had"
          className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-amber-800/70 px-2.5 py-1 text-xs text-amber-200 hover:border-amber-600 hover:text-amber-100 disabled:opacity-50"
        >
          {retrying ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RotateCcw className="size-3.5" />
          )}
           {retrying ? copy.retrying : copy.retry}
        </button>
      ) : (
        <p className="mt-1 text-xs text-stone-600">
           {copy.unavailable}
        </p>
      )}
      {error ? <p className="mt-1 text-xs text-red-400">{error}</p> : null}
    </div>
  );
}
