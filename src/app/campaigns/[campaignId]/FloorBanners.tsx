"use client";

import { Check, Hand, Swords } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Floor } from "@/lib/db/campaigns";
import type { PublicEncounter } from "@/lib/db/encounter-view";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { useI18n } from "@/lib/i18n/context";
import { localeText } from "@/lib/i18n/locale-text";

// Spotlight, held-responses, and initiative banners above the composer;
// The lead gets release/skip controls; the combat HUD owns player submission.
export function FloorBanners({
  floor,
  spotlighted,
  heldSpotlightNames,
  encounter,
  steersStory,
  onRelease,
}: {
  floor: Floor;
  spotlighted: CharacterSheet[];
  heldSpotlightNames: string[];
  encounter?: PublicEncounter | null;
  steersStory: boolean;
  onRelease: () => void;
}) {
  const { locale } = useI18n();
  const copy = localeText(locale, { en: { round: "Round", turn: "turn", endTitle: "Done with your action, movement, and bonus action? End your combat turn.", end: "End turn", skipTitle: "Skip the current player's turn", skip: "Skip turn", waiting: "Spotlight, waiting on", spotlight: "Spotlight", someone: "someone", release: "Release", held: "Responses held. Talk it over; the lead opens the floor.", next: "Next: spotlight on", allow: "Allow responses" }, ru: { round: "Раунд", turn: "ход", endTitle: "Закончили действие, перемещение и бонусное действие? Завершите боевой ход.", end: "Завершить ход", skipTitle: "Пропустить ход текущего игрока", skip: "Пропустить ход", waiting: "В центре внимания, ждём", spotlight: "В центре внимания", someone: "кого-то", release: "Открыть", held: "Ответы удержаны. Обсудите; ведущий откроет слово.", next: "Далее: в центре внимания", allow: "Разрешить ответы" }, pl: { round: "Runda", turn: "tura", endTitle: "Skończono akcję, ruch i akcję dodatkową? Zakończ turę walki.", end: "Zakończ turę", skipTitle: "Pomiń turę bieżącego gracza", skip: "Pomiń turę", waiting: "W centrum uwagi, czekamy na", spotlight: "W centrum uwagi", someone: "kogoś", release: "Otwórz", held: "Odpowiedzi wstrzymane. Omówcie to; prowadzący otworzy głos.", next: "Dalej: centrum uwagi", allow: "Zezwól na odpowiedzi" } });

  return (
    <>
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
      {floor.mode === "hold" && !floor.combat ? (
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
