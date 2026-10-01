"use client";

import { ArrowLeft, Bell, BellOff, Loader2, Plus, Send } from "lucide-react";
import { GameIcon } from "@/components/ui/GameIcon";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { setChimeMuted, useChimeMuted } from "@/app/campaigns/[campaignId]/useChatChime";
import type { CampaignMember } from "@/lib/campaign-types";
import type { SideMessage, SideThread } from "@/lib/db/side-chat";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";

// Private table talk: 1:1 whispers and group side chats. Content lives only
// in the side-chat API; the shared campaign stream carries just a contentless
// "something happened" ping (side_activity), which is what triggers the
// refreshes here. The AI DM never sees any of it.
export function SideChatPanel({
  campaignId,
  members,
  meUserId,
  threads,
  refreshSideChat,
  openThreadRequest,
  onOpenHandled,
}: {
  campaignId: string;
  members: CampaignMember[];
  meUserId: string;
  threads: SideThread[];
  refreshSideChat: () => Promise<void>;
  // Set by "Message" on a party card: open (creating if needed) the 1:1
  // thread with this user.
  openThreadRequest: string | null;
  onOpenHandled: () => void;
}) {
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: { chats: "Private chats", new: "New", muted: "Chime muted. Click to play a chime when a private message arrives.", chime: "The chime plays when a private message arrives. Click to mute.", privacy: "Only the people in a chat can read it. The Dungeon Master never sees these.", empty: "No side chats yet. Whisper a party member from their card, or start one here.", openFailed: "Could not open the chat.", reachFailed: "Could not reach the server.", someone: "someone" },
    ru: { chats: "Личные чаты", new: "Новый", muted: "Звук выключен. Нажмите, чтобы слышать сигнал при новом личном сообщении.", chime: "Сигнал звучит при новом личном сообщении. Нажмите, чтобы выключить.", privacy: "Чат видят только его участники. Мастер его не видит.", empty: "Личных чатов ещё нет. Напишите члену группы с его карточки или начните чат здесь.", openFailed: "Не удалось открыть чат.", reachFailed: "Не удалось связаться с сервером.", someone: "кто-то" },
  });
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const chimeMuted = useChimeMuted();

  const openThread = threads.find((thread) => thread.id === openThreadId) ?? null;

  const openDmWith = useCallback(
    async (userId: string) => {
      setError("");
      try {
        const response = await fetch(`/api/campaigns/${campaignId}/side-chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "dm", memberUserIds: [userId] }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          setError(data.error || copy.openFailed);
          return;
        }
        await refreshSideChat();
        setOpenThreadId(data.thread.id);
      } catch {
        setError(copy.reachFailed);
      }
    },
    [campaignId, copy, refreshSideChat],
  );

  useEffect(() => {
    if (!openThreadRequest) {
      return;
    }
    // Deferred so the state updates in openDmWith/onOpenHandled don't run
    // synchronously inside the effect body.
    const timer = setTimeout(() => {
      void openDmWith(openThreadRequest).then(onOpenHandled);
    }, 0);
    return () => clearTimeout(timer);
  }, [openThreadRequest, onOpenHandled, openDmWith]);

  const nameOf = useCallback(
    (userId: string) => members.find((member) => member.userId === userId)?.username ?? copy.someone,
    [copy.someone, members],
  );

  function threadLabel(thread: SideThread): string {
    if (thread.kind === "dm") {
      const other = thread.memberUserIds.find((id) => id !== meUserId);
      return nameOf(other ?? "");
    }
    return thread.title || thread.memberUserIds.map(nameOf).join(", ");
  }

  if (openThread) {
    return (
      <ThreadView
        campaignId={campaignId}
        thread={openThread}
        label={threadLabel(openThread)}
        members={members}
        meUserId={meUserId}
        refreshSideChat={refreshSideChat}
        onBack={() => setOpenThreadId(null)}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wide text-stone-500">
          {copy.chats}
        </h3>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setChimeMuted(!chimeMuted)}
            className={ui.btnSmall}
            title={
              chimeMuted
                ? copy.muted : copy.chime
            }
          >
            {chimeMuted ? <BellOff className="size-3.5" /> : <Bell className="size-3.5" />}
          </button>
          <button type="button" onClick={() => setCreating(true)} className={ui.btnSmall}>
            <Plus className="size-3.5" /> {copy.new}
          </button>
        </div>
      </div>
      <p className="text-[11px] leading-4 text-stone-600">
        {copy.privacy}
      </p>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      {threads.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <GameIcon icon={{ kind: "glyph", key: "tab-chat" }} size="size-10" className="opacity-60 grayscale" />
          <p className="text-xs text-stone-600">
            {copy.empty}
          </p>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {threads.map((thread) => (
            <li key={thread.id}>
              <button
                type="button"
                onClick={() => setOpenThreadId(thread.id)}
                className="flex w-full items-center gap-2 rounded-lg border border-stone-800 bg-stone-950/40 px-3 py-2 text-left transition-colors hover:border-amber-500/40"
              >
                <GameIcon icon={{ kind: "glyph", key: thread.kind === "dm" ? "tab-chat" : "tab-party" }} size="size-6" />
                <span className="min-w-0 flex-1 truncate text-sm text-stone-200">
                  {threadLabel(thread)}
                </span>
                {thread.unread > 0 ? (
                  <span className="rounded-full bg-gradient-to-b from-amber-300 to-amber-500 px-1.5 text-[10px] font-semibold text-amber-950 shadow-glow-gold">
                    {thread.unread}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}

      {creating ? (
        <NewChatForm
          campaignId={campaignId}
          members={members.filter((member) => member.userId !== meUserId)}
          onCreated={async (threadId) => {
            setCreating(false);
            await refreshSideChat();
            setOpenThreadId(threadId);
          }}
          onCancel={() => setCreating(false)}
        />
      ) : null}
    </div>
  );
}

function NewChatForm({
  campaignId,
  members,
  onCreated,
  onCancel,
}: {
  campaignId: string;
  members: CampaignMember[];
  onCreated: (threadId: string) => Promise<void>;
  onCancel: () => void;
}) {
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: { pick: "Pick at least one member.", createFailed: "Could not create the chat.", reachFailed: "Could not reach the server.", who: "Who's in it?", group: "Group name (optional)", cancel: "Cancel", start: "Start chat" },
    ru: { pick: "Выберите хотя бы одного участника.", createFailed: "Не удалось создать чат.", reachFailed: "Не удалось связаться с сервером.", who: "Кто участвует?", group: "Название группы (необязательно)", cancel: "Отмена", start: "Начать чат" },
  });
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    if (selected.length === 0) {
      setError(copy.pick);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/side-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: selected.length === 1 ? "dm" : "group",
          memberUserIds: selected,
          title: selected.length > 1 ? title.trim() : "",
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || copy.createFailed);
        return;
      }
      await onCreated(data.thread.id);
    } catch {
      setError(copy.reachFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-stone-800 bg-stone-950/40 p-3">
      <p className="mb-2 text-xs font-medium text-stone-400">{copy.who}</p>
      <ul className="space-y-1">
        {members.map((member) => (
          <li key={member.userId}>
            <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm text-stone-300 hover:bg-stone-900/60">
              <input
                type="checkbox"
                checked={selected.includes(member.userId)}
                onChange={(event) =>
                  setSelected((current) =>
                    event.target.checked
                      ? [...current, member.userId]
                      : current.filter((id) => id !== member.userId),
                  )
                }
                className="size-3.5 accent-amber-400"
              />
              {member.username}
            </label>
          </li>
        ))}
      </ul>
      {selected.length > 1 ? (
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={80}
          placeholder={copy.group}
          className={cn(ui.input, "mt-2 text-sm")}
        />
      ) : null}
      {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="text-xs text-stone-500 hover:text-stone-300">
          {copy.cancel}
        </button>
        <button type="button" onClick={create} disabled={busy} className={ui.btnSmall}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : null} {copy.start}
        </button>
      </div>
    </div>
  );
}

function ThreadView({
  campaignId,
  thread,
  label,
  members,
  meUserId,
  refreshSideChat,
  onBack,
}: {
  campaignId: string;
  thread: SideThread;
  label: string;
  members: CampaignMember[];
  meUserId: string;
  refreshSideChat: () => Promise<void>;
  onBack: () => void;
}) {
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: { all: "All chats", sendFailed: "Could not send.", reachFailed: "Could not reach the server.", someone: "someone", message: "Message" },
    ru: { all: "Все чаты", sendFailed: "Не удалось отправить.", reachFailed: "Не удалось связаться с сервером.", someone: "кто-то", message: "Сообщение" },
  });
  const [messages, setMessages] = useState<SideMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastSeqRef = useRef(0);

  const markRead = useCallback(
    async (seq: number) => {
      if (seq <= 0) return;
      await fetch(`/api/campaigns/${campaignId}/side-chat/${thread.id}/read`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lastSeq: seq }),
      }).catch(() => undefined);
      void refreshSideChat();
    },
    [campaignId, thread.id, refreshSideChat],
  );

  const load = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/campaigns/${campaignId}/side-chat/${thread.id}/messages?afterSeq=${lastSeqRef.current}`,
      );
      if (!response.ok) return;
      const data = await response.json();
      const fresh = (data.messages ?? []) as SideMessage[];
      if (fresh.length > 0) {
        setMessages((current) => {
          const known = new Set(current.map((message) => message.id));
          return [...current, ...fresh.filter((message) => !known.has(message.id))];
        });
        const maxSeq = fresh[fresh.length - 1].seq;
        lastSeqRef.current = Math.max(lastSeqRef.current, maxSeq);
        void markRead(maxSeq);
      }
    } catch {
      // transient; next side_activity retries
    }
  }, [campaignId, thread.id, markRead]);

  // Initial load, then incremental loads whenever activity bumps the
  // thread's lastSeq past what we have.
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (thread.lastSeq > lastSeqRef.current) {
      void load();
    }
  }, [thread.lastSeq, load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  async function send(event: FormEvent) {
    event.preventDefault();
    const content = input.trim();
    if (!content) return;
    setSending(true);
    setError("");
    try {
      const response = await fetch(
        `/api/campaigns/${campaignId}/side-chat/${thread.id}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || copy.sendFailed);
        return;
      }
      setInput("");
      const message = data.message as SideMessage;
      setMessages((current) => [...current, message]);
      lastSeqRef.current = Math.max(lastSeqRef.current, message.seq);
    } catch {
      setError(copy.reachFailed);
    } finally {
      setSending(false);
    }
  }

  const nameOf = (userId: string) =>
    members.find((member) => member.userId === userId)?.username ?? copy.someone;

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          title={copy.all}
          className="rounded p-1 text-stone-500 hover:bg-stone-900 hover:text-stone-300"
        >
          <ArrowLeft className="size-4" />
        </button>
        <GameIcon icon={{ kind: "glyph", key: thread.kind === "dm" ? "tab-chat" : "tab-party" }} size="size-6" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-stone-200">{label}</span>
      </div>
      {thread.kind === "group" ? (
        <p className="mb-2 truncate text-[11px] text-stone-600">
          {thread.memberUserIds.map(nameOf).join(", ")}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {messages.map((message) => {
          const mine = message.authorUserId === meUserId;
          return (
            <div key={message.id} className={cn("flex", mine && "justify-end")}>
              <div
                className={cn(
                  "max-w-[85%] rounded-lg px-2.5 py-1.5 text-sm",
                  mine
                    ? "bg-amber-400/10 text-amber-100"
                    : "bg-stone-900/70 text-stone-200",
                )}
              >
                {!mine ? (
                  <p className="text-[10px] font-medium text-stone-500">
                    {nameOf(message.authorUserId)}
                  </p>
                ) : null}
                <p className="whitespace-pre-wrap break-words">{message.content}</p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={send} className="mt-2">
        <div className="flex items-end gap-1.5 rounded-lg border border-stone-700/70 bg-stone-950/80 p-1.5">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            rows={1}
            maxLength={2000}
            placeholder={`${copy.message} ${label}`}
            className="flex-1 resize-none bg-transparent px-1.5 py-1 text-sm text-stone-200 outline-none"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="rounded-lg bg-gradient-to-b from-amber-100 via-amber-200 to-amber-400 p-2 text-amber-950 transition-all duration-150 ease-snap active:scale-95 disabled:opacity-40"
          >
            {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
          </button>
        </div>
        {error ? <p className="mt-1 text-xs text-red-400">{error}</p> : null}
      </form>
    </div>
  );
}
