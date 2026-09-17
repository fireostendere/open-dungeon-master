"use client";

import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { Loader2, RotateCcw, ScrollText, Star } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { useI18n } from "@/lib/i18n";
import { describeAuditEntry, sessionText } from "@/lib/i18n/session-text";
import { displayAuditReason, displayAuditWarning } from "@/lib/i18n/audit-text";
import { sessionRequest, SessionRequestError } from "@/lib/i18n/session-request";
import type { CharacterEvent } from "@/lib/db/character-events";
import type { AuditEntry } from "@/app/campaigns/[campaignId]/useCampaignStream";
import type { CharacterSheet } from "@/lib/schemas/sheet";

type FeedItem =
  | { type: "audit"; seq: number; entry: AuditEntry }
  | { type: "milestone"; seq: number; event: CharacterEvent };
type UndoConfirmation = {
  warnings: string[];
  url: string;
  body: Record<string, unknown>;
  busyKey: string;
};

// Every action still uses the authoritative audit endpoints. Localizing a
// description does not modify the underlying delta, reason or milestone.
export function EventLog({ campaignId, auditLog, sheets, characterEvents = [], steersStory = false }: {
  campaignId: string;
  auditLog: AuditEntry[];
  sheets: CharacterSheet[];
  characterEvents?: CharacterEvent[];
  steersStory?: boolean;
}) {
  const { locale } = useI18n();
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<UndoConfirmation | null>(null);
  const pending = useRef(false);
  const nameForCharacter = (id: string) => sheets.find(sheet => sheet.id === id)?.name ?? sessionText(locale, "someone");
  const nameFor = (entry: AuditEntry) => entry.characterName ?? nameForCharacter(entry.characterId);

  async function post(url: string, body: Record<string, unknown>, busyKey: string, confirmed = false) {
    if (pending.current) return;
    pending.current = true;
    setBusyId(busyKey);
    setError("");
    try {
      await sessionRequest(locale, "undoFailed", url, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(confirmed ? { ...body, confirm: true } : body),
      });
      setConfirming(null);
    } catch (cause) {
      if (!confirmed && cause instanceof SessionRequestError && cause.status === 409) {
        setConfirming({ url, body, busyKey,
          warnings: Array.isArray(cause.data.warnings) ? cause.data.warnings.filter((value): value is string => typeof value === "string") : [],
        });
      } else {
        setError(cause instanceof Error ? cause.message : sessionText(locale, "undoFailed"));
      }
    } finally {
      pending.current = false;
      setBusyId("");
    }
  }

  const undoEntry = (entry: AuditEntry) => post(`/api/campaigns/${campaignId}/audit/${entry.id}/undo`, {}, entry.id);
  const revertTurn = (turnId: string) => post(`/api/campaigns/${campaignId}/audit/revert-turn`, { turnId }, `turn:${turnId}`);
  const feed: FeedItem[] = [
    ...auditLog.map(entry => ({ type: "audit" as const, seq: entry.seq, entry })),
    ...characterEvents.map(event => ({ type: "milestone" as const, seq: event.seq, event })),
  ].sort((a, b) => b.seq - a.seq);
  const liveByTurn = new Map<string, number>();
  for (const entry of auditLog) {
    if (entry.turnId && entry.undoable && !entry.revertedAt && entry.kind !== "undo") {
      liveByTurn.set(entry.turnId, (liveByTurn.get(entry.turnId) ?? 0) + 1);
    }
  }
  const revertShownForTurn = new Set<string>();

  return (
    <>
      {error && !confirming ? <p role="alert" className="text-xs text-red-400">{error}</p> : null}
      {!feed.length ? <p className="px-1 py-6 text-center text-xs text-stone-600">{sessionText(locale, "empty")}</p> : null}
      <ol className="space-y-1.5" aria-busy={Boolean(busyId)}>
        {feed.map(item => {
          if (item.type === "milestone") return (
            <li key={`m-${item.event.id}`} className="rounded-md border border-amber-900/40 bg-amber-950/15 px-2.5 py-1.5 text-xs text-stone-300">
              <Star className="mr-1.5 inline size-3 text-amber-400" />
              {nameForCharacter(item.event.campaignCharacterId)}: {item.event.summary}
            </li>
          );
          const entry = item.entry;
          const reverted = Boolean(entry.revertedAt);
          const canUndo = steersStory && entry.undoable && !reverted;
          const turnId = entry.turnId ?? "";
          const showRevertTurn = steersStory && turnId && (liveByTurn.get(turnId) ?? 0) >= 2 && !revertShownForTurn.has(turnId);
          if (showRevertTurn) revertShownForTurn.add(turnId);
          return (
            <li key={entry.id} className="space-y-1">
              {showRevertTurn ? (
                <button type="button" disabled={Boolean(busyId)} onClick={() => revertTurn(turnId)}
                  title={sessionText(locale, "revertTip")}
                  className="flex w-full items-center justify-center gap-1 rounded border border-dashed border-stone-700 py-0.5 text-[10px] text-stone-500 hover:bg-stone-900 hover:text-amber-300">
                  {busyId === `turn:${turnId}` ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />}
                  {sessionText(locale, "revert", { count: liveByTurn.get(turnId) })}
                </button>
              ) : null}
              <div className={cn("rounded-md border border-stone-800 bg-stone-950/40 px-2.5 py-1.5 text-xs text-stone-300", reverted && "opacity-60")}>
                <div className="flex items-start gap-1.5">
                  <span className={cn("min-w-0 flex-1", reverted && "line-through text-stone-500")}>
                    <ScrollText className="mr-1.5 inline size-3 text-amber-600" />
                    {describeAuditEntry(entry, nameFor(entry), locale)}
                  </span>
                  {reverted ? <span className="shrink-0 rounded-full border border-stone-800 px-1.5 text-[9px] uppercase tracking-wide text-stone-600">{sessionText(locale, "undone")}</span> : null}
                  {canUndo ? (
                    <button type="button" disabled={Boolean(busyId)} onClick={() => undoEntry(entry)}
                      title={sessionText(locale, "undoTip")} aria-label={sessionText(locale, "undoTip")}
                      className="shrink-0 text-stone-600 hover:text-amber-300">
                      {busyId === entry.id ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />}
                    </button>
                  ) : null}
                </div>
                {entry.reason ? <span className="block pl-4.5 text-[11px] text-stone-500">{displayAuditReason(entry.kind, entry.reason, locale)}</span> : null}
              </div>
            </li>
          );
        })}
      </ol>
      {confirming ? (
        <AlertDialog.Root open onOpenChange={open => { if (!open && !pending.current) setConfirming(null); }}>
          <AlertDialog.Portal>
            <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
            <AlertDialog.Content className={cn(ui.dialog, "fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[min(92vw,22rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto")}>
              <AlertDialog.Title className="font-display text-lg tracking-wide text-amber-50">{sessionText(locale, "undoTitle")}</AlertDialog.Title>
              <AlertDialog.Description className="mt-2 text-xs text-stone-400">{sessionText(locale, "overwrite")}</AlertDialog.Description>
              <ul className="mt-2 space-y-1">{confirming.warnings.slice(0, 5).map((warning, index) => (
                <li key={index} className="text-[11px] leading-4 text-amber-300/80">{displayAuditWarning(warning, locale)}</li>
              ))}</ul>
              {error ? <p role="alert" className="mt-2 text-xs text-red-400">{error}</p> : null}
              <div className="mt-4 flex justify-end gap-2">
                <AlertDialog.Cancel className={ui.btnSmall} disabled={Boolean(busyId)}>{sessionText(locale, "cancel")}</AlertDialog.Cancel>
                <button type="button" disabled={Boolean(busyId)} className={ui.btnPrimary}
                  onClick={() => post(confirming.url, confirming.body, confirming.busyKey, true)}>
                  {busyId ? <Loader2 className="size-4 animate-spin" /> : null}{sessionText(locale, "undoConfirm")}
                </button>
              </div>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      ) : null}
    </>
  );
}
