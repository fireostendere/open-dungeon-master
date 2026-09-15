"use client";

import { ChevronDown, Loader2, MessageCircleQuestion, Send, Users } from "lucide-react";
import { memo, useCallback, useState } from "react";
import type { FormEvent } from "react";
import { cn } from "@/lib/cn";
import { Tooltip } from "@/components/ui/Tooltip";
import type { CampaignAsk } from "@/lib/db/asks";
import type { AskScope, AskVisibility } from "@/lib/dm/ask-logic";
import { useI18n } from "@/lib/i18n";
import { ui } from "@/lib/ui";

const COPY = {
  en: {
    scopes: { story: "Story", rules: "Rules", sheet: "Sheet" },
    pickerScopes: { auto: "Auto", story: "Story", rules: "Rules", sheet: "My sheet" },
    sharedMine: "Shared with the table",
    sharedOther: "Asked by the table",
    onlyYou: "Only you",
    answerFailedOne: "The DM could not answer this one.",
    fromRecord: "From the record",
    answerFailed: "The DM could not answer.",
    serverFailed: "Could not reach the server.",
    title: "Ask the DM",
    explainer:
      "Questions about the story, the world, the rules, or your sheet. Answers come from what the campaign has on record and never move the story forward.",
    loading: "Loading...",
    empty: "Nothing asked yet. Put a question to the DM below.",
    checking: "Checking the record (queued behind the DM)...",
    about: "About",
    seenBy: "Seen by",
    privateTip: "Only you see the question and the answer.",
    tableTip: "The whole table sees the question and the answer.",
    justMe: "Just me",
    table: "The table",
    noStoryMove: "The story does not move.",
    placeholder: "Ask the DM about the story, the world, the rules, or your sheet",
    ask: "Ask",
  },
  ru: {
    scopes: { story: "Сюжет", rules: "Правила", sheet: "Лист" },
    pickerScopes: { auto: "Авто", story: "Сюжет", rules: "Правила", sheet: "Мой лист" },
    sharedMine: "Открыто для всего стола",
    sharedOther: "Вопрос от стола",
    onlyYou: "Только вам",
    answerFailedOne: "Мастер не смог ответить на этот вопрос.",
    fromRecord: "Из записей",
    answerFailed: "Мастер не смог ответить.",
    serverFailed: "Не удалось связаться с сервером.",
    title: "Спросить Мастера",
    explainer:
      "Вопросы о сюжете, мире, правилах или вашем листе. Ответы опираются на сведения кампании и никогда не продвигают сюжет.",
    loading: "Загрузка...",
    empty: "Вопросов пока нет. Задайте вопрос Мастеру ниже.",
    checking: "Проверяем записи (в очереди за Мастером)...",
    about: "О чём",
    seenBy: "Кому видно",
    privateTip: "Вопрос и ответ видите только вы.",
    tableTip: "Вопрос и ответ видит весь стол.",
    justMe: "Только мне",
    table: "Всему столу",
    noStoryMove: "Сюжет не продвигается.",
    placeholder: "Спросите Мастера о сюжете, мире, правилах или своём листе",
    ask: "Спросить",
  },
  pl: {
    scopes: { story: "Fabuła", rules: "Zasady", sheet: "Karta" },
    pickerScopes: { auto: "Auto", story: "Fabuła", rules: "Zasady", sheet: "Moja karta" },
    sharedMine: "Udostępniono całemu stołowi",
    sharedOther: "Pytanie od stołu",
    onlyYou: "Tylko ty",
    answerFailedOne: "Mistrz Gry nie mógł odpowiedzieć na to pytanie.",
    fromRecord: "Z zapisu",
    answerFailed: "Mistrz Gry nie mógł odpowiedzieć.",
    serverFailed: "Nie udało się połączyć z serwerem.",
    title: "Zapytaj Mistrza Gry",
    explainer:
      "Pytania o fabułę, świat, zasady lub twoją kartę. Odpowiedzi opierają się na zapisie kampanii i nigdy nie przesuwają fabuły do przodu.",
    loading: "Ładowanie...",
    empty: "Nie zadano jeszcze żadnego pytania. Zadaj pytanie Mistrzowi Gry poniżej.",
    checking: "Sprawdzanie zapisu (w kolejce za Mistrzem Gry)...",
    about: "O czym",
    seenBy: "Widoczne dla",
    privateTip: "Tylko ty widzisz pytanie i odpowiedź.",
    tableTip: "Cały stół widzi pytanie i odpowiedź.",
    justMe: "Tylko ja",
    table: "Cały stół",
    noStoryMove: "Fabuła się nie przesuwa.",
    placeholder: "Zapytaj Mistrza Gry o fabułę, świat, zasady lub swoją kartę",
    ask: "Zapytaj",
  },
} as const;

// The Ask thread: out-of-character questions to the DM and their grounded
// answers. Framed hard as an aside, because the one thing a player must
// never wonder is whether asking moved the story.
//
// This strip is the ONLY Ask surface in the app. It owns the whole feature,
// question box included. Ask used to be a composer mode as well, which meant
// the table was offered the same thing twice, inches apart in the same
// column; the composer no longer knows Ask exists and "ask" is no longer an
// InputKind (src/lib/campaign-types.ts). Anything that adds a second entry
// point is a regression.
//
// It is still an aside and never a transcript entry: an ask writes no
// campaign_messages row and no dm_turns row (src/lib/dm/ask.ts), and nothing
// here is rendered into MessageList.

function AskEntry({ ask, meUserId }: { ask: CampaignAsk; meUserId: string }) {
  const { locale } = useI18n();
  const copy = COPY[locale];
  const mine = ask.userId === meUserId;
  return (
    <li className="rounded-lg border border-stone-800 bg-stone-950/40 p-2.5">
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[10px] uppercase tracking-wide text-stone-500">
        <span className="rounded bg-stone-800 px-1 text-stone-400">
          {copy.scopes[ask.scope as keyof typeof copy.scopes] ?? ask.scope}
        </span>
        {ask.visibility === "table" ? (
          <span className="inline-flex items-center gap-1 text-stone-500">
            <Users className="size-3" /> {mine ? copy.sharedMine : copy.sharedOther}
          </span>
        ) : (
          <span className="text-stone-600">{copy.onlyYou}</span>
        )}
      </div>
      <p className="mb-1.5 text-xs font-medium leading-5 text-stone-200">{ask.question}</p>
      {ask.status === "failed" ? (
        <p className="text-xs italic text-red-400">{copy.answerFailedOne}</p>
      ) : (
        <p className="whitespace-pre-wrap font-serif text-xs leading-5 text-stone-300">
          {ask.answer}
        </p>
      )}
      {ask.citations.length ? (
        <div className="mt-2 space-y-1">
          <p className="text-[10px] font-medium uppercase tracking-wide text-stone-600">
            {copy.fromRecord}
          </p>
          {ask.citations.map((citation, index) => (
            <p
              key={index}
              className="rounded border border-stone-800/80 bg-stone-950/60 p-1.5 text-[11px] leading-4 text-stone-500"
            >
              <span className="mr-1 rounded bg-stone-800 px-1 text-[9px] uppercase text-stone-500">
                {citation.kind}
                {citation.ref ? ` ${citation.ref}` : ""}
              </span>
              {citation.quote}
            </p>
          ))}
        </div>
      ) : null}
    </li>
  );
}

function AskDockInner({
  campaignId,
  asks,
  meUserId,
  loaded,
  open,
  onOpenChange,
  onAsked,
}: {
  campaignId: string;
  asks: CampaignAsk[];
  meUserId: string;
  loaded: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAsked: () => Promise<void>;
}) {
  const { locale } = useI18n();
  const copy = COPY[locale];
  const [question, setQuestion] = useState("");
  const [scope, setScope] = useState<AskScope | "auto">("auto");
  const [visibility, setVisibility] = useState<AskVisibility>("private");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState("");

  const submit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const text = question.trim();
      if (!text || sending) {
        return;
      }
      setSending(true);
      setError("");
      setPendingQuestion(text);
      try {
        const response = await fetch(`/api/campaigns/${campaignId}/ask`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: text, scope, visibility }),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          setError(data.error || copy.answerFailed);
          return;
        }
        setQuestion("");
        await onAsked();
      } catch {
        setError(copy.serverFailed);
      } finally {
        setSending(false);
        setPendingQuestion("");
      }
    },
    [campaignId, copy.answerFailed, copy.serverFailed, question, scope, sending, visibility, onAsked],
  );

  const answered = asks.length;
  return (
    <div className="border-t border-stone-900">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        data-tour="ask-dm"
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-[11px] text-stone-500 transition-colors hover:text-stone-300"
      >
        <MessageCircleQuestion className="size-3.5 text-amber-300/70" />
        <span>{copy.title}</span>
        {answered ? <span className="text-stone-600">({answered})</span> : null}
        {pendingQuestion && !open ? <Loader2 className="size-3 animate-spin text-stone-500" /> : null}
        <ChevronDown className={cn("ml-auto size-3.5 transition-transform", open ? "" : "-rotate-90")} />
      </button>

      <div className={cn("max-h-[28rem] flex-col", open ? "flex" : "hidden")}>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-1">
          <p className="pb-2 text-[11px] leading-4 text-stone-500">{copy.explainer}</p>
          {!loaded ? (
            <p className="flex items-center gap-2 text-xs text-stone-500">
              <Loader2 className="size-3.5 animate-spin" /> {copy.loading}
            </p>
          ) : !asks.length && !pendingQuestion ? (
            <p className="text-xs leading-5 text-stone-600">{copy.empty}</p>
          ) : (
            <ul className="space-y-2">
              {asks.map((ask) => (
                <AskEntry key={ask.id} ask={ask} meUserId={meUserId} />
              ))}
              {pendingQuestion ? (
                <li className="rounded-lg border border-stone-800 bg-stone-950/40 p-2.5 opacity-70">
                  <p className="mb-1.5 text-xs font-medium leading-5 text-stone-200">
                    {pendingQuestion}
                  </p>
                  <p className="flex items-center gap-2 text-xs text-stone-500">
                    <Loader2 className="size-3.5 animate-spin" />
                    {copy.checking}
                  </p>
                </li>
              ) : null}
            </ul>
          )}
        </div>

        <form onSubmit={submit} className="border-t border-stone-800 px-3 py-2.5">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-stone-500">
            <span>{copy.about}</span>
            {(["auto", "story", "rules", "sheet"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setScope(option)}
                className={cn(
                  "rounded-full border px-2 py-1 transition-colors sm:py-0.5",
                  scope === option
                    ? "border-amber-700 bg-amber-950/40 text-amber-200"
                    : "border-stone-700 text-stone-400 hover:text-stone-200",
                )}
              >
                {copy.pickerScopes[option]}
              </button>
            ))}
            <span className="ml-2">{copy.seenBy}</span>
            {(["private", "table"] as const).map((option) => (
              <Tooltip key={option} content={option === "private" ? copy.privateTip : copy.tableTip}>
                <button
                  type="button"
                  onClick={() => setVisibility(option)}
                  className={cn(
                    "rounded-full border px-2 py-1 transition-colors sm:py-0.5",
                    visibility === option
                      ? "border-amber-700 bg-amber-950/40 text-amber-200"
                      : "border-stone-700 text-stone-400 hover:text-stone-200",
                  )}
                >
                  {option === "private" ? copy.justMe : copy.table}
                </button>
              </Tooltip>
            ))}
            <span className="ml-auto italic text-stone-600">{copy.noStoryMove}</span>
          </div>
          <div className="flex items-end gap-2">
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submit(event);
                }
              }}
              rows={2}
              placeholder={copy.placeholder}
              className={cn(ui.input, "resize-none text-xs leading-5")}
            />
            <button
              type="submit"
              disabled={!question.trim() || sending}
              className={cn(ui.btnSmall, "shrink-0 px-2 py-1 text-[11px]")}
            >
              {sending ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
              {copy.ask}
            </button>
          </div>
          {error ? <p className="mt-1.5 text-[11px] text-red-400">{error}</p> : null}
        </form>
      </div>
    </div>
  );
}

export const AskDock = memo(AskDockInner);
