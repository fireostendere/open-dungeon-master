"use client";

import { EyeOff, MessageCircleQuestion, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { Tooltip } from "@/components/ui/Tooltip";
import type { CampaignAsk } from "@/lib/db/asks";
import type { AskScope, AskVisibility } from "@/lib/dm/ask-logic";
import { useI18n } from "@/lib/i18n";

const COPY = {
  en: {
    scopes: { story: "Story", rules: "Rules", sheet: "Sheet" },
    pickerScopes: { auto: "Auto", story: "Story", rules: "Rules", sheet: "My sheet" },
    tableVisible: "Visible to the table",
    onlyYou: "Only you",
    checking: "Checking the record…",
    answerFailed: "The DM could not answer this one.",
    answer: "DM's answer",
    fromRecord: "From the record",
    about: "About",
    seenBy: "Seen by",
    privateTip: "Only you see the question and the answer.",
    tableTip: "The whole table sees the question and the answer.",
    justMe: "Just me",
    table: "The table",
  },
  ru: {
    scopes: { story: "Сюжет", rules: "Правила", sheet: "Лист" },
    pickerScopes: { auto: "Авто", story: "Сюжет", rules: "Правила", sheet: "Мой лист" },
    tableVisible: "Видно всему столу",
    onlyYou: "Только вам",
    checking: "Мастер проверяет записи…",
    answerFailed: "Мастер не смог ответить на этот вопрос.",
    answer: "Ответ Мастера",
    fromRecord: "Из записей",
    about: "О чём",
    seenBy: "Кому видно",
    privateTip: "Вопрос и ответ видите только вы.",
    tableTip: "Вопрос и ответ видит весь стол.",
    justMe: "Только мне",
    table: "Всему столу",
  },
} as const;

export function AskChatEntry({ ask, askerName }: { ask: CampaignAsk; askerName: string }) {
  const { locale } = useI18n();
  const copy = COPY[locale];
  return (
    <article className="mx-auto max-w-xl rounded-xl border border-amber-900/40 bg-stone-950/50 p-3">
      <header className="mb-2 flex flex-wrap items-center gap-1.5 text-[10px] uppercase tracking-wide text-stone-500">
        <MessageCircleQuestion className="size-3.5 text-amber-300/70" />
        <span>{askerName}</span>
        <span className="rounded bg-stone-800 px-1 text-stone-400">
          {copy.scopes[ask.scope]}
        </span>
        {ask.visibility === "table" ? (
          <span className="inline-flex items-center gap-1">
            <Users className="size-3" /> {copy.tableVisible}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-stone-600">
            <EyeOff className="size-3" /> {copy.onlyYou}
          </span>
        )}
      </header>
      <p className="whitespace-pre-wrap text-sm leading-5 text-stone-200">{ask.question}</p>
      {ask.status === "pending" ? (
        <p className="mt-2 text-xs italic text-stone-500">{copy.checking}</p>
      ) : ask.status === "failed" ? (
        <p className="mt-2 text-xs italic text-red-400">{copy.answerFailed}</p>
      ) : (
        <div className="mt-2 border-l border-amber-700/50 pl-2.5">
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-amber-300/70">{copy.answer}</p>
          <p className="whitespace-pre-wrap font-serif text-sm leading-5 text-stone-300">{ask.answer}</p>
        </div>
      )}
      {ask.citations.length ? (
        <div className="mt-2 space-y-1">
          <p className="text-[10px] font-medium uppercase tracking-wide text-stone-600">{copy.fromRecord}</p>
          {ask.citations.map((citation, index) => (
            <p key={index} className="rounded border border-stone-800/80 bg-stone-950/60 p-1.5 text-[11px] leading-4 text-stone-500">
              <span className="mr-1 rounded bg-stone-800 px-1 text-[9px] uppercase text-stone-500">
                {citation.kind}{citation.ref ? ` ${citation.ref}` : ""}
              </span>
              {citation.quote}
            </p>
          ))}
        </div>
      ) : null}
    </article>
  );
}

export function AskOptions({
  scope,
  onScopeChange,
  visibility,
  onVisibilityChange,
}: {
  scope: AskScope | "auto";
  onScopeChange: (scope: AskScope | "auto") => void;
  visibility: AskVisibility;
  onVisibilityChange: (visibility: AskVisibility) => void;
}) {
  const { locale } = useI18n();
  const copy = COPY[locale];
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-stone-500">
      <span>{copy.about}</span>
      {(["auto", "story", "rules", "sheet"] as const).map((option) => (
        <button key={option} type="button" aria-pressed={scope === option} onClick={() => onScopeChange(option)}
          className={cn("rounded-full border px-2 py-1 transition-colors sm:py-0.5", scope === option
            ? "border-amber-700 bg-amber-950/40 text-amber-200"
            : "border-stone-700 text-stone-400 hover:text-stone-200")}>
          {copy.pickerScopes[option]}
        </button>
      ))}
      <span className="ml-1">{copy.seenBy}</span>
      {(["private", "table"] as const).map((option) => (
        <Tooltip key={option} content={option === "private" ? copy.privateTip : copy.tableTip}>
          <button type="button" aria-pressed={visibility === option} onClick={() => onVisibilityChange(option)}
            className={cn("rounded-full border px-2 py-1 transition-colors sm:py-0.5", visibility === option
              ? "border-amber-700 bg-amber-950/40 text-amber-200"
              : "border-stone-700 text-stone-400 hover:text-stone-200")}>
            {option === "private" ? copy.justMe : copy.table}
          </button>
        </Tooltip>
      ))}
    </div>
  );
}
