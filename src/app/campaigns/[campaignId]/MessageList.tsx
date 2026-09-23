"use client";

import {
  Bookmark,
  ChevronLeft,
  FastForward,
  Pencil,
  ChevronRight,
  Crown,
  EyeOff,
  Flag,
  ImageOff,
  ImagePlus,
  Loader2,
  Pin,
  RefreshCw,
  ShieldQuestion,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { avatarPlaceholder, characterPlaceholder } from "@/lib/placeholders";
import { DM_HALTED_PREFIX, JOIN_NOTE_PREFIX, LEAD_NOTE_PREFIX, isOocMessage, type CampaignMember } from "@/lib/campaign-types";
import { PlayerMessageBadge, PlayerMessageBody } from "@/app/campaigns/[campaignId]/PlayerMessageStyle";
import { HaltedTurnBanner } from "@/app/campaigns/[campaignId]/HaltedTurnBanner";
import { InlineMessageEditor } from "@/app/campaigns/[campaignId]/InlineMessageEditor";
import { stripToolText } from "@/lib/dm/tool-text";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import type { CampaignMessage } from "@/lib/db/messages";
import type { CampaignAsk } from "@/lib/db/asks";
import { AskChatEntry } from "@/app/campaigns/[campaignId]/AskPanel";
import type { StoredRoll } from "@/lib/db/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { D20Spinner } from "@/components/ui/D20Spinner";
import { RollCard } from "@/app/campaigns/[campaignId]/RollCard";
import { DM_STATUS_PHRASES_BY_LOCALE } from "@/app/campaigns/[campaignId]/dmStatusPhrases";
import { useI18n, type Locale } from "@/lib/i18n";
import { messageText } from "@/lib/i18n/message-text";
import { displaySystemText } from "@/lib/i18n/session-system-text";
import type {
  CampaignLocation,
  DmStatus,
  MediaStatus,
} from "@/app/campaigns/[campaignId]/useCampaignStream";

function formatElapsed(fromIso: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(fromIso)) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

// FNV-1a plus a murmur-style finalizer. The avalanche matters: a weaker mix
// leaves the six-entry pools reachable only at half their entries.
function hashString(value: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

// Flavor line shown while the DM works. Picked deterministically from the
// latest message id rather than with Math.random, so it stays put through the
// animate-pulse re-renders and survives hydration, while still varying from
// one turn to the next. Keyed on the id (not the message count, which the
// 200-message cap pins in long sessions) and salted with the status, so the
// beats within a single turn read differently too.
function dmStatusPhrase(status: DmStatus, turnKey: string, locale: Locale): string {
  if (status === "idle") {
    return "";
  }
  const pool = DM_STATUS_PHRASES_BY_LOCALE[locale][status];
  return pool[hashString(turnKey + status) % pool.length];
}

// Placeholder for media still on the render queue. The durable pending
// signal is the message's unanswered imageRequest, so this survives
// reloads; the ephemeral media_status refines the label.
export function MediaPlaceholder({
  label,
  status,
  fallbackStartedAt,
}: {
  label: string;
  status?: MediaStatus;
  fallbackStartedAt: string;
}) {
  const { locale } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  const failed = status?.state === "failed";
  useEffect(() => {
    if (failed) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [failed]);

  if (failed) {
    return (
      <p className="mt-3 flex items-center gap-1.5 text-xs text-stone-600">
        <ImageOff className="size-3.5" /> {messageText(locale, "Illustration failed; the story carries on.")}
      </p>
    );
  }
  return (
    <div className="mt-3 flex aspect-video max-h-56 w-full max-w-md flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-stone-800 bg-stone-950/40">
      <Loader2 className="size-5 animate-spin text-amber-700" />
      <p className="text-xs text-stone-400">
        {status?.state === "queued" ? messageText(locale, "Waiting for the render queue...") : label}
      </p>
      <p className="font-mono text-[11px] text-stone-600">
        {formatElapsed(status?.startedAt ?? fallbackStartedAt, now)}
      </p>
    </div>
  );
}

const ROLL_MARKER = /\[roll:([0-9a-f-]{36})\]/g;

type TimelineItem =
  | { kind: "message"; message: CampaignMessage; time: number }
  | { kind: "roll"; roll: StoredRoll; time: number }
  | { kind: "ask"; ask: CampaignAsk; time: number };
type StoryTimelineItem = Exclude<TimelineItem, { kind: "ask" }>;

function parsedTime(value: string): number {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER;
}

function referencedRollIds(messages: CampaignMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    for (const match of message.content.matchAll(ROLL_MARKER)) {
      ids.add(match[1]);
    }
  }
  return ids;
}

function compareStoryTimelineItems(left: StoryTimelineItem, right: StoryTimelineItem): number {
  const leftSeq = left.kind === "roll" ? left.roll.eventSeq : left.message.seq;
  const rightSeq = right.kind === "roll" ? right.roll.eventSeq : right.message.seq;
  if (leftSeq !== undefined && rightSeq !== undefined) return leftSeq - rightSeq;
  const byTime = left.time - right.time;
  if (byTime !== 0) return byTime;
  // Snapshot rolls have no event sequence. Keep them after the action that
  // caused them and before the DM passage that resolves that action.
  if (left.kind === "roll" && right.kind === "message") {
    return right.message.authorType === "player" ? 1 : -1;
  }
  if (left.kind === "message" && right.kind === "roll") {
    return left.message.authorType === "player" ? -1 : 1;
  }
  return 0;
}

function buildTimeline(messages: CampaignMessage[], rolls: StoredRoll[], asks: CampaignAsk[]): TimelineItem[] {
  const marked = referencedRollIds(messages);
  const storyTimeline: StoryTimelineItem[] = [
    ...messages.map((message) => ({ kind: "message" as const, message, time: parsedTime(message.createdAt) })),
    ...rolls
      .filter((roll) => !marked.has(roll.id))
      .map((roll) => ({ kind: "roll" as const, roll, time: parsedTime(roll.createdAt) })),
  ];
  const timeline: TimelineItem[] = storyTimeline.sort(compareStoryTimelineItems);
  // ponytail: insert at most 100 visible asks into the existing ordered feed; use an indexed merge if this cap grows.
  for (const ask of [...asks].sort((left, right) => parsedTime(left.answeredAt ?? left.createdAt) - parsedTime(right.answeredAt ?? right.createdAt))) {
    const item = { kind: "ask" as const, ask, time: parsedTime(ask.answeredAt ?? ask.createdAt) };
    const index = timeline.findIndex((entry) => entry.time > item.time);
    timeline.splice(index < 0 ? timeline.length : index, 0, item);
  }
  return timeline;
}

function DmContent({ content, rollsById, sheetsById }: {
  content: string;
  rollsById: Map<string, StoredRoll>;
  sheetsById: Map<string, CharacterSheet>;
}) {
  // Older messages may still carry leaked "[request_roll ...]" tool text;
  // never render it.
  const cleaned = stripToolText(content);
  const parts: Array<{ kind: "text"; text: string } | { kind: "roll"; roll: StoredRoll }> = [];
  let lastIndex = 0;
  for (const match of cleaned.matchAll(ROLL_MARKER)) {
    if (match.index! > lastIndex) {
      parts.push({ kind: "text", text: cleaned.slice(lastIndex, match.index) });
    }
    const roll = rollsById.get(match[1]);
    if (roll) {
      parts.push({ kind: "roll", roll });
    }
    lastIndex = match.index! + match[0].length;
  }
  if (lastIndex < cleaned.length) {
    parts.push({ kind: "text", text: cleaned.slice(lastIndex) });
  }

  return (
    <div className="narration space-y-2">
      {parts.map((part, index) =>
        part.kind === "text" ? (
          <p
            key={index}
            className="whitespace-pre-wrap text-pretty font-serif text-base leading-relaxed text-stone-100"
          >
            {part.text.trim()}
          </p>
        ) : (
          <RollCard
            key={index}
            roll={part.roll}
            characterName={
              part.roll.characterId
                ? sheetsById.get(part.roll.characterId)?.name
                : undefined
            }
          />
        ),
      )}
    </div>
  );
}

// One chat entry. Memoized so the per-token dm_delta re-renders of the list
// (dmDraft grows on every streamed token) skip the whole back-catalog; only
// props that actually changed re-render their row.
const MessageItem = memo(function MessageItem({
  message,
  campaignId,
  canRetryTurn,
  canIllustrate,
  rollsById,
  sheetsById,
  membersById,
  locationsById,
  sheets,
  mediaStatus,
  onPinCanon,
  onPinMemory,
  onEditSave,
  onLoreCheck,
  onRenarrate,
  onContinueScene,
  onSelectVariant,
  mine,
  blocked,
  onReport,
  isClosingMessage,
  onOpenClosingMessage,
}: {
  message: CampaignMessage;
  campaignId: string;
  canRetryTurn: boolean;
  // This row is the viewer's own message: nothing to report.
  mine: boolean;
  // The viewer blocked this message's author: the row folds away.
  blocked: boolean;
  // Flag a DM passage or another player's message to this server's admins.
  onReport?: (message: CampaignMessage) => void;
  // Whoever runs the story may put a picture of their own under a passage.
  canIllustrate: boolean;
  rollsById: Map<string, StoredRoll>;
  sheetsById: Map<string, CharacterSheet>;
  membersById: Map<string, CampaignMember>;
  locationsById: Map<string, CampaignLocation>;
  sheets: CharacterSheet[];
  mediaStatus: Record<string, MediaStatus>;
  onPinCanon?: (message: CampaignMessage) => void;
  // Pin the current selection (or the whole message) into every future prompt.
  onPinMemory?: (message: CampaignMessage) => void;
  // Lead-only correction of this narration's text. Resolves to an error
  // string when the server refuses (a dropped roll marker), or null on save.
  onEditSave?: (message: CampaignMessage, content: string) => Promise<string | null>;
  onLoreCheck?: (message: CampaignMessage) => void;
  // Reroll this narration's prose (lead only, latest DM message only).
  onRenarrate?: (message: CampaignMessage) => void;
  onContinueScene?: (message: CampaignMessage) => void;
  // Browse the rerolled takes; the picked one is what the table reads.
  onSelectVariant?: (message: CampaignMessage, index: number) => void;
  isClosingMessage?: boolean;
  onOpenClosingMessage?: () => void;
}) {
  const { locale } = useI18n();
  const ooc = isOocMessage(message);
  // Local to the row: only one narration is ever being corrected at a time,
  // and the draft should not survive the row unmounting.
  const [editing, setEditing] = useState(false);
  // An uploaded picture on its way to this passage. The image itself arrives
  // through image_ready like a rendered one, so this only drives the spinner.
  const [attaching, setAttaching] = useState(false);
  const pictureRef = useRef<HTMLInputElement>(null);

  async function attachPicture(file: File) {
    setAttaching(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("read failed"));
        reader.readAsDataURL(file);
      });
      const upload = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl, name: file.name, type: file.type }),
      });
      const uploaded = await upload.json().catch(() => ({}));
      if (!upload.ok) {
        window.alert(messageText(locale, "That image would not upload."));
        return;
      }
      const response = await fetch(
        `/api/campaigns/${campaignId}/dm/messages/${message.id}/image`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: uploaded.url }),
        },
      );
      if (!response.ok) {
        window.alert(messageText(locale, "Could not put that picture under the passage."));
      }
    } catch {
      window.alert(messageText(locale, "That image would not upload."));
    } finally {
      setAttaching(false);
    }
  }

  if (message.authorType === "system") {
    // A halted turn whose dm_turns row is still retryable. Both halves of the
    // test matter: the link is cleared once a retry is claimed, and the
    // prefix keeps any other turn-linked message out of this branch.
    if (message.dmTurnId && message.content.startsWith(DM_HALTED_PREFIX)) {
      return (
        <HaltedTurnBanner
          campaignId={campaignId}
          turnId={message.dmTurnId}
          content={message.content}
          canRetry={canRetryTurn}
        />
      );
    }
    if (message.content.startsWith(LEAD_NOTE_PREFIX)) {
      return (
        <div className="mx-auto max-w-xl rounded-lg border border-amber-900/60 bg-amber-950/30 px-4 py-2.5">
          <p className="mb-0.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-amber-300">
             <Crown className="size-3.5" /> {messageText(locale, "Party Lead")}
          </p>
          <p className="text-sm text-amber-100/90">
            {message.content.slice(LEAD_NOTE_PREFIX.length)}
          </p>
        </div>
      );
    }
    if (message.content.startsWith(JOIN_NOTE_PREFIX)) {
      return (
        <p className="mx-auto flex max-w-xl items-center justify-center gap-1.5 text-center font-serif text-sm italic text-stone-500">
          <UserPlus className="size-3.5 shrink-0" />
          {message.content.slice(JOIN_NOTE_PREFIX.length)}
        </p>
      );
    }
    return (
      <p className="mx-auto max-w-xl text-center font-serif text-sm italic text-stone-500">
         {displaySystemText(message.content, locale)}
      </p>
    );
  }
  if (message.authorType === "dm") {
    return (
      <div
        className={cn(
          "group animate-fade-up transition-all",
          isClosingMessage &&
            "rounded-2xl border-2 border-amber-500/50 bg-gradient-to-b from-amber-950/25 via-stone-900/40 to-transparent p-5 shadow-[0_0_35px_rgba(245,158,11,0.2)]",
        )}
      >
        <p className="eyebrow mb-2 flex items-center gap-2 text-[10px] text-amber-300/80">
          <span className="h-px w-8 bg-gradient-to-r from-transparent to-amber-500/60" />
          {isClosingMessage ? (
            <span className="flex items-center gap-1.5 font-bold text-amber-300">
              <Sparkles className="size-3.5 text-amber-400" />
              {messageText(locale, "DM's Closing Message · Adventure Finale")}
            </span>
          ) : (
            messageText(locale, "Dungeon Master")
          )}
          <span className="h-px flex-1 bg-gradient-to-r from-amber-500/40 to-transparent" />
          {isClosingMessage && onOpenClosingMessage ? (
            <button
              type="button"
              onClick={onOpenClosingMessage}
              className="inline-flex items-center gap-1 rounded-md border border-amber-500/50 bg-amber-950/70 px-2.5 py-1 text-[11px] font-semibold text-amber-100 shadow-[0_0_12px_rgba(245,158,11,0.3)] transition hover:bg-amber-900/80 hover:text-white"
            >
              <Sparkles className="size-3 text-amber-300" />
              {messageText(locale, "Salute & Finale")}
            </button>
          ) : null}
          {(() => {
            // Reroll takes: the counter only appears once a second one exists.
            const variants = message.variants ?? [];
            const index = message.variantIndex ?? 0;
            if (variants.length < 2 || !onSelectVariant) {
              return null;
            }
            return (
              <span className="flex items-center gap-0.5 font-mono text-[10px] normal-case tracking-normal text-stone-500">
                <button
                  type="button"
                  onClick={() => onSelectVariant(message, index - 1)}
                  disabled={index <= 0}
                  aria-label={messageText(locale, "Previous take")}
                  className={cn(ui.iconAction, "-my-1.5 p-1 disabled:opacity-30")}
                >
                  <ChevronLeft className="size-3.5" />
                </button>
                {index + 1} / {variants.length}
                <button
                  type="button"
                  onClick={() => onSelectVariant(message, index + 1)}
                  disabled={index >= variants.length - 1}
                  aria-label={messageText(locale, "Next take")}
                  className={cn(ui.iconAction, "-my-1.5 p-1 disabled:opacity-30")}
                >
                  <ChevronRight className="size-3.5" />
                </button>
              </span>
            );
          })()}
          {!ooc && onRenarrate ? (
            <button
              type="button"
              onClick={() => onRenarrate(message)}
              aria-label={messageText(locale, "Reroll this narration")}
              title={messageText(locale, "Reroll: have the DM write this moment again, with the same dice and outcome")}
              className={cn(ui.iconAction, "-my-1.5")}
            >
              <RefreshCw className="size-3.5" />
            </button>
          ) : null}
          {!ooc && onContinueScene ? (
            <button
              type="button"
              onClick={() => onContinueScene(message)}
              aria-label={messageText(locale, "Continue this scene")}
              title={messageText(locale, "Continue: have the DM keep writing from where this stopped, without moving the story on")}
              className={cn(ui.iconAction, "-my-1.5")}
            >
              <FastForward className="size-3.5" />
            </button>
          ) : null}
          {!ooc && onEditSave ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              aria-label={messageText(locale, "Edit this narration")}
              title={messageText(locale, "Edit: fix what the DM said. Mechanics are untouched, and every dice marker must survive")}
              className={cn(ui.iconAction, "-my-1.5")}
            >
              <Pencil className="size-3.5" />
            </button>
          ) : null}
          {!ooc && onPinMemory ? (
            <button
              type="button"
              onClick={() => onPinMemory(message)}
              aria-label={messageText(locale, "Pin this to the DM's memory")}
              title={messageText(locale, "Remember: keep your selected text (or this whole message) in front of the DM every turn")}
              className={cn(ui.iconAction, "-my-1.5")}
            >
              <Bookmark className="size-3.5" />
            </button>
          ) : null}
          {!ooc && onLoreCheck ? (
            <button
              type="button"
              onClick={() => onLoreCheck(message)}
              aria-label={messageText(locale, "Lore check this passage")}
              title={messageText(locale, "Lore check: flag this passage (or your selected text) against the campaign record")}
              className={cn(ui.iconAction, "-my-1.5")}
            >
              <ShieldQuestion className="size-3.5" />
            </button>
          ) : null}
          {!ooc && onPinCanon ? (
            <button
              type="button"
              onClick={() => onPinCanon(message)}
              aria-label={messageText(locale, "Pin this passage as canon")}
              title={messageText(locale, "Pin as canon: keep this passage (or your selected text) in front of the DM permanently")}
              className={cn(ui.iconAction, "-my-1.5")}
            >
              <Pin className="size-3.5" />
            </button>
          ) : null}
          {!ooc && canIllustrate ? (
            <>
              <input
                ref={pictureRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    void attachPicture(file);
                  }
                  event.target.value = "";
                }}
              />
              <button
                type="button"
                disabled={attaching}
                onClick={() => pictureRef.current?.click()}
                aria-label={message.generatedImage ? messageText(locale, "Replace the picture") : messageText(locale, "Add a picture")}
                title={
                  message.generatedImage
                    ? messageText(locale, "Replace picture: put an image of your own under this passage")
                    : messageText(locale, "Add a picture: put an image of your own under this passage")
                }
                className={cn(ui.iconAction, "-my-1.5")}
              >
                {attaching ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <ImagePlus className="size-3.5" />
                )}
              </button>
            </>
          ) : null}
          {!ooc && onReport ? (
            <button
              type="button"
              onClick={() => onReport(message)}
              aria-label={messageText(locale, "Report this passage")}
              title={messageText(locale, "Report: flag this passage to the admins of this server")}
              className={cn(ui.iconAction, "-my-1.5")}
            >
              <Flag className="size-3.5" />
            </button>
          ) : null}
        </p>
        {!ooc && editing && onEditSave ? (
          <InlineMessageEditor
            initial={message.content}
            onCancel={() => setEditing(false)}
            onSave={async (content) => {
              const failure = await onEditSave(message, content);
              if (!failure) {
                setEditing(false);
              }
              return failure;
            }}
          />
        ) : (
          <DmContent content={message.content} rollsById={rollsById} sheetsById={sheetsById} />
        )}
        {message.narrationAudioUrl ? (
          <audio className="mt-3 block w-full max-w-lg" controls preload="none" src={message.narrationAudioUrl} />
        ) : null}
        {message.generatedImage ? (
          <ImageLightbox
            src={message.generatedImage.url}
            alt={message.imageRequest?.prompt || messageText(locale, "Scene")}
            className="mt-3 max-h-96 rounded-xl border border-stone-800"
          />
        ) : message.imageRequest?.needed ? (
          <MediaPlaceholder
            label={messageText(locale, "Illustrating the scene...")}
            status={mediaStatus[message.id]}
            fallbackStartedAt={message.createdAt}
          />
        ) : null}
        {(() => {
          // The message that introduced an area shows its map inline.
          // The map lives on the location row, so lead redraws and
          // layout revisions refresh here automatically.
          const location = message.locationId
            ? locationsById.get(message.locationId)
            : undefined;
          if (!location) {
            return null;
          }
          if (location.mapImage) {
            return (
              <figure className="mt-3 max-w-md">
                <ImageLightbox
                  src={location.mapImage.url}
                  alt={messageText(locale, "Map of {name}", { name: location.name })}
                  caption={location.name}
                  className="max-h-96 rounded-xl border border-stone-800"
                />
                <figcaption className="mt-1 text-xs text-stone-500">
                  {location.name}
                </figcaption>
              </figure>
            );
          }
          return (
            <MediaPlaceholder
              label={messageText(locale, "Charting the area...")}
              status={mediaStatus[location.id]}
              fallbackStartedAt={message.createdAt}
            />
          );
        })()}
      </div>
    );
  }
  if (blocked) {
    return (
      <p className="ml-auto flex max-w-[92%] items-center justify-end gap-1.5 text-right text-xs italic text-stone-600 sm:max-w-2xl">
        <EyeOff className="size-3.5 shrink-0" />
        {messageText(locale, "A message from a player you blocked")}
      </p>
    );
  }
  // Older messages predate characterId, so fall back to the author's
  // sheet in this campaign before giving up on a character identity.
  const sheet =
    (message.characterId ? sheetsById.get(message.characterId) : undefined) ??
    (message.userId
      ? sheets.find((candidate) => candidate.userId === message.userId)
      : undefined);
  // Character portrait first, then the player's own avatar, then a stand-in:
  // the plate for the character's class or race, or the sigil the player's
  // id hashes to when there is no sheet to draw from.
  const portraitUrl =
    sheet?.portrait?.url ??
    (message.userId ? membersById.get(message.userId)?.avatar?.url : undefined) ??
    (sheet
      ? characterPlaceholder({ race: sheet.race, class: sheet.class, gender: sheet.gender })
      : message.userId
        ? avatarPlaceholder(message.userId)
        : undefined);
  return (
    <div className="group ml-auto max-w-[92%] animate-fade-up sm:max-w-2xl">
      <p className="mb-1 flex flex-wrap items-center justify-end gap-1.5 text-right text-xs font-medium text-amber-200/80">
        {portraitUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={portraitUrl}
            alt=""
            className="size-6 rounded-full border border-amber-500/30 object-cover"
          />
        ) : null}
        <PlayerMessageBadge content={message.content} locale={locale} />
        {sheet?.name ?? messageText(locale, "Player")}
        {onReport && !mine && message.userId ? (
          <button
            type="button"
            onClick={() => onReport(message)}
            aria-label={messageText(locale, "Report this message")}
            title={messageText(locale, "Report: flag this message to the admins of this server, or block the player")}
            className={cn(ui.iconAction, "-my-1.5 opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100")}
          >
            <Flag className="size-3.5" />
          </button>
        ) : null}
      </p>
      <PlayerMessageBody content={message.content} />
    </div>
  );
});

export function MessageList({
  messages,
  asks = [],
  hasOlderMessages = false,
  onLoadOlder,
  campaignId,
  canRetryTurn = false,
  canIllustrate = false,
  rolls,
  sheets,
  members = [],
  locations = [],
  dmStatus,
  dmDraft,
  mediaStatus = {},
  onPinCanon,
  onPinMemory,
  onEditSave,
  onLoreCheck,
  onRenarrate,
  onContinueScene,
  onSelectVariant,
  meUserId = "",
  blockedUserIds = [],
  onReport,
  campaignStatus,
  onOpenClosingMessage,
}: {
  messages: CampaignMessage[];
  asks?: CampaignAsk[];
  hasOlderMessages?: boolean;
  onLoadOlder?: () => Promise<boolean>;
  campaignId: string;
  meUserId?: string;
  // Players the viewer has blocked; their rows fold away.
  blockedUserIds?: string[];
  onReport?: (message: CampaignMessage) => void;
  // The party lead may send a halted DM turn back in. Plain booleans and
  // strings rather than a callback: the memoized rows stay cheap without the
  // stable-identity dance the callback props above need.
  canRetryTurn?: boolean;
  // Same shape and same reason: whoever runs the story may upload a picture
  // under any DM passage.
  canIllustrate?: boolean;
  rolls: StoredRoll[];
  sheets: CharacterSheet[];
  members?: CampaignMember[];
  locations?: CampaignLocation[];
  dmStatus: DmStatus;
  dmDraft: string;
  mediaStatus?: Record<string, MediaStatus>;
  onPinCanon?: (message: CampaignMessage) => void;
  // Pin the current selection (or the whole message) into every future prompt.
  onPinMemory?: (message: CampaignMessage) => void;
  onEditSave?: (message: CampaignMessage, content: string) => Promise<string | null>;
  onLoreCheck?: (message: CampaignMessage) => void;
  onRenarrate?: (message: CampaignMessage) => void;
  onContinueScene?: (message: CampaignMessage) => void;
  onSelectVariant?: (message: CampaignMessage, index: number) => void;
  campaignStatus?: string;
  onOpenClosingMessage?: () => void;
}) {
  const { locale } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const anchorRef = useRef<{ firstSeq: number; height: number; top: number } | null>(null);
  const loadingOlderRef = useRef(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const statusPhrase = dmStatusPhrase(dmStatus, messages[messages.length - 1]?.id ?? "", locale);
  const rollsById = useMemo(() => new Map(rolls.map((roll) => [roll.id, roll])), [rolls]);
  const timeline = useMemo(() => buildTimeline(messages, rolls, asks), [messages, rolls, asks]);
  const closingDmMessageId = useMemo(() => {
    if (campaignStatus !== "ended") return "";
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].authorType === "dm") {
        return messages[index].id;
      }
    }
    return "";
  }, [messages, campaignStatus]);
  const sheetsById = useMemo(
    () => new Map(sheets.map((sheet) => [sheet.id, sheet])),
    [sheets],
  );
  const membersById = useMemo(
    () => new Map(members.map((member) => [member.userId, member])),
    [members],
  );
  const locationsById = useMemo(
    () => new Map(locations.map((location) => [location.id, location])),
    [locations],
  );
  const blockedSet = useMemo(() => new Set(blockedUserIds), [blockedUserIds]);
  const pinRef = useRef(onPinCanon);
  useEffect(() => {
    pinRef.current = onPinCanon;
  });
  const hasPin = Boolean(onPinCanon);
  const stablePin = useMemo(
    () => (hasPin ? (message: CampaignMessage) => pinRef.current?.(message) : undefined),
    [hasPin],
  );
  const loreRef = useRef(onLoreCheck);
  useEffect(() => {
    loreRef.current = onLoreCheck;
  });
  const hasLore = Boolean(onLoreCheck);
  const stableLore = useMemo(
    () => (hasLore ? (message: CampaignMessage) => loreRef.current?.(message) : undefined),
    [hasLore],
  );
  const renarrateRef = useRef(onRenarrate);
  useEffect(() => {
    renarrateRef.current = onRenarrate;
  });
  const continueRef = useRef(onContinueScene);
  useEffect(() => {
    continueRef.current = onContinueScene;
  });
  const hasContinue = Boolean(onContinueScene);
  const stableContinue = useMemo(
    () =>
      hasContinue ? (message: CampaignMessage) => continueRef.current?.(message) : undefined,
    [hasContinue],
  );
  const pinMemoryRef = useRef(onPinMemory);
  useEffect(() => {
    pinMemoryRef.current = onPinMemory;
  });
  const hasPinMemory = Boolean(onPinMemory);
  const stablePinMemory = useMemo(
    () =>
      hasPinMemory ? (message: CampaignMessage) => pinMemoryRef.current?.(message) : undefined,
    [hasPinMemory],
  );
  const hasRenarrate = Boolean(onRenarrate);
  const stableRenarrate = useMemo(
    () =>
      hasRenarrate ? (message: CampaignMessage) => renarrateRef.current?.(message) : undefined,
    [hasRenarrate],
  );
  const selectVariantRef = useRef(onSelectVariant);
  useEffect(() => {
    selectVariantRef.current = onSelectVariant;
  });
  const hasSelectVariant = Boolean(onSelectVariant);
  const stableSelectVariant = useMemo(
    () =>
      hasSelectVariant
        ? (message: CampaignMessage, index: number) =>
            selectVariantRef.current?.(message, index)
        : undefined,
    [hasSelectVariant],
  );
  // Only the newest DM message can be rerolled; the server enforces the same
  // rule, this just keeps the button off every older passage.
  const latestDmMessageId = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].authorType === "dm") {
        return messages[index].id;
      }
    }
    return "";
  }, [messages]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const anchor = anchorRef.current;
    if (anchor && messages[0]?.seq !== anchor.firstSeq) {
      el.scrollTop = anchor.top + el.scrollHeight - anchor.height;
      anchorRef.current = null;
    } else if (nearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, rolls, asks, dmDraft, dmStatus]);

  async function loadOlder() {
    const el = containerRef.current;
    if (!el || !onLoadOlder || loadingOlderRef.current || !hasOlderMessages) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    nearBottomRef.current = false;
    anchorRef.current = { firstSeq: messages[0]?.seq ?? 0, height: el.scrollHeight, top: el.scrollTop };
    if (!await onLoadOlder()) anchorRef.current = null;
    loadingOlderRef.current = false;
    setLoadingOlder(false);
  }

  function handleScroll() {
    const el = containerRef.current;
    if (el) {
      nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
      if (el.scrollTop < 80) void loadOlder();
    }
  }

  return (
    <div ref={containerRef} onScroll={handleScroll} data-testid="campaign-messages" className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-8 px-4 py-6 sm:px-6">
      {hasOlderMessages ? <button type="button" className={ui.btnSmall} disabled={loadingOlder}
        onClick={() => void loadOlder()}>{messageText(locale, "Load older messages")}</button> : null}
      {timeline.map((item) => {
        if (item.kind === "roll") {
          return (
            <div key={`roll-${item.roll.id}`} className="pl-2 sm:pl-8">
              <RollCard
                roll={item.roll}
                standalone
                characterName={item.roll.characterId ? sheetsById.get(item.roll.characterId)?.name : undefined}
              />
            </div>
          );
        }
        if (item.kind === "ask") {
          const askerName = item.ask.characterId
            ? sheetsById.get(item.ask.characterId)?.name
            : undefined;
          return <AskChatEntry key={`ask-${item.ask.id}`} ask={item.ask}
            askerName={askerName ?? membersById.get(item.ask.userId)?.username ?? (locale === "ru" ? "Игрок" : "Player")} />;
        }
        const message = item.message;
        return (
          <MessageItem
            key={message.id}
            mine={Boolean(message.userId) && message.userId === meUserId}
            blocked={Boolean(message.userId && blockedSet.has(message.userId))}
            onReport={onReport}
            message={message}
            campaignId={campaignId}
            canRetryTurn={canRetryTurn}
            canIllustrate={canIllustrate}
            rollsById={rollsById}
            sheetsById={sheetsById}
            membersById={membersById}
            locationsById={locationsById}
            sheets={sheets}
            mediaStatus={mediaStatus}
            onPinCanon={stablePin}
            onLoreCheck={stableLore}
            onPinMemory={stablePinMemory}
            onEditSave={onEditSave}
            onRenarrate={
              // No turn link, no reroll: messages narrated before this feature
              // shipped have no stored conversation to replay.
              message.id === latestDmMessageId && message.dmTurnId
                ? stableRenarrate
                : undefined
            }
            onContinueScene={
              // Same gate as a reroll: only the newest narration, and only when
              // a stored turn conversation exists to continue from.
              message.id === latestDmMessageId && message.dmTurnId
                ? stableContinue
                : undefined
            }
            onSelectVariant={stableSelectVariant}
            isClosingMessage={message.id === closingDmMessageId}
            onOpenClosingMessage={onOpenClosingMessage}
          />
        );
      })}

      {dmDraft ? (
        <div>
          <p className="eyebrow mb-2 flex items-center gap-2 text-[10px] text-amber-300/80">
            <span className="h-px w-8 bg-gradient-to-r from-transparent to-amber-500/60" />
            {messageText(locale, "Dungeon Master")}
            <span className="h-px flex-1 bg-gradient-to-r from-amber-500/40 to-transparent" />
          </p>
          <p className="whitespace-pre-wrap text-pretty font-serif text-base leading-relaxed text-stone-100">
            {dmDraft}
          </p>
        </div>
      ) : dmStatus !== "idle" ? (
        <p className="flex items-center gap-2 font-serif text-base italic text-stone-500">
          <D20Spinner className="size-5 shrink-0 text-amber-600" />
          <span className="animate-pulse">{statusPhrase}</span>
        </p>
      ) : null}

      </div>
    </div>
  );
}
