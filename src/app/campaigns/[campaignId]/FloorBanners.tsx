"use client";

import { Check, Hand, Hourglass, Swords } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import type { Floor } from "@/lib/db/campaigns";
import type { PublicEncounter } from "@/lib/db/encounter-view";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { useI18n } from "@/lib/i18n/context";
import { localeText } from "@/lib/i18n/locale-text";

// A held combat turn is stuck when the DM has not handed it on this long;
// only then does the lead get the forced handoff.
const STUCK_AFTER_MS = 3 * 60_000;

// Spotlight, held-responses, and initiative banners above the composer;
// The lead gets release/skip controls; the combat HUD owns player submission.
export function FloorBanners({
  campaignId,
  floor,
  spotlighted,
  heldSpotlightNames,
  encounter,
  sheets = [],
  pendingRollCount = 0,
  steersStory,
  onRelease,
}: {
  campaignId?: string;
  floor: Floor;
  spotlighted: CharacterSheet[];
  heldSpotlightNames: string[];
  encounter?: PublicEncounter | null;
  sheets?: CharacterSheet[];
  pendingRollCount?: number;
  steersStory: boolean;
  onRelease: () => void;
}) {
  const { locale } = useI18n();
  const resolving = localeText(locale, {
    en: { title: "{name}'s turn is with the DM — it is nobody's turn right now.", hint: "The next turn opens when the DM finishes writing.", dice: "Waiting on dice.", pass: "Pass the turn", passTitle: "The DM has resolved this turn; hand initiative to the next hero now.", force: "Pass anyway", forceTitle: "The DM has gone quiet mid-turn. Move on without their resolution.", confirm: "Pass the turn without the DM's resolution? The submitted action stays unresolved.", failed: "Could not pass the turn." },
    ru: { title: "Ход {name} у Мастера — сейчас ничей ход.", hint: "Следующий ход откроется, когда Мастер допишет.", dice: "Ждём броски.", pass: "Передать ход", passTitle: "Мастер разрешил этот ход; передать инициативу следующему герою.", force: "Передать всё равно", forceTitle: "Мастер замолчал посреди хода. Идти дальше без его разрешения.", confirm: "Передать ход без разрешения Мастера? Заявленное действие останется неразрешённым.", failed: "Не удалось передать ход." },
  });
  const gate = floor.mode === "hold" ? floor.combat : undefined;
  const [now, setNow] = useState(() => Date.now());
  const [passing, setPassing] = useState(false);
  const [passError, setPassError] = useState("");
  useEffect(() => {
    if (!gate) return;
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, [gate]);
  const actorName = gate ? sheets.find((sheet) => sheet.id === gate.characterId)?.name ?? "…" : "";
  const ready = Boolean(gate && (!gate.requiresEndTurn || gate.mechanicsResolved) && !pendingRollCount);
  const heldAt = gate?.heldAt ? Date.parse(gate.heldAt) : NaN;
  const stuck = Boolean(gate && !ready && !pendingRollCount && Number.isFinite(heldAt) && now - heldAt > STUCK_AFTER_MS);
  const passTurn = async (force: boolean) => {
    if (!campaignId || passing) return;
    if (force && !window.confirm(resolving.confirm)) return;
    setPassing(true);
    setPassError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/floor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passTurn: true, force }),
      });
      if (!response.ok) setPassError(resolving.failed);
    } catch {
      setPassError(resolving.failed);
    } finally {
      setPassing(false);
    }
  };
  const copy = localeText(locale, { en: { round: "Round", turn: "turn", endTitle: "Done with your action, movement, and bonus action? End your combat turn.", end: "End turn", skipTitle: "Skip the current player's turn", skip: "Skip turn", waiting: "Spotlight, waiting on", spotlight: "Spotlight", someone: "someone", release: "Release", held: "Responses held. Talk it over; the lead opens the floor.", next: "Next: spotlight on", allow: "Allow responses" }, ru: { round: "Раунд", turn: "ход", endTitle: "Закончили действие, перемещение и бонусное действие? Завершите боевой ход.", end: "Завершить ход", skipTitle: "Пропустить ход текущего игрока", skip: "Пропустить ход", waiting: "В центре внимания, ждём", spotlight: "В центре внимания", someone: "кого-то", release: "Открыть", held: "Ответы удержаны. Обсудите; ведущий откроет слово.", next: "Далее: в центре внимания", allow: "Разрешить ответы" } });

  return (
    <>
      {gate ? (
        <div
          role="status"
          className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border border-sky-900/60 bg-sky-950/30 px-3 py-1.5 text-xs"
        >
          <span className="flex min-w-0 items-center gap-1.5 text-sky-100">
            <Hourglass className="size-3.5 shrink-0 animate-pulse motion-reduce:animate-none" />
            <span className="min-w-0">
              <span className="font-semibold">{resolving.title.replace("{name}", () => actorName)}</span>{" "}
              <span className="text-sky-200/70">{pendingRollCount ? resolving.dice : resolving.hint}</span>
            </span>
          </span>
          {steersStory && campaignId && (ready || stuck) ? (
            <button
              type="button"
              onClick={() => void passTurn(!ready)}
              disabled={passing}
              title={ready ? resolving.passTitle : resolving.forceTitle}
              className="shrink-0 rounded px-1 py-0.5 text-sky-200 hover:text-sky-50 disabled:opacity-50"
            >
              {ready ? resolving.pass : resolving.force}
            </button>
          ) : null}
          {passError ? <span className="w-full text-red-300">{passError}</span> : null}
        </div>
      ) : null}
      {floor.mode === "initiative" ? (
        <div className="mb-2 flex items-center justify-between rounded-md border border-red-900/60 bg-red-950/30 px-3 py-1.5 text-xs">
          <span className="flex min-w-0 items-center gap-1.5 text-red-200">
            <Swords className="size-3.5 shrink-0" />
            <span className="truncate">
               {copy.round} {floor.round}
              {encounter?.orderReady && encounter.order.length ? (
                <>
                  {" · "}
                  {encounter.order.map((entry, index) => {
                     const current = entry.id === encounter.currentActorId;
                    return (
                      <span
                        key={entry.id}
                        className={cn(
                          current ? "font-semibold text-red-100" : "text-red-200/60",
                        )}
                      >
                        {index > 0 ? " > " : ""}
                        {entry.name}
                      </span>
                    );
                  })}
                </>
              ) : (
                <> · {floor.currentName}: {copy.turn}</>
              )}
            </span>
          </span>
          <span className="ml-3 flex shrink-0 items-center gap-3">
            {steersStory ? (
              <button
                type="button"
                onClick={onRelease}
                className="text-red-200 hover:text-red-300"
                 title={copy.skipTitle}
              >
                 {copy.skip}
              </button>
            ) : null}
          </span>
        </div>
      ) : null}
      {floor.mode === "spotlight" ? (
        <div className="mb-2 flex items-center justify-between rounded-md border border-amber-900/60 bg-amber-950/30 px-3 py-1.5 text-xs">
          <span className="flex items-center gap-1.5 text-amber-200">
            <span className="flex -space-x-1.5">
              {spotlighted
                .filter((sheet) => sheet.portrait)
                .slice(0, 4)
                .map((sheet) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={sheet.id}
                    src={sheet.portrait!.url}
                    alt=""
                    className="size-5 rounded-full border border-amber-900 object-cover"
                  />
                ))}
            </span>
            <span>
               {floor.respondedUserIds.length ? `${copy.waiting}: ` : `${copy.spotlight}: `}
              {spotlighted.length
                ? spotlighted.map((sheet, index) => {
                    const responded = floor.respondedUserIds.includes(sheet.userId);
                    return (
                      <span
                        key={sheet.id}
                        className={responded ? "text-amber-200/50" : undefined}
                      >
                        {index > 0 ? ", " : ""}
                        {sheet.name}
                        {responded ? <Check className="inline size-3 align-baseline" /> : null}
                      </span>
                    );
                  })
                 : copy.someone}
              {floor.prompt ? (
                <span className="text-amber-200/80"> · {floor.prompt}</span>
              ) : null}
            </span>
          </span>
          {steersStory ? (
            <button
              type="button"
              onClick={onRelease}
              className="ml-3 shrink-0 text-amber-200 hover:text-amber-300"
            >
               {copy.release}
            </button>
          ) : null}
        </div>
      ) : null}
      {floor.mode === "hold" && floor.team ? (
        <div className="mb-2 flex items-center rounded-md border border-red-900/60 bg-red-950/30 px-3 py-1.5 text-xs text-red-200">
          <Swords className="mr-1.5 size-3.5 shrink-0" />
          <span>
            {localeText(locale, {
              en: `Round ${floor.next.mode === "initiative" ? floor.next.round : ""}: ${floor.next.mode === "initiative" ? floor.next.currentName : "the next hero"} acts once the rest of the party has had its turn (team round ${floor.team.round}).`,
              ru: `Раунд ${floor.next.mode === "initiative" ? floor.next.round : ""}: ${floor.next.mode === "initiative" ? floor.next.currentName : "следующий герой"} сходит, когда сходит остальная команда (раунд команды ${floor.team.round}).`,
            })}
          </span>
        </div>
      ) : null}
      {floor.mode === "hold" && !floor.combat && !floor.team ? (
        <div className="mb-2 flex items-center justify-between rounded-md border border-amber-900/60 bg-amber-950/30 px-3 py-1.5 text-xs">
          <span className="flex items-center gap-1.5 text-amber-200">
            <Hand className="size-3.5" />
            <span>
               {copy.held}
              {heldSpotlightNames.length ? (
                <span className="text-amber-200/80">
                  {" "}
                   {copy.next} {heldSpotlightNames.join(", ")}
                </span>
              ) : null}
            </span>
          </span>
          {steersStory ? (
            <button
              type="button"
              onClick={onRelease}
              className="ml-3 shrink-0 text-amber-200 hover:text-amber-300"
            >
               {copy.allow}
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
