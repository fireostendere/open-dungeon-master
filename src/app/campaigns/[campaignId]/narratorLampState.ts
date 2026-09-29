import type { NarratorPresence } from "@/lib/dm/narrator-presence";
import type { Locale } from "@/lib/i18n";
import type { DmStatus } from "./useCampaignStream";

// The header lamp: whether the narrator is on the line and what it is doing.
// Pure (type-only imports) so scripts/test-narrator-lamp.mjs can load it
// without React; NarratorLamp.tsx only renders what this returns.

export type NarratorLampTone = "offline" | "online" | "busy";
export type NarratorLampState = "offline" | "online" | Exclude<DmStatus, "idle">;
export type NarratorLamp = {
  state: NarratorLampState;
  tone: NarratorLampTone;
  pulse: boolean;
  // On the line at all, whatever it is doing right now.
  online: boolean;
  // When the doorbell last came or went (server ms); null when unknown or
  // when being online does not come from the doorbell.
  since: number | null;
};

export const OFFLINE_PRESENCE: NarratorPresence = { online: false, since: null };

/** The snapshot field and the narrator_presence payload, defensively parsed. */
export function narratorPresenceFrom(value: unknown): NarratorPresence {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const since = typeof record.since === "number" && Number.isFinite(record.since) && record.since >= 0 ? record.since : null;
  return { online: record.online === true, since };
}

export function narratorLamp({
  presence,
  dmStatus,
  serverNarrator = false,
  dmSeatOnline = false,
}: {
  presence: NarratorPresence;
  dmStatus: DmStatus;
  // The server's own runtime narrates (AI mode or an active AI cover): it is
  // on the line whenever the server is, doorbell or not.
  serverNarrator?: boolean;
  // A person in the DM seat has the table open in the web app.
  dmSeatOnline?: boolean;
}): NarratorLamp {
  const doorbell = presence.online;
  const online = doorbell || serverNarrator || dmSeatOnline;
  // `since` dates the doorbell's own transitions only.
  const since = doorbell || !online ? presence.since : null;
  // Activity wins even without a doorbell: a server-side narrator reports it too.
  if (dmStatus !== "idle") return { state: dmStatus, tone: "busy", pulse: true, online, since };
  return online
    ? { state: "online", tone: "online", pulse: false, online, since }
    : { state: "offline", tone: "offline", pulse: false, online, since };
}

const COPY = {
  en: {
    offline: "DM offline",
    online: "DM online",
    thinking: "DM is thinking…",
    rolling: "Rolling dice…",
    narrating: "Writing…",
    awaiting_rolls: "Waiting for rolls",
    writing_chapter: "Writing a chapter…",
    plotting_arc: "Plotting the story…",
    offlineDetail: "Your turns are saved and will be handled when the DM is back.",
    offlineSince: "Offline since {time}.",
    onlineDetail: "Waiting for your turns.",
    onlineSince: "Waiting for your turns, online since {time}.",
    busyDetail: "The DM is working on the table's turn.",
    busySince: "Online since {time}.",
  },
  ru: {
    offline: "Мастер не на связи",
    online: "Мастер на связи",
    thinking: "Мастер думает…",
    rolling: "Бросает кости…",
    narrating: "Пишет…",
    awaiting_rolls: "Ждёт бросков",
    writing_chapter: "Пишет главу…",
    plotting_arc: "Строит сюжет…",
    offlineDetail: "Ходы сохраняются: мастер обработает их, когда вернётся.",
    offlineSince: "Не на связи с {time}.",
    onlineDetail: "Ждёт ходов.",
    onlineSince: "Ждёт ходов, на связи с {time}.",
    busyDetail: "Мастер работает над ходом стола.",
    busySince: "На связи с {time}.",
  },
} satisfies Record<Locale, Record<string, string>>;

/** HH:MM today, otherwise the date too. `timeZone` exists for tests. */
export function formatLampTime(at: number, now: number, locale: Locale, timeZone?: string): string {
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(at);
  const day = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone });
  if (day.format(at) === day.format(now)) return time;
  const date = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone }).format(at);
  return `${date}, ${time}`;
}

/** Visible label, the tooltip explanation, and both as one spoken sentence. */
export function narratorLampText(
  lamp: NarratorLamp,
  locale: Locale,
  now: number,
  timeZone?: string,
): { label: string; detail: string; summary: string } {
  const copy = COPY[locale];
  const time = lamp.since === null ? null : formatLampTime(lamp.since, now, locale, timeZone);
  const at = (template: string) => template.replace("{time}", time ?? "");
  let detail: string;
  if (lamp.tone === "offline") detail = time ? `${copy.offlineDetail} ${at(copy.offlineSince)}` : copy.offlineDetail;
  else if (lamp.tone === "online") detail = time ? at(copy.onlineSince) : copy.onlineDetail;
  else detail = lamp.online && time ? `${copy.busyDetail} ${at(copy.busySince)}` : copy.busyDetail;
  const label = copy[lamp.state];
  // "Пишет…" already ends a sentence; "Мастер на связи" needs its full stop.
  const summary = /[.…!?]$/.test(label) ? `${label} ${detail}` : `${label}. ${detail}`;
  return { label, detail, summary };
}
