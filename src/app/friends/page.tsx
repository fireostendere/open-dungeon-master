"use client";

import { Check, HeartHandshake, Loader2, UserRound, X } from "lucide-react";
import { GameIcon } from "@/components/ui/GameIcon";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { IconChip, PIXEL_ICONS, ui } from "@/lib/ui";
import { PageLoading, PageNotice, PageSection, PageShell } from "@/components/PageShell";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";

// The server's social circle: accounts are per-server, so these are the
// people at this table's door, not a global roster. Online means their
// notification stream is open somewhere on the server.

type FriendItem = {
  userId: string;
  username: string;
  avatar: { url: string } | null;
  since: string;
  online?: boolean;
};

type FriendsData = {
  friends: FriendItem[];
  incoming: FriendItem[];
  outgoing: FriendItem[];
};

type CampaignOption = {
  id: string;
  title: string;
};

type Note = { text: string; error: boolean };

function Avatar({ friend }: { friend: FriendItem }) {
  return friend.avatar ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={friend.avatar.url}
      alt=""
      className="size-9 shrink-0 rounded-full border border-amber-500/30 object-cover"
    />
  ) : (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-stone-700/60 bg-stone-900">
      <UserRound className="size-4 text-stone-500" />
    </span>
  );
}

// Rows inside a section card share one divider rhythm instead of nesting
// a card per person.
const ROW = "flex flex-wrap items-center gap-3 px-5 py-3";

export default function FriendsPage() {
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: { login: "Log in", loginSuffix: "to see your friends on this server.", title: "Friends", blurb: "People on this server; invite them to your campaigns.", addFriend: "Add a friend", placeholder: "Add by exact username", username: "Username", add: "Add", requests: "Requests for you", waitingOnYou: "Waiting on you", sent: "Sent requests", waiting: "Waiting", cancel: "Cancel", unfriend: "Unfriend", online: "Online now", invite: "Invite to campaign...", inviteFriend: "Invite {name} to a campaign", remove: "Remove {name} from your friends?", inviteSent: "Invite sent.", error: "Something went wrong." },
    ru: { login: "Войдите", loginSuffix: "чтобы увидеть друзей на этом сервере.", title: "Друзья", blurb: "Люди на этом сервере; приглашайте их в свои кампании.", addFriend: "Добавить друга", placeholder: "Точное имя пользователя", username: "Имя пользователя", add: "Добавить", requests: "Входящие запросы", waitingOnYou: "Ожидают вас", sent: "Отправленные запросы", waiting: "Ожидание", cancel: "Отменить", unfriend: "Удалить из друзей", online: "Сейчас в сети", invite: "Пригласить в кампанию...", inviteFriend: "Пригласить {name} в кампанию", remove: "Удалить {name} из друзей?", inviteSent: "Приглашение отправлено.", error: "Что-то пошло не так." },
  });
  const [data, setData] = useState<FriendsData>({ friends: [], incoming: [], outgoing: [] });
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(true);
  const [name, setName] = useState("");
  const [sending, setSending] = useState(false);
  // The add form's outcome ("Request sent." or an error) and per-person
  // outcomes (invite sent, decline failed), each shown next to what caused
  // them rather than in one shared banner.
  const [addNote, setAddNote] = useState<Note | null>(null);
  const [rowNotes, setRowNotes] = useState<Record<string, Note>>({});

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/friends");
      if (response.status === 401) {
        setAuthed(false);
        return;
      }
      if (response.ok) {
        setData(await response.json());
      }
    } catch {
      // Offline; the next poll retries.
    }
  }, []);

  useEffect(() => {
    // Deferred a tick, bell-style: load sets state, and state changes must
    // not launch synchronously from an effect body.
    const first = setTimeout(() => {
      void load().finally(() => setLoading(false));
    }, 0);
    // Online dots go stale as people come and go; refresh on the bell's
    // cadence, cheap enough to not matter.
    const timer = setInterval(() => void load(), 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  useEffect(() => {
    fetch("/api/campaigns")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (payload?.campaigns) {
          setCampaigns(
            payload.campaigns.map((campaign: CampaignOption) => ({
              id: campaign.id,
              title: campaign.title,
            })),
          );
        }
      })
      .catch(() => undefined);
  }, []);

  function setRowNote(userId: string, text: string, error: boolean) {
    setRowNotes((current) => ({ ...current, [userId]: { text, error } }));
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || sending) {
      return;
    }
    setSending(true);
    setAddNote(null);
    try {
      const response = await fetch("/api/friends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: name.trim() }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setAddNote({ text: payload.error ?? copy.error, error: true });
        return;
      }
      setAddNote({ text: payload.message ?? "Request sent.", error: false });
      setName("");
      void load();
    } finally {
      setSending(false);
    }
  }

  async function respond(userId: string, accept: boolean) {
    const response = await fetch("/api/friends/respond", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, accept }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setRowNote(userId, payload.error ?? copy.error, true);
      return;
    }
    void load();
  }

  async function unfriend(friend: FriendItem) {
    if (!window.confirm(copy.remove.replace("{name}", friend.username))) {
      return;
    }
    const response = await fetch("/api/friends", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: friend.userId }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setRowNote(friend.userId, payload.error ?? copy.error, true);
      return;
    }
    void load();
  }

  async function invite(userId: string, campaignId: string) {
    const response = await fetch("/api/friends/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ friendUserId: userId, campaignId }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setRowNote(userId, payload.error ?? copy.error, true);
      return;
    }
    setRowNote(userId, copy.inviteSent, false);
  }

  if (!authed) {
    return (
      <PageNotice>
        <Link href="/" className="text-amber-200 hover:text-amber-400">
          {copy.login}
        </Link>{" "}
        {copy.loginSuffix}
      </PageNotice>
    );
  }

  if (loading) {
    return <PageLoading />;
  }

  return (
    <PageShell
      icon={PIXEL_ICONS.chats}
      glyph="tab-friends"
      title={copy.title}
      blurb={copy.blurb}
    >
      <PageSection heading={copy.addFriend} glyph="tab-friends">
        <form onSubmit={add} className="flex gap-2">
          <span className="relative min-w-0 flex-1">
            <GameIcon icon={{ kind: "glyph", key: "tab-characters" }} size="size-7" className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2" />
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={copy.placeholder}
              maxLength={64}
              aria-label={copy.username}
              className={cn(ui.input, "pl-10")}
            />
          </span>
          <button type="submit" disabled={sending || !name.trim()} className={ui.btnPrimary}>
            {sending ? <Loader2 className="size-4 animate-spin" /> : null} {copy.add}
          </button>
        </form>
        {addNote ? (
          <p className={cn("mt-2 text-sm", addNote.error ? "text-red-400" : "text-emerald-300")}>
            {addNote.text}
          </p>
        ) : null}
      </PageSection>

      {data.incoming.length > 0 ? (
        <PageSection heading={copy.requests} glyph="cue-bell" ribbon={copy.waitingOnYou} padded={false}>
          <ul className="divide-y divide-stone-800/70">
            {data.incoming.map((request) => (
              <li key={request.userId} className={ROW}>
                <Avatar friend={request} />
                <span className="min-w-0 flex-1 truncate font-medium text-stone-100">
                  {request.username}
                </span>
                {rowNotes[request.userId] ? (
                  <span className="text-xs text-red-400">{rowNotes[request.userId].text}</span>
                ) : null}
                <button
                  type="button"
                  onClick={() => respond(request.userId, true)}
                  className={ui.btnSmall}
                >
                  <Check className="size-4 text-emerald-300" /> {locale === "ru" ? "Принять" : "Accept"}
                </button>
                <button
                  type="button"
                  onClick={() => respond(request.userId, false)}
                  className={ui.btnSmall}
                >
                  <X className="size-4 text-red-400" /> {locale === "ru" ? "Отклонить" : "Decline"}
                </button>
              </li>
            ))}
          </ul>
        </PageSection>
      ) : null}

      <PageSection heading={copy.title} glyph="tab-party" padded={data.friends.length === 0}>
        {data.friends.length === 0 ? (
          <div className="flex flex-col items-center gap-4 px-6 py-8 text-center">
            <IconChip icon={HeartHandshake} size="size-12" iconSize="size-5" />
            <div className="max-w-sm">
              <p className="text-balance font-serif text-2xl text-stone-200">
                {locale === "ru" ? "Пока нет друзей вне вашей партии." : "No party outside the party yet."}
              </p>
              <p className="mt-2 text-pretty text-sm text-stone-500">
                {locale === "ru" ? "Добавьте человека по точному имени на этом сервере." : "Add someone by their exact username on this server."}
              </p>
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-stone-800/70 pb-2">
            {data.friends.map((friend) => (
              <li key={friend.userId} className="px-5 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Avatar friend={friend} />
                  <span className="flex min-w-0 flex-1 items-center gap-1.5">
                    <span className="truncate font-medium text-stone-100">{friend.username}</span>
                    {friend.online ? (
                      <span
                        title={copy.online}
                        className="size-2 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.7)]"
                      />
                    ) : null}
                  </span>
                  {campaigns.length > 0 ? (
                    <select
                      value=""
                      onChange={(event) => {
                        if (event.target.value) {
                          void invite(friend.userId, event.target.value);
                        }
                      }}
                      aria-label={copy.inviteFriend.replace("{name}", friend.username)}
                      className={cn(ui.input, "w-auto max-w-40 py-1.5 text-stone-300")}
                    >
                      <option value="">{copy.invite}</option>
                      {campaigns.map((campaign) => (
                        <option key={campaign.id} value={campaign.id}>
                          {campaign.title}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  <button type="button" onClick={() => unfriend(friend)} className={ui.btnSmall}>
                    <X className="size-4 text-red-400" /> {copy.unfriend}
                  </button>
                </div>
                {rowNotes[friend.userId] ? (
                  <p
                    className={cn(
                      "mt-1.5 pl-12 text-xs",
                      rowNotes[friend.userId].error ? "text-red-400" : "text-emerald-300",
                    )}
                  >
                    {rowNotes[friend.userId].text}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </PageSection>

      {data.outgoing.length > 0 ? (
        <PageSection heading={copy.sent} glyph="tab-handout" padded={false}>
          <ul className="divide-y divide-stone-800/70 pb-2">
            {data.outgoing.map((request) => (
              <li key={request.userId} className={ROW}>
                <Avatar friend={request} />
                <span className="min-w-0 flex-1 truncate text-stone-300">{request.username}</span>
                <span className="inline-flex items-center gap-1 text-xs text-stone-500">
                  <GameIcon icon={{ kind: "glyph", key: "rest-short" }} size="size-5" /> {copy.waiting}
                </span>
                <button
                  type="button"
                  onClick={() => respond(request.userId, false)}
                  className={ui.btnSmall}
                >
                  <X className="size-4" /> {copy.cancel}
                </button>
              </li>
            ))}
          </ul>
        </PageSection>
      ) : null}
    </PageShell>
  );
}
