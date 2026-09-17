"use client";

import { MessageSquare, Swords, Users } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { parsePlayerMessage, type PlayerMessageKind } from "@/lib/player-message";

const LABELS: Record<Locale, Record<PlayerMessageKind, string>> = {
  ru: { say: "Речь", do: "Действие", ooc: "Вне игры" },
  en: { say: "Say", do: "Action", ooc: "OOC" },
  pl: { say: "Mowa", do: "Akcja", ooc: "Poza grą" },
};

export function PlayerMessageBadge({ content, locale }: { content: string; locale: Locale }) {
  const { kind } = parsePlayerMessage(content);
  const Icon = kind === "say" ? MessageSquare : kind === "do" ? Swords : Users;
  const tone = kind === "say" ? "border-sky-700/40 bg-sky-950/40 text-sky-300" :
    kind === "do" ? "border-amber-700/40 bg-amber-950/30 text-amber-300" :
      "border-stone-600/40 bg-stone-900/50 text-stone-400";
  return (
    <span data-message-kind={kind} className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${tone}`}>
      <Icon aria-hidden="true" className="size-3" />{LABELS[locale][kind]}
    </span>
  );
}

export function PlayerMessageBody({ content }: { content: string }) {
  const { kind, text } = parsePlayerMessage(content);
  if (kind === "say") return (
    <div data-message-kind="say" className="rounded-2xl rounded-tr-md border border-sky-700/40 bg-sky-950/30 px-4 py-3 text-sm leading-6 text-sky-100 shadow-elev-1">
      <p className="whitespace-pre-wrap break-words text-pretty"><span aria-hidden="true" className="mr-1 text-lg text-sky-400/70">“</span>{text}<span aria-hidden="true" className="ml-1 text-lg text-sky-400/70">”</span></p>
    </div>
  );
  if (kind === "ooc") return (
    <div data-message-kind="ooc" className="rounded-xl border border-dashed border-stone-600/50 bg-stone-900/30 px-4 py-2.5 text-sm italic leading-6 text-stone-400">
      <p className="whitespace-pre-wrap break-words text-pretty">{text}</p>
    </div>
  );
  return (
    <div data-message-kind="do" className="rounded-xl border border-stone-700/40 border-l-4 border-l-amber-500/60 bg-stone-900/60 px-4 py-3 text-sm italic leading-6 text-stone-200 shadow-elev-1">
      <p className="whitespace-pre-wrap break-words text-pretty"><span aria-hidden="true" className="mr-2 text-amber-500/70">✦</span>{text}</p>
    </div>
  );
}
