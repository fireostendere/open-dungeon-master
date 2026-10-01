"use client";

import { useInlineText } from "@/lib/i18n/inline-text";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, Crosshair, Loader2, Pencil, Plus, Rewind, Scissors, SkipForward, X } from "lucide-react";
import { GameIcon } from "@/components/ui/GameIcon";
import { Fragment, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import type { Chapter } from "@/lib/db/chapters";
import { romanNumeral, type PublicAct, type StoryArc } from "@/lib/dm/arc-logic";
import { MAX_BEAT_TEXT, type BeatEdit } from "@/lib/dm/arc-edit-logic";
import { ExportMenu } from "./ExportMenu";
import { NpcReviewPanel } from "./NpcReviewPanel";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";

// Confirmation for a chapter rewind (the server answered 409 with the
// consequences). Rewinds are destructive: everything after the boundary is
// deleted and the world snaps back to how it stood.
function ConfirmRewindDialog({
  chapterIndex,
  warnings,
  busy,
  onConfirm,
  onCancel,
}: {
  chapterIndex: number;
  warnings: string[];
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: { title: "Rewind to Chapter {chapter}?", warning: "The story returns to the start of Chapter {chapter}. Sheets, NPCs, facts, and the world roll back with it. This cannot be undone.", cancel: "Cancel", rewind: "Rewind" },
    ru: { title: "Вернуться к главе {chapter}?", warning: "История вернётся к началу главы {chapter}. Листы персонажей, NPC, факты и мир откатятся вместе с ней. Это нельзя отменить.", cancel: "Отмена", rewind: "Вернуться" },
  });
  return (
    <AlertDialog.Root open onOpenChange={(open) => !open && onCancel()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <AlertDialog.Content
          className={cn(
            ui.dialog,
            "fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[min(92vw,22rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto",
          )}
        >
          <AlertDialog.Title className="font-display text-lg tracking-wide text-amber-50">
            {copy.title.replace("{chapter}", String(chapterIndex))}
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-xs text-stone-400">
            {copy.warning.replace("{chapter}", String(chapterIndex))}
          </AlertDialog.Description>
          <ul className="mt-2 space-y-1">
            {warnings.slice(0, 8).map((warning, index) => (
              <li key={index} className="text-[11px] leading-4 text-amber-300/80">
                {warning}
              </li>
            ))}
          </ul>
          <div className="mt-4 flex justify-end gap-2">
            <AlertDialog.Cancel className={ui.btnSmall}>{copy.cancel}</AlertDialog.Cancel>
            <button type="button" onClick={onConfirm} disabled={busy} className={ui.btnPrimary}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null} {copy.rewind}
            </button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

// The rule between acts in the chapter list: the act's number on a gold
// hairline, the name the table was shown, and the recap it heard when the
// act ended.
function ActHeading({ act, title, recap }: { act: number; title: string; recap: string }) {
  const { locale } = useI18n();
  const copy = localeText(locale, { en: { act: "Act {act}" }, ru: { act: "Акт {act}" } });
  return (
    <li className="pt-2">
      <div className="flex items-center gap-2">
        <span className="h-px flex-1 bg-gradient-to-r from-transparent to-amber-500/60" aria-hidden="true" />
        <span className="font-display text-[11px] uppercase tracking-[0.22em] text-amber-300">
          {copy.act.replace("{act}", romanNumeral(act))}
        </span>
        <span className="h-px flex-1 bg-gradient-to-l from-transparent to-amber-500/60" aria-hidden="true" />
      </div>
      {title ? <p className="mt-1 text-center font-display text-sm text-amber-100">{title}</p> : null}
      {recap ? <p className="mt-1 text-center text-[11px] leading-4 text-stone-400">{recap}</p> : null}
    </li>
  );
}

// Story-so-far browser: every closed chapter with its title, highlights,
// and expandable summary, plus the chapter in progress. The party lead can
// close the open chapter and touch up recorded history.
function ChapterCard({
  campaignId,
  chapter,
  steersStory,
  onRewind,
}: {
  campaignId: string;
  chapter: Chapter;
  steersStory: boolean;
  onRewind?: () => void;
}) {
  const uiText = useInlineText();
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: { chapter: "Chapter", noSummary: "No summary recorded.", edit: "Edit", rewindTitle: "Rewind the whole campaign to the start of this chapter", rewind: "Rewind to start", save: "Save", cancel: "Cancel" },
    ru: { chapter: "Глава", noSummary: "Итог ещё не записан.", edit: "Редактировать", rewindTitle: "Откатить всю кампанию к началу этой главы", rewind: "Вернуться к началу", save: "Сохранить", cancel: "Отмена" },
  });
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(chapter.title);
  const [summary, setSummary] = useState(chapter.summary);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await fetch(`/api/campaigns/${campaignId}/chapters/${chapter.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim() || chapter.title, summary }),
      });
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-lg border border-stone-800 bg-stone-950/40 p-2.5">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-start gap-1.5 text-left"
      >
        {expanded ? (
          <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-stone-500" />
        ) : (
          <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-stone-500" />
        )}
        <span className="min-w-0">
          <span className="block text-xs font-medium text-amber-200">
            {chapter.index}. {chapter.title || `${copy.chapter} ${chapter.index}`}
          </span>
        </span>
      </button>
      {chapter.highlights.length && !editing ? (
        <ul className="mt-1.5 space-y-0.5 pl-5">
          {(expanded ? chapter.highlights : chapter.highlights.slice(0, 2)).map(
            (highlight, index) => (
              <li key={index} className="list-disc text-[11px] leading-4 text-stone-400">
                {highlight}
              </li>
            ),
          )}
        </ul>
      ) : null}
      {expanded && !editing ? (
        <div className="mt-2 space-y-1.5 pl-5">
          {chapter.summary ? (
            <p className="whitespace-pre-wrap text-[11px] leading-4 text-stone-300">
              {chapter.summary}
            </p>
          ) : (
            <p className="text-[11px] italic text-stone-600">{copy.noSummary}</p>
          )}
          {steersStory ? (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="flex items-center gap-1 text-[11px] text-stone-500 hover:text-stone-300"
              >
                <Pencil className="size-3" /> {copy.edit}
              </button>
              {onRewind ? (
                <button
                  type="button"
                  onClick={onRewind}
                  title={copy.rewindTitle}
                  className="flex items-center gap-1 text-[11px] text-stone-500 hover:text-amber-300"
                >
                  <Rewind className="size-3" /> {copy.rewind}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {editing ? (
        <div className="mt-2 space-y-1.5 pl-5">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={80}
            className="w-full rounded border border-stone-700 bg-stone-900 px-2 py-1 text-xs outline-none focus:border-amber-600"
          />
          <textarea
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            rows={6}
            maxLength={4000}
            className="w-full rounded border border-stone-700 bg-stone-900 px-2 py-1 text-[11px] leading-4 outline-none focus:border-amber-600"
          />
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="flex items-center gap-1 rounded border border-stone-700 px-2 py-0.5 text-[11px] text-stone-300 hover:bg-stone-900"
            >
              {busy ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
              {uiText("Save")}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setTitle(chapter.title);
                setSummary(chapter.summary);
              }}
              className="flex items-center gap-1 rounded border border-stone-700 px-2 py-0.5 text-[11px] text-stone-500 hover:bg-stone-900"
            >
              <X className="size-3" /> {uiText("Cancel")}
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}


// Lead-only NPC roster hygiene, collapsed by default so it costs nothing
// until asked for: the panel fetches the roster the moment it mounts.
function NpcReviewCard({ campaignId }: { campaignId: string }) {
  const uiText = useInlineText();
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-lg border border-stone-800 bg-stone-950/40 p-2.5">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-start gap-1.5 text-left"
      >
        {expanded ? (
          <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-stone-500" />
        ) : (
          <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-stone-500" />
        )}
        <span className="flex items-center gap-1.5 text-xs font-medium text-amber-200">
          <GameIcon icon={{ kind: "glyph", key: "system-cast" }} size="size-6" /> {uiText("NPC roster")}
        </span>
      </button>
      {expanded ? (
        <div className="mt-2 pl-5">
          <NpcReviewPanel campaignId={campaignId} />
        </div>
      ) : null}
    </div>
  );
}

// Lead-only view of the DM's secret story arc: the main beats the AI is
// steering by plus the open quest threads, editable a beat at a time, with a
// regenerate escape hatch for when the whole spine no longer fits.
//
// Beats that already played are deliberately not editable. They are a record
// of what happened at the table rather than a plan, and the server refuses
// those edits regardless; the UI just does not offer them.
function ArcCard({ campaignId }: { campaignId: string }) {
  const uiText = useInlineText();
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: { editFailed: "That edit did not go through.", arc: "DM story arc (secret)", loading: "Loading...", saga: "Saga", sequel: "sequel", act: "act", of: "of", stakes: "Stakes:", antagonist: "Antagonist:", now: "(now)", skipped: "(skipped)", play: "Make this the beat in play", up: "Move up", down: "Move down", reword: "Reword this beat", skip: "Skip this beat", happens: "What happens in this beat", ahead: "Acts ahead (sketches)", cast: "Recurring cast", wants: "wants:", events: "Planned events (may never fire)", when: "when", threads: "Open threads", previous: "Previous sagas", emptyPlot: "No story arc yet. It is written when the adventure begins, or generate one now.", empty: "No story arc yet.", regenerateTitle: "Discard the current arc and have the DM plot a fresh one from the premise", plotting: "Plotting a new arc...", regenerate: "Generate story arc", waypoint: "Waypoint: {text}", kinds: { place: "place", npc: "person", item: "item", objective: "objective", fight: "fight", narrative: "story" } },
    ru: { editFailed: "Не удалось изменить этот этап.", arc: "Арка истории мастера (секрет)", loading: "Загрузка...", saga: "Сага", sequel: "продолжение", act: "акт", of: "из", stakes: "Ставки:", antagonist: "Антагонист:", now: "(сейчас)", skipped: "(пропущено)", play: "Сделать текущим этапом", up: "Переместить выше", down: "Переместить ниже", reword: "Изменить формулировку этапа", skip: "Пропустить этап", happens: "Что происходит на этом этапе", ahead: "Будущие акты (наброски)", cast: "Постоянные NPC", wants: "хочет:", events: "Запланированные события (могут не произойти)", when: "когда", threads: "Открытые нити", previous: "Предыдущие саги", emptyPlot: "Арки истории пока нет. Она будет написана с началом приключения или сгенерирована сейчас.", empty: "Арки истории пока нет.", regenerateTitle: "Отбросить текущую арку и поручить мастеру построить новую из завязки", plotting: "Строим новую арку...", regenerate: "Создать арку истории", waypoint: "Шаг: {text}", kinds: { place: "место", npc: "персонаж", item: "предмет", objective: "цель", fight: "бой", narrative: "сюжет" } },
  });
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [arc, setArc] = useState<StoryArc | null>(null);
  const [outline, setOutline] = useState("");
  // 1-based beat number being renamed, or an act number being added to.
  const [editingBeat, setEditingBeat] = useState<number | null>(null);
  const [addingToAct, setAddingToAct] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [beatBusy, setBeatBusy] = useState(false);
  const [beatError, setBeatError] = useState("");

  async function editBeat(edit: BeatEdit) {
    setBeatBusy(true);
    setBeatError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/arc`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(edit),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setBeatError(data.error ?? copy.editFailed);
        return false;
      }
      setArc(data.arc);
      return true;
    } catch {
      setBeatError(copy.editFailed);
      return false;
    } finally {
      setBeatBusy(false);
    }
  }

  function closeEditor() {
    setEditingBeat(null);
    setAddingToAct(null);
    setDraft("");
    setBeatError("");
  }

  async function submitDraft() {
    const text = draft.trim();
    if (!text) {
      return;
    }
    const edit: BeatEdit =
      addingToAct !== null
        ? { op: "add", act: addingToAct, text }
        : { op: "rename", beat: editingBeat ?? 0, text };
    if (await editBeat(edit)) {
      closeEditor();
    }
  }

  async function load() {
    setLoading(true);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/arc`);
      if (response.ok) {
        const data = (await response.json()) as { arc: StoryArc | null; dmOutline: string };
        setArc(data.arc);
        setOutline(data.dmOutline);
      }
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    const next = !expanded;
    setExpanded(next);
    if (next) {
      void load();
    }
  }

  const openThreads = arc?.subArcs.filter(
    (subArc) => subArc.status === "active" || subArc.status === "pending",
  );
  const cast = arc?.cast.filter((npc) => npc.status === "active");
  const plannedEvents = arc?.events.filter((event) => event.status === "pending");
  // Beats carry their act, so the flat list renders as act groups while the
  // displayed numbers stay the arc's own 1-based beat numbers.
  const actGroups = arc
    ? Array.from(new Set(arc.beats.map((beat) => beat.act))).sort((a, b) => a - b)
    : [];
  // Acts still ahead exist only as saga sketches; they render as muted rows
  // below the detailed acts.
  const aheadSketches =
    arc?.saga?.sketches.filter((sketch) => sketch.status === "sketch" && sketch.act > arc.acts) ??
    [];
  const currentAct = arc
    ? (arc.beats.find((beat) => beat.status === "active")?.act ?? arc.acts)
    : 0;

  return (
    <div className="rounded-lg border border-stone-800 bg-stone-950/40 p-2.5">
      <button type="button" onClick={toggle} className="flex w-full items-start gap-1.5 text-left">
        {expanded ? (
          <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-stone-500" />
        ) : (
          <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-stone-500" />
        )}
        <span className="flex items-center gap-1.5 text-xs font-medium text-amber-200">
          <GameIcon icon={{ kind: "glyph", key: "system-storyboard" }} size="size-6" /> {copy.arc}
        </span>
      </button>
      {expanded ? (
        <div className="mt-2 space-y-2 pl-5">
          {loading ? (
            <p className="flex items-center gap-1 text-[11px] text-stone-500">
              <Loader2 className="size-3 animate-spin" /> {copy.loading}
            </p>
          ) : arc ? (
            <>
              {arc.saga ? (
                <p className="text-[11px] font-medium leading-4 text-amber-200">
                  {arc.saga.sagaIndex > 1 ? `${copy.saga} ${arc.saga.sagaIndex} (${copy.sequel}): ` : ""}
                  &ldquo;{arc.saga.title}&rdquo;
                  <span className="font-normal text-stone-400">
                    {" "}
                    &middot; {copy.act} {currentAct} {copy.of} {arc.saga.plannedActs}
                  </span>
                </p>
              ) : null}
              <p className="text-[11px] leading-4 text-stone-300">{arc.premise}</p>
              {arc.stakes ? (
                <p className="text-[11px] leading-4 text-stone-400">{copy.stakes} {arc.stakes}</p>
              ) : null}
              {arc.antagonist ? (
                <p className="text-[11px] leading-4 text-stone-400">{copy.antagonist} {arc.antagonist}</p>
              ) : null}
              {actGroups.map((act) => (
                <div key={act}>
                  <p className="text-[11px] font-medium text-stone-400">{uiText("Act")} {act}</p>
                  <ol className="mt-0.5 space-y-0.5">
                    {arc.beats.map((beat, index) => {
                      if (beat.act !== act) {
                        return null;
                      }
                      const number = index + 1;
                      const settled = beat.status === "done" || beat.status === "skipped";
                      if (editingBeat === number) {
                        return (
                          <li key={index} className="list-none">
                            <input
                              value={draft}
                              autoFocus
                              maxLength={MAX_BEAT_TEXT}
                              onChange={(event) => setDraft(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  void submitDraft();
                                } else if (event.key === "Escape") {
                                  closeEditor();
                                }
                              }}
                              className={cn(ui.input, "px-2 py-1 text-[11px]")}
                            />
                            <div className="mt-1 flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => void submitDraft()}
                                disabled={beatBusy || !draft.trim()}
                                className={cn(ui.btnSmall, "px-2 py-0.5 text-[11px]")}
                              >
                                <Check className="size-3" /> {uiText("Save")}
                              </button>
                              <button
                                type="button"
                                onClick={closeEditor}
                                className={cn(ui.btnSmall, "px-2 py-0.5 text-[11px]")}
                              >
                                {uiText("Cancel")}
                              </button>
                            </div>
                          </li>
                        );
                      }
                      return (
                        <li
                          key={index}
                          className={`group flex items-start gap-1 text-[11px] leading-4 ${
                            settled
                              ? "text-stone-600 line-through"
                              : beat.status === "active"
                                ? "text-amber-200"
                                : "text-stone-400"
                          }`}
                        >
                          <span className="min-w-0 flex-1">
                            {number}. {beat.status === "active" ? `${copy.now} ` : ""}
                            {beat.status === "skipped" ? `${copy.skipped} ` : ""}
                            {beat.text}
                            {beat.detail ? (
                              <span className="text-stone-500"> [{beat.detail}]</span>
                            ) : null}
                            {/* The beat's checklist: the server ticks place, person, item and fight steps from the narrator's tools; the lead corrects it by hand. */}
                            {!settled && beat.waypoints?.length ? (
                              <ul className="mt-1 space-y-0.5">
                                {beat.waypoints.map((waypoint, at) => (
                                  <li key={at}>
                                    <label className="flex cursor-pointer items-start gap-1.5 text-[11px] leading-4 text-stone-400">
                                      <input
                                        type="checkbox"
                                        className="mt-0.5 size-3 shrink-0 accent-amber-400"
                                        checked={waypoint.done}
                                        disabled={beatBusy}
                                        aria-label={copy.waypoint.replace("{text}", waypoint.text)}
                                        onChange={(event) =>
                                          void editBeat({ op: "waypoint", beat: number, index: at, done: event.target.checked })
                                        }
                                      />
                                      <span className={waypoint.done ? "text-stone-600 line-through" : ""}>
                                        {waypoint.text} <span className="text-stone-600">({copy.kinds[waypoint.kind]})</span>
                                      </span>
                                    </label>
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </span>
                          {settled ? null : (
                            <span className="flex shrink-0 items-center">
                              {beat.status === "active" ? null : (
                                <button
                                  type="button"
                                  disabled={beatBusy}
                                  onClick={() => void editBeat({ op: "setNow", beat: number })}
                                  className={cn(ui.iconAction, "p-1")}
                                  title={copy.play}
                                  aria-label={copy.play}
                                >
                                  <Crosshair className="size-3" />
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={beatBusy}
                                onClick={() =>
                                  void editBeat({ op: "move", beat: number, direction: "up" })
                                }
                                className={cn(ui.iconAction, "p-1")}
                                title={copy.up}
                                aria-label={copy.up}
                              >
                                <ArrowUp className="size-3" />
                              </button>
                              <button
                                type="button"
                                disabled={beatBusy}
                                onClick={() =>
                                  void editBeat({ op: "move", beat: number, direction: "down" })
                                }
                                className={cn(ui.iconAction, "p-1")}
                                title={copy.down}
                                aria-label={copy.down}
                              >
                                <ArrowDown className="size-3" />
                              </button>
                              <button
                                type="button"
                                disabled={beatBusy}
                                onClick={() => {
                                  closeEditor();
                                  setEditingBeat(number);
                                  setDraft(beat.text);
                                }}
                                className={cn(ui.iconAction, "p-1")}
                                title={copy.reword}
                                aria-label={copy.reword}
                              >
                                <Pencil className="size-3" />
                              </button>
                              <button
                                type="button"
                                disabled={beatBusy}
                                onClick={() => void editBeat({ op: "skip", beat: number })}
                                className={cn(ui.iconAction, "p-1")}
                                title={copy.skip}
                                aria-label={copy.skip}
                              >
                                <SkipForward className="size-3" />
                              </button>
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                  {addingToAct === act ? (
                    <div className="mt-1">
                      <input
                        value={draft}
                        autoFocus
                        maxLength={MAX_BEAT_TEXT}
                        placeholder={copy.happens}
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            void submitDraft();
                          } else if (event.key === "Escape") {
                            closeEditor();
                          }
                        }}
                        className={cn(ui.input, "px-2 py-1 text-[11px]")}
                      />
                      <div className="mt-1 flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => void submitDraft()}
                          disabled={beatBusy || !draft.trim()}
                          className={cn(ui.btnSmall, "px-2 py-0.5 text-[11px]")}
                        >
                          <Check className="size-3" /> {uiText("Add")}
                        </button>
                        <button
                          type="button"
                          onClick={closeEditor}
                          className={cn(ui.btnSmall, "px-2 py-0.5 text-[11px]")}
                        >
                          {uiText("Cancel")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        closeEditor();
                        setAddingToAct(act);
                      }}
                      className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-stone-600 hover:text-amber-200"
                    >
                      <Plus className="size-3" /> {uiText("Add a beat")}
                    </button>
                  )}
                </div>
              ))}
              {beatError ? <p className="text-[11px] text-red-400">{beatError}</p> : null}
              {aheadSketches.length ? (
                <div>
                  <p className="text-[11px] font-medium text-stone-500"> {copy.ahead}</p>
                  <ul className="mt-0.5 space-y-0.5">
                    {aheadSketches.map((sketch) => (
                      <li key={sketch.act} className="list-none text-[11px] leading-4 text-stone-500">
                        {uiText("Act")} {sketch.act}: {sketch.milestone}
                        {sketch.boss ? (
                          <span className="text-stone-600"> {uiText("&middot; boss:")} {sketch.boss.name}</span>
                        ) : null}
                        {sketch.allies.length ? (
                          <span className="text-stone-600">
                            {" "}
                            &middot; {uiText("Allies planned: {count}", { count: sketch.allies.length })}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {arc.finale ? (
                <p className="text-[11px] leading-4 text-stone-400">
                  {uiText("Finale:")} {arc.finale}
                  {arc.saga?.finaleBoss ? (
                    <span className="text-stone-500">
                      {" "}
                      {uiText("&middot; final boss:")} {arc.saga.finaleBoss.name}
                    </span>
                  ) : null}
                </p>
              ) : null}
              {cast?.length ? (
                <div>
                  <p className="text-[11px] font-medium text-stone-400"> {copy.cast}</p>
                  <ul className="mt-0.5 space-y-0.5">
                    {cast.map((npc) => (
                      <li key={npc.id} className="list-none text-[11px] leading-4 text-stone-400">
                        {npc.name}
                        {npc.role ? `, ${npc.role}` : ""}
                        {npc.agenda ? (
                          <span className="text-stone-500"> {copy.wants} {npc.agenda}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {plannedEvents?.length ? (
                <div>
                  <p className="text-[11px] font-medium text-stone-400">
                    {copy.events}
                  </p>
                  <ul className="mt-0.5 space-y-0.5">
                    {plannedEvents.map((event) => (
                      <li key={event.id} className="list-none text-[11px] leading-4 text-stone-400">
                        {event.name}
                        <span className="text-stone-500">
                          {" "}
                          [{event.kind.replaceAll("_", " ")}]
                          {event.trigger ? ` ${copy.when} ${event.trigger}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {openThreads?.length ? (
                <div>
                  <p className="text-[11px] font-medium text-stone-400"> {copy.threads}</p>
                  <ul className="mt-0.5 space-y-0.5">
                    {openThreads.map((subArc) => (
                      <li key={subArc.id} className="list-none text-[11px] leading-4 text-stone-400">
                        {subArc.name}: {subArc.goal}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {arc.saga?.priorSagas.length ? (
                <div>
                  <p className="text-[11px] font-medium text-stone-500"> {copy.previous}</p>
                  <ul className="mt-0.5 space-y-0.5">
                    {arc.saga.priorSagas.map((prior, index) => (
                      <li key={index} className="list-none text-[11px] leading-4 text-stone-500">
                        &ldquo;{prior.title}&rdquo;
                        {prior.resolution ? (
                          <span className="text-stone-600"> &middot; {prior.resolution}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : outline ? (
            <p className="whitespace-pre-wrap text-[11px] leading-4 text-stone-400">{outline}</p>
          ) : (
            <p className="text-[11px] italic text-stone-600">{copy.empty}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function StoryPanel({
  campaignId,
  chapters,
  steersStory,
}: {
  campaignId: string;
  chapters: Chapter[];
  steersStory: boolean;
}) {
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: { notBegun: "The story has not begun. Chapters appear here as the adventure unfolds.", progress: "Chapter {chapter} in progress", actProgress: "Act {act}, chapter {chapter} in progress", seal: "Seal this chapter; the DM writes its title and summary", writing: "Writing the chapter...", close: "Close chapter", restartTitle: "Discard this chapter's progress and return to how it began", restart: "Restart this chapter" },
    ru: { notBegun: "История ещё не началась. Главы появятся здесь по мере развития приключения.", progress: "Глава {chapter} в процессе", actProgress: "Акт {act}, глава {chapter} в процессе", seal: "Завершить главу; мастер напишет её название и итог", writing: "Мастер пишет главу...", close: "Завершить главу", restartTitle: "Отменить прогресс этой главы и вернуться к её началу", restart: "Начать эту главу заново" },
  });
  const [closing, setClosing] = useState(false);
  const [rewindable, setRewindable] = useState<number[]>([]);
  const [rewindTarget, setRewindTarget] = useState<{
    chapterIndex: number;
    warnings: string[];
  } | null>(null);
  const [rewindBusy, setRewindBusy] = useState(false);
  // The acts the table has been told about: names and recaps for the
  // headings between chapters. Player-safe by construction (publicActs).
  const [acts, setActs] = useState<PublicAct[]>([]);
  const closed = chapters.filter((chapter) => chapter.status === "closed");
  const open = chapters.find((chapter) => chapter.status === "open");

  // The acts for everyone; which chapters have a boundary snapshot to
  // rewind to is lead-only UI.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/campaigns/${campaignId}/chapters`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data) {
          return;
        }
        if (Array.isArray(data.acts)) {
          setActs(data.acts as PublicAct[]);
        }
        if (steersStory && Array.isArray(data.rewindableChapters)) {
          setRewindable(data.rewindableChapters as number[]);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [campaignId, steersStory, chapters.length]);

  async function postRewind(chapterIndex: number, confirm: boolean) {
    setRewindBusy(true);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/chapters/rollback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapterIndex, confirm }),
      });
      if (response.status === 409) {
        const data = await response.json().catch(() => ({}));
        setRewindTarget({
          chapterIndex,
          warnings: Array.isArray(data.warnings) ? data.warnings : [],
        });
        return;
      }
      // Success or failure, the confirm dialog is done; the campaign_rewound
      // event reloads the whole view.
      setRewindTarget(null);
    } finally {
      setRewindBusy(false);
    }
  }

  async function closeChapter() {
    setClosing(true);
    try {
      await fetch(`/api/campaigns/${campaignId}/chapters`, { method: "POST" });
    } finally {
      // The chapter_closed event updates the list; a short hold avoids
      // double-submits while the summary is being written.
      setTimeout(() => setClosing(false), 4_000);
    }
  }

  if (!closed.length && !open) {
    return (
      <div className="space-y-2">
        {steersStory ? <ArcCard campaignId={campaignId} /> : null}
        {steersStory ? <NpcReviewCard campaignId={campaignId} /> : null}
        <p className="px-1 py-6 text-center text-xs text-stone-600">
          {copy.notBegun}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {steersStory ? <ArcCard campaignId={campaignId} /> : null}
      {steersStory ? <NpcReviewCard campaignId={campaignId} /> : null}
      <ExportMenu campaignId={campaignId} />
      <div className="rounded-lg border border-dashed border-stone-800 p-2.5">
        <p className="flex items-center gap-1.5 text-xs text-stone-400">
          <GameIcon icon={{ kind: "glyph", key: "tab-story" }} size="size-5" />
          {(open?.act ? copy.actProgress.replace("{act}", romanNumeral(open.act)) : copy.progress).replace(
            "{chapter}",
            String(open?.index ?? closed.length + 1),
          )}
        </p>
        {steersStory ? (
          <button
            type="button"
            onClick={closeChapter}
            disabled={closing}
            title={copy.seal}
            className="mt-1.5 flex w-full items-center justify-center gap-1 rounded border border-stone-700 py-1 text-[11px] text-stone-400 hover:bg-stone-900 disabled:opacity-50"
          >
            {closing ? (
              <>
                <Loader2 className="size-3 animate-spin" /> {copy.writing}
              </>
            ) : (
              <>
                <Scissors className="size-3" /> {copy.close}
              </>
            )}
          </button>
        ) : null}
        {steersStory && open && rewindable.includes(open.index) ? (
          <button
            type="button"
            onClick={() => void postRewind(open.index, false)}
            disabled={rewindBusy}
            title={copy.restartTitle}
            className="mt-1.5 flex w-full items-center justify-center gap-1 rounded border border-stone-700 py-1 text-[11px] text-stone-400 hover:bg-stone-900 disabled:opacity-50"
          >
            <Rewind className="size-3" /> {copy.restart}
          </button>
        ) : null}
      </div>
      <ol className="space-y-2">
        {[...closed].reverse().map((chapter, index, list) => {
          // Newest first, so an act's heading sits above the newest chapter
          // of that act. Chapters sealed before acts were stamped have none
          // and run on without a heading.
          const previous = index > 0 ? list[index - 1] : null;
          const boundary =
            chapter.act !== null &&
            (!previous || previous.act !== chapter.act || (previous.saga ?? 1) !== (chapter.saga ?? 1));
          const act = boundary
            ? acts.find((entry) => entry.act === chapter.act && entry.sagaIndex === (chapter.saga ?? 1))
            : undefined;
          return (
            <Fragment key={chapter.id}>
              {boundary && chapter.act !== null ? (
                <ActHeading act={chapter.act} title={act?.title ?? ""} recap={act?.recap ?? ""} />
              ) : null}
              <ChapterCard
                campaignId={campaignId}
                chapter={chapter}
                steersStory={steersStory}
                onRewind={
                  steersStory && rewindable.includes(chapter.index)
                    ? () => void postRewind(chapter.index, false)
                    : undefined
                }
              />
            </Fragment>
          );
        })}
      </ol>
      {rewindTarget ? (
        <ConfirmRewindDialog
          chapterIndex={rewindTarget.chapterIndex}
          warnings={rewindTarget.warnings}
          busy={rewindBusy}
          onConfirm={() => void postRewind(rewindTarget.chapterIndex, true)}
          onCancel={() => setRewindTarget(null)}
        />
      ) : null}
    </div>
  );
}
