"use client";

import {
  BookMarked,
  Check,
  Eye,
  EyeOff,
  Loader2,
  Pencil,
  Pin,
  PinOff,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import type { WorldFact } from "@/lib/db/facts";
import { FACT_CATEGORIES, type FactCategory } from "@/lib/dm/fact-logic";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";

// The world-state fact sheet: server-tracked canon extracted at chapter
// close (plus manual pins). Everyone sees party-known facts; the lead can
// pin, edit, retire, add facts, and peek at DM-only secrets.

function categoryLabels(locale: Parameters<typeof localeText>[0]): Record<FactCategory, string> {
  return localeText(locale, {
    en: { location: "Places", npc: "People", promise: "Promises & debts", world: "World state", party: "The party", lore: "Lore & rules" },
    ru: { location: "Места", npc: "Персонажи", promise: "Обещания и долги", world: "Состояние мира", party: "Группа", lore: "Знания и правила" },
  });
}

function FactCard({
  campaignId,
  fact,
  steersStory,
  refresh,
}: {
  campaignId: string;
  fact: WorldFact;
  steersStory: boolean;
  refresh: () => Promise<void>;
}) {
  const { locale } = useI18n();
  const labels = categoryLabels(locale);
  const copy = localeText(locale, {
    en: { save: "Save", cancel: "Cancel", secret: "DM secret", unpin: "Unpin", pin: "Pin: always kept in front of the DM, never auto-replaced", edit: "Edit", retire: "Retire: the DM stops treating this as true" },
    ru: { save: "Сохранить", cancel: "Отмена", secret: "Секрет мастера", unpin: "Открепить", pin: "Закрепить: всегда показывать мастеру, никогда не заменять автоматически", edit: "Редактировать", retire: "Отправить в архив: мастер перестанет считать это правдой" },
  });
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(fact.fact);
  const [busy, setBusy] = useState(false);

  async function patch(payload: Record<string, unknown>) {
    setBusy(true);
    try {
      await fetch(`/api/campaigns/${campaignId}/facts`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ factId: fact.id, ...payload }),
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-lg border border-stone-800 bg-stone-950/40 p-2.5">
      {editing ? (
        <div className="space-y-1.5">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={2}
            maxLength={300}
            className="w-full rounded border border-stone-700 bg-stone-900 px-2 py-1 text-[11px] leading-4 outline-none focus:border-amber-600"
          />
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={busy || !text.trim()}
              onClick={async () => {
                await patch({ fact: text.trim() });
                setEditing(false);
              }}
              className="flex items-center gap-1 rounded border border-stone-700 px-2 py-0.5 text-[11px] text-stone-300 hover:bg-stone-900 disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
              {copy.save}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setText(fact.fact);
              }}
              className="flex items-center gap-1 rounded border border-stone-700 px-2 py-0.5 text-[11px] text-stone-500 hover:bg-stone-900"
            >
              <X className="size-3" /> {copy.cancel}
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-[11px] leading-4 text-stone-300">
            {fact.pinned ? <Pin className="mr-1 inline size-3 text-amber-400" /> : null}
            {fact.subject ? (
              <span className="font-medium text-amber-200">{fact.subject}: </span>
            ) : null}
            {fact.fact}
          </p>
          <div className="mt-1.5 flex items-center gap-2 text-[10px] text-stone-600">
            <span>
              {fact.knownBy === "dm" ? copy.secret : labels[fact.category]}
            </span>
            {steersStory ? (
              <span className="ml-auto flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => patch({ pinned: !fact.pinned })}
                  title={
                    fact.pinned
                      ? copy.unpin : copy.pin
                  }
                  className="text-stone-500 hover:text-amber-300"
                >
                  {fact.pinned ? <PinOff className="size-3" /> : <Pin className="size-3" />}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  title={copy.edit}
                  className="text-stone-500 hover:text-stone-300"
                >
                  <Pencil className="size-3" />
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => patch({ status: "retired" })}
                  title={copy.retire}
                  className="text-stone-500 hover:text-red-400"
                >
                  <Trash2 className="size-3" />
                </button>
              </span>
            ) : null}
          </div>
        </>
      )}
    </li>
  );
}

function FactComposer({
  campaignId,
  refresh,
}: {
  campaignId: string;
  refresh: () => Promise<void>;
}) {
  const { locale } = useI18n();
  const labels = categoryLabels(locale);
  const copy = localeText(locale, {
    en: { saveFailed: "Could not save the fact.", reachFailed: "Could not reach the server.", subject: "Subject (who or what it is about)", fact: "One sentence the DM must never contradict", pin: "Pin fact" },
    ru: { saveFailed: "Не удалось сохранить факт.", reachFailed: "Не удалось связаться с сервером.", subject: "Тема (о ком или о чём это)", fact: "Одно предложение, которому мастер никогда не должен противоречить", pin: "Закрепить факт" },
  });
  const [category, setCategory] = useState<FactCategory>("world");
  const [subject, setSubject] = useState("");
  const [fact, setFact] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!fact.trim() || busy) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/facts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, subject: subject.trim(), fact: fact.trim() }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || copy.saveFailed);
        return;
      }
      setSubject("");
      setFact("");
      await refresh();
    } catch {
      setError(copy.reachFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-dashed border-stone-800 p-2.5">
      <div className="mb-1.5 flex flex-wrap gap-1">
        {FACT_CATEGORIES.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setCategory(value)}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px]",
              category === value
                ? "border-amber-700 bg-amber-950/40 text-amber-200"
                : "border-stone-800 text-stone-500 hover:text-stone-300",
            )}
          >
            {labels[value]}
          </button>
        ))}
      </div>
      <input
        value={subject}
        onChange={(event) => setSubject(event.target.value)}
        maxLength={80}
        placeholder={copy.subject}
        className="mb-1.5 w-full rounded border border-stone-700 bg-stone-900 px-2 py-1 text-xs outline-none focus:border-amber-600"
      />
      <textarea
        value={fact}
        onChange={(event) => setFact(event.target.value)}
        rows={2}
        maxLength={300}
        placeholder={copy.fact}
        className="w-full rounded border border-stone-700 bg-stone-900 px-2 py-1 text-[11px] leading-4 outline-none focus:border-amber-600"
      />
      {error ? <p className="mt-1 text-[10px] text-red-400">{error}</p> : null}
      <button
        type="button"
        onClick={submit}
        disabled={busy || !fact.trim()}
        className="mt-1.5 flex w-full items-center justify-center gap-1 rounded border border-stone-700 py-1 text-[11px] text-stone-400 hover:bg-stone-900 disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-3 animate-spin" /> : <BookMarked className="size-3" />}
        {copy.pin}
      </button>
    </div>
  );
}

export function FactsPanel({
  campaignId,
  facts,
  steersStory,
  refreshFacts,
}: {
  campaignId: string;
  facts: WorldFact[];
  steersStory: boolean;
  refreshFacts: () => Promise<void>;
}) {
  const { locale } = useI18n();
  const labels = categoryLabels(locale);
  const copy = localeText(locale, {
    en: { pinned: "Pinned", empty: "Nothing recorded yet. The DM writes durable facts here as chapters close", pinYourself: ", or pin one yourself above", hideSecrets: "Hide DM secrets", showSecrets: "Show DM secrets (spoilers)", noSecrets: "No DM secrets recorded." },
    ru: { pinned: "Закреплённое", empty: "Пока ничего не записано. Мастер добавляет сюда устойчивые факты после завершения глав", pinYourself: ", или закрепите факт сами выше", hideSecrets: "Скрыть секреты мастера", showSecrets: "Показать секреты мастера (спойлеры)", noSecrets: "Секретов мастера пока нет." },
  });
  // Lead-only peek at DM secrets: fetched separately so the spoilers never
  // sit in shared state, and merged in only while the toggle is on.
  const [secrets, setSecrets] = useState<WorldFact[] | null>(null);

  async function toggleSecrets() {
    if (secrets) {
      setSecrets(null);
      return;
    }
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/facts?secrets=1`);
      if (response.ok) {
        const data = await response.json();
        setSecrets(
          ((data.facts ?? []) as WorldFact[]).filter((fact) => fact.knownBy === "dm"),
        );
      }
    } catch {
      // transient; the button retries
    }
  }

  const refresh = async () => {
    await refreshFacts();
    if (secrets) {
      setSecrets(null);
      await toggleSecrets();
    }
  };

  const pinned = facts.filter((fact) => fact.pinned);
  const section = "px-1 text-[10px] font-medium uppercase tracking-wide text-stone-500";

  return (
    <div className="space-y-3">
      {steersStory ? <FactComposer campaignId={campaignId} refresh={refresh} /> : null}

      {pinned.length ? (
        <div className="space-y-1.5">
          <h3 className={cn(section, "text-amber-400")}>{copy.pinned}</h3>
          <ul className="space-y-1.5">
            {pinned.map((fact) => (
              <FactCard
                key={fact.id}
                campaignId={campaignId}
                fact={fact}
                steersStory={steersStory}
                refresh={refresh}
              />
            ))}
          </ul>
        </div>
      ) : null}

      {FACT_CATEGORIES.map((category) => {
        const entries = facts.filter((fact) => fact.category === category && !fact.pinned);
        if (!entries.length) {
          return null;
        }
        return (
          <div key={category} className="space-y-1.5">
            <h3 className={section}>{labels[category]}</h3>
            <ul className="space-y-1.5">
              {entries.map((fact) => (
                <FactCard
                  key={fact.id}
                  campaignId={campaignId}
                  fact={fact}
                  steersStory={steersStory}
                  refresh={refresh}
                />
              ))}
            </ul>
          </div>
        );
      })}

      {!facts.length ? (
        <p className="px-1 text-[11px] text-stone-600">
          {copy.empty}{steersStory ? copy.pinYourself : ""}.
        </p>
      ) : null}

      {steersStory ? (
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={toggleSecrets}
            className="flex items-center gap-1 px-1 text-[10px] font-medium uppercase tracking-wide text-stone-500 hover:text-amber-300"
          >
            {secrets ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
            {secrets ? copy.hideSecrets : copy.showSecrets}
          </button>
          {secrets ? (
            secrets.length ? (
              <ul className="space-y-1.5">
                {secrets.map((fact) => (
                  <FactCard
                    key={fact.id}
                    campaignId={campaignId}
                    fact={fact}
                    steersStory={steersStory}
                    refresh={refresh}
                  />
                ))}
              </ul>
            ) : (
              <p className="px-1 text-[11px] text-stone-600">{copy.noSecrets}</p>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
