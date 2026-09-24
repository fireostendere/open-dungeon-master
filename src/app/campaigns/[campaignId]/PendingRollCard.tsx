"use client";

import { useInlineText } from "@/lib/i18n/inline-text";
import { Dices, Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/cn";
import { expressionDice } from "@/lib/dice";
import {
  resolveFaceSource,
  useDiceSources,
  type FaceSource,
} from "@/lib/dice/dice-sources";
import {
  getConnectedPixels,
  getConnectedPixelsServer,
  onPixelRoll,
  onPixelsChanged,
} from "@/lib/dice/pixels-dice";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { PendingRoll } from "@/app/campaigns/[campaignId]/useCampaignStream";
import { useI18n } from "@/lib/i18n/context";
import { localeText } from "@/lib/i18n/locale-text";

const OWNER_FALLBACK_AFTER_MS = 3 * 60 * 1000;

// A parked physical roll. The rolling player enters each die; everyone else
// sees a waiting card. The roller can always fall back to a digital roll;
// the owner can too once the card has sat unanswered for a few minutes.
export function PendingRollCard({
  campaignId,
  pending,
  sheets,
  meUserId,
  steersStory,
}: {
  campaignId: string;
  pending: PendingRoll;
  sheets: CharacterSheet[];
  meUserId: string;
  steersStory: boolean;
}) {
  const uiText = useInlineText();
  const { locale } = useI18n();
  const copy = localeText(locale, { en: { someone: "Someone", and: "and", enter: "Enter the bare die numbers; the", added: "is added for you.", submitFailed: "Could not submit the roll.", serverFailed: "Could not reach the server.", roll: "Roll", assigned: "Your assigned dice fill in on their own.", auto: "auto", rolled: "rolled for you", submit: "Submit roll", digital: "Roll digitally instead" }, ru: { someone: "Кто-то", and: "и", enter: "Введите только значения кубов;", added: "будет добавлен автоматически.", submitFailed: "Не удалось отправить бросок.", serverFailed: "Не удалось связаться с сервером.", roll: "Бросьте", assigned: "Назначенные кубы заполнятся сами.", auto: "авто", rolled: "брошен за вас", submit: "Отправить бросок", digital: "Бросить цифровым кубом" } });
  const [values, setValues] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Sampled once on mount; the fallback affordance appearing on the next
  // re-render after the threshold is fine for a courtesy button.
  const [mountedAt] = useState(() => Date.now());

  const faces = useMemo(() => {
    try {
      return expressionDice(pending.expression);
    } catch {
      return [];
    }
  }, [pending.expression]);

  const mine = pending.userId === meUserId;

  const [diceSources] = useDiceSources();
  const pixels = useSyncExternalStore(
    onPixelsChanged,
    getConnectedPixels,
    getConnectedPixelsServer,
  );

  // Resolve every face to its source: the chosen preference, degraded to
  // typing when the assigned Pixels die isn't currently connected.
  const faceSources = useMemo<FaceSource[]>(
    () => faces.map((sides) => resolveFaceSource(diceSources[sides], sides, pixels)),
    [faces, diceSources, pixels],
  );

  // What a face has so far: the typed or Pixels-landed entry, else empty. A
  // digital face never has a client value; the server rolls it on submit, so
  // the browser has nothing a player could read ahead of time.
  const faceValue = (index: number): string => values[index]?.trim() ?? "";

  // The wire payload: numbers for typed and Pixels faces, the literal
  // "digital" for server-rolled ones.
  const submissionDice = (): Array<number | "digital"> =>
    faces.map((_, index) =>
      faceSources[index]?.kind === "digital" ? "digital" : Number(faceValue(index)),
    );

  // A physical Pixels die landing fills the next empty face assigned to it.
  useEffect(() => {
    if (!mine) {
      return;
    }
    return onPixelRoll(({ systemId, faceCount, value }) => {
      setValues((current) => {
        const index = faceSources.findIndex(
          (source, position) =>
            source.kind === "pixel" &&
            source.systemId === systemId &&
            faces[position] === faceCount &&
            !current[position]?.trim(),
        );
        if (index < 0) {
          return current;
        }
        return { ...current, [index]: String(value) };
      });
    });
  }, [mine, faceSources, faces]);

  const character = sheets.find((sheet) => sheet.id === pending.characterId);
  // Attack-engine pendings already carry a full sentence in detail
  // ("Kara: Longsword vs Goblin"); avoid stacking the name twice.
  const detailText = pending.detail.replaceAll("_", " ");
  const label = detailText.startsWith(`${character?.name ?? ""}:`)
    ? detailText
     : `${character?.name ?? copy.someone}: ${pending.kind.replaceAll("_", " ")}${
        detailText ? ` (${detailText})` : ""
      }`;
  // Plain-words instruction: "Roll 2× d20 and 1× d8" from the faces list.
  const diceSummary = (() => {
    if (!faces.length) {
      return "";
    }
    const counts = new Map<number, number>();
    for (const sides of faces) {
      counts.set(sides, (counts.get(sides) ?? 0) + 1);
    }
    const parts = [...counts.entries()].map(
      ([sides, count]) => `${count} × d${sides}`,
    );
    return parts.length > 1
      ? `${parts.slice(0, -1).join(", ")} ${copy.and} ${parts[parts.length - 1]}`
      : parts[0];
  })();
  // Enter raw die faces only; any flat bonus applies server-side.
  const flatModifier = /([+-]\d+)$/.exec(pending.expression.replaceAll(" ", ""))?.[1];
  const modifierNote = flatModifier
    ? `${copy.enter} ${flatModifier} ${copy.added}`
    : "";
  const advantageNote =
    pending.advantage === "advantage"
      ? "advantage: roll both, highest counts"
      : pending.advantage === "disadvantage"
        ? "disadvantage: roll both, lowest counts"
        : "";
  const stale = mountedAt - new Date(pending.createdAt).getTime() > OWNER_FALLBACK_AFTER_MS;
  // A digital face is always ready (the server fills it); everything else
  // needs its number in hand before the roll can go.
  const complete =
    faces.length > 0 &&
    faces.every(
      (_, index) => faceSources[index]?.kind === "digital" || faceValue(index),
    );
  // Every face comes from a die that fills itself (digital or a Pixels die):
  // no typing is needed, so the card submits on its own once all have landed.
  const fullyAutomatic =
    faceSources.length > 0 && faceSources.every((source) => source.kind !== "manual");

  async function submit(body: unknown) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/campaigns/${campaignId}/pending-rolls/${pending.id}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || copy.submitFailed);
      }
    } catch {
      setError(copy.serverFailed);
    } finally {
      setBusy(false);
    }
  }

  const autoSubmittedRef = useRef(false);
  useEffect(() => {
    if (!mine || !fullyAutomatic || autoSubmittedRef.current || busy || !complete) {
      return;
    }
    autoSubmittedRef.current = true;
    void submit({ dice: submissionDice() });
    // submit is stable enough for this one-shot guarded call; re-running only
    // matters to catch the transition to complete, which the deps below cover.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine, fullyAutomatic, busy, complete, faces, values]);

  if (!mine) {
    return (
      <div className="mb-2 flex items-center justify-between rounded-md border border-amber-900/60 bg-amber-950/20 px-3 py-2 text-xs text-amber-200/90">
        <span className="flex items-center gap-2">
          <Dices className="size-4 animate-pulse text-amber-200" />
          {uiText("Waiting for")} {character?.name ?? uiText("a player")} {uiText("to roll")} {pending.expression} {uiText("with real dice")}
        </span>
        {steersStory && stale ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => submit({ fallback: "digital" })}
            className="shrink-0 text-amber-200 hover:text-amber-300 disabled:opacity-50"
          >
            {uiText("Roll digitally")}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mb-2 animate-fade-up rounded-lg border border-amber-500/50 bg-amber-950/30 px-3 py-2.5 shadow-glow-gold">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-2 text-amber-100">
          <Dices className="size-4 text-amber-200" />
          {uiText("Your roll:")} {label}
        </span>
        <span className="font-mono text-xs text-amber-400">{pending.expression}</span>
      </div>
      {pending.reason ? (
        <p className="mt-0.5 text-xs text-amber-200/70">{pending.reason}</p>
      ) : null}
      {diceSummary ? (
        <p className="mt-1 text-xs text-amber-100">
          {fullyAutomatic
            ? `${copy.roll} ${diceSummary}. ${copy.assigned}`
            : uiText("Roll {dice} at your table and enter each die below.{modifier} The game waits for your result.", {
                dice: diceSummary,
                modifier: modifierNote ? ` ${modifierNote}` : "",
              })}
        </p>
      ) : null}
      {advantageNote ? (
        <p className="mt-0.5 text-xs text-amber-200/90">{advantageNote}</p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-end gap-2">
        {faces.map((sides, index) => {
          const source = faceSources[index] ?? { kind: "manual" };
          const filled = faceValue(index);
          // Digital faces are rolled by the server on submit: marked, not
          // typed, and showing no number the player could act on early.
          if (source.kind === "digital") {
            return (
              <div key={index} className="block">
                <span className="mb-0.5 block text-center text-[10px] text-sky-300/80">
                   d{sides} · {copy.auto}
                </span>
                <div
                   aria-label={`d${sides} ${copy.rolled}`}
                  className="flex h-[34px] w-14 items-center justify-center rounded-md border border-sky-800/70 bg-sky-950/30 text-sm text-sky-100"
                >
                  <Dices className="size-4 text-sky-300/80" />
                </div>
              </div>
            );
          }
          // Pixels faces auto-fill when the die lands, but stay editable so a
          // stubborn die never blocks the roll.
          const isPixel = source.kind === "pixel";
          return (
            <label key={index} className="block">
              <span
                title={isPixel ? source.name : undefined}
                className={cn(
                  "mb-0.5 block max-w-14 truncate text-center text-[10px]",
                  isPixel ? "text-sky-300/90" : "text-amber-400/80",
                )}
              >
                {isPixel ? source.name : `d${sides}`}
              </span>
              <div className="relative">
                <input
                  type="number"
                  min={1}
                  max={sides}
                  inputMode="numeric"
                  value={values[index] ?? ""}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [index]: event.target.value }))
                  }
                  className={cn(
                    "w-14 rounded-md border bg-stone-900 px-2 py-1.5 text-center text-sm outline-none",
                    isPixel
                      ? "border-sky-800 focus:border-sky-500"
                      : "border-amber-800 focus:border-amber-500",
                  )}
                />
                {isPixel && !filled ? (
                  <Dices className="pointer-events-none absolute right-1 top-1/2 size-3 -translate-y-1/2 animate-pulse text-sky-400/70" />
                ) : null}
              </div>
            </label>
          );
        })}
        <button
          type="button"
          disabled={busy || !complete}
          onClick={() => submit({ dice: submissionDice() })}
          className={cn(
            "rounded-lg bg-gradient-to-b from-amber-100 via-amber-200 to-amber-400 px-3 py-1.5 text-sm font-semibold text-amber-950",
            "shadow-[0_1px_0_rgba(253,247,231,0.6)_inset] transition-all duration-150 ease-snap",
            "hover:-translate-y-px hover:shadow-glow-gold-strong active:translate-y-0 active:scale-95",
            "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:shadow-none",
          )}
        >
           {busy ? <Loader2 className="size-4 animate-spin" /> : copy.submit}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => submit({ fallback: "digital" })}
          className="text-xs text-stone-400 hover:text-stone-200 disabled:opacity-50"
        >
           {copy.digital}
        </button>
      </div>
      {error ? <p className="mt-1.5 text-xs text-red-400">{error}</p> : null}
    </div>
  );
}
