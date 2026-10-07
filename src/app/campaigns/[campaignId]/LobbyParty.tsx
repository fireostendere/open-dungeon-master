"use client";

import { Bot, Crown, Trash2, UserPlus, Users, Volume2, VolumeX } from "lucide-react";
import { GameIcon } from "@/components/ui/GameIcon";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Tooltip } from "@/components/ui/Tooltip";
import { UserAvatar, ui } from "@/lib/ui";
import type { CampaignMember } from "@/lib/campaign-types";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";
import { localizedRaceName } from "@/lib/help";
import { characterDisplay } from "@/lib/i18n/character-display";

// Small gold badge on a party row: DM, co-DM, party lead, owner, real dice.
function SeatBadge({ children, tip }: { children: ReactNode; tip?: string }) {
  const badge = (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[11px] text-amber-200">
      {children}
    </span>
  );
  return tip ? <Tooltip content={tip}>{badge}</Tooltip> : badge;
}

// A seat action on a party row: make lead, make DM, make or remove co-DM.
function SeatAction({
  tip,
  onClick,
  children,
}: {
  tip: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip content={tip}>
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1 rounded-full border border-stone-700/70 px-2 py-0.5 text-[11px] text-stone-400 transition-colors hover:border-amber-500/40 hover:bg-stone-900 hover:text-amber-100"
      >
        {children}
      </button>
    </Tooltip>
  );
}

// The lobby's party list: every member with their seat badges, ready state
// and, for whoever may hand seats around, the controls to do it. Below it,
// for whoever steers the story, the companions prepared for the party.
export function LobbyParty({
  campaign,
  members,
  partySize,
  sheets,
  canMakeLead,
  humanDmTable,
  canAssignSeats,
  seatError,
  onMakeLead,
  onAssignSeat,
  canMute,
  onMute,
  showParty,
  showCompanions,
  partyCompanions,
  canBuildCompanion,
  onBuildCompanion,
  onDismissCompanion,
}: {
  campaign: {
    maxPlayers: number;
    leadUserId: string;
    dmUserId: string | null;
    assistantDmUserId: string | null;
  };
  members: CampaignMember[];
  partySize: number;
  sheets: CharacterSheet[];
  // The lead or the owner may hand the lead seat on.
  canMakeLead: boolean;
  // A human sits in the DM seat ("human" and "assisted" alike), so the list
  // shows who holds it.
  humanDmTable: boolean;
  // The seat route's answer (primary DM or owner), asked of the server so a
  // button it would refuse is never rendered.
  canAssignSeats: boolean;
  seatError: string;
  onMakeLead: (userId: string) => void;
  onAssignSeat: (seat: "dm" | "assistant", userId: string | null) => void;
  // The lead or the owner may silence a player at this table.
  canMute: boolean;
  onMute: (userId: string, muted: boolean) => void;
  // A solo campaign has no party list, but its player may still keep
  // companions, so the two sections are switched separately.
  showParty: boolean;
  showCompanions: boolean;
  partyCompanions: CharacterSheet[];
  canBuildCompanion: boolean;
  onBuildCompanion: () => void;
  onDismissCompanion: (characterId: string) => void;
}) {
  const { locale } = useI18n();

  return (
    <>
      {showParty ? (
      <section className="mb-6">
        <h2 className={cn(ui.sectionEyebrow, "mb-1 flex items-center gap-2")}>
          <GameIcon icon={{ kind: "glyph", key: "tab-party" }} size="size-6" />
          {localeText(locale, { en: `Party · ${partySize}/${campaign.maxPlayers}`, ru: `Отряд · ${partySize}/${campaign.maxPlayers}` })}
        </h2>
        <p className="mb-3 text-xs text-stone-400">
          {localeText(locale, { en: "The party is formed by campaign members and their assigned characters.", ru: "Отряд формируется из участников кампании и их персонажей." })}
        </p>
        <ul className="space-y-2">
          {members.map((member) => {
            const sheet = sheets.find((entry) => entry.userId === member.userId);
            const dmSeat = humanDmTable && (member.userId === campaign.dmUserId || member.userId === campaign.assistantDmUserId);
            return (
              <li
                key={member.userId}
                className={cn(ui.card, "flex flex-wrap items-center justify-between gap-3 px-4 py-3")}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="relative shrink-0">
                    <UserAvatar url={member.avatar?.url} userId={member.userId} size="size-12" />
                    {sheet ? (
                      <GameIcon
                        icon={{ kind: "family", key: `class-${sheet.class.toLowerCase()}` }}
                        size="size-6"
                        className="absolute -bottom-1 -right-1"
                      />
                    ) : null}
                  </span>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-1.5 font-medium text-stone-100">
                      <span className="truncate">{member.username}</span>
                      {humanDmTable && member.userId === campaign.dmUserId ? (
                        <SeatBadge>{localeText(locale, { en: "DM", ru: "Мастер" })}</SeatBadge>
                      ) : null}
                      {humanDmTable && member.userId === campaign.assistantDmUserId ? (
                        <SeatBadge>{localeText(locale, { en: "co-DM", ru: "пом. Мастера" })}</SeatBadge>
                      ) : null}
                      {member.userId === campaign.leadUserId ? (
                        <SeatBadge>
                          <Crown className="size-3" /> {localeText(locale, { en: "party lead", ru: "лидер отряда" })}
                        </SeatBadge>
                      ) : member.role === "owner" ? (
                        <SeatBadge>{localeText(locale, { en: "owner", ru: "создатель" })}</SeatBadge>
                      ) : null}
                    </p>
                    <p className="truncate text-sm text-stone-400">
                      {sheet
                        ? `${sheet.name} · ${localizedRaceName(sheet.race, sheet.race, locale)} · ${characterDisplay(sheet.class, locale)} ${sheet.level}`
                        : dmSeat
                          ? localeText(locale, { en: "Runs the game", ru: "Ведёт игру" })
                          : localeText(locale, { en: "Choosing a character", ru: "Выбирает персонажа" })}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {canMakeLead || canAssignSeats || canMute ? (
                    <details className="text-xs text-stone-400">
                      <summary className="cursor-pointer rounded-md border border-stone-700/70 px-2 py-1">
                        {localeText(locale, { en: "Manage", ru: "Управление" })}
                      </summary>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                  {canMakeLead && member.userId !== campaign.leadUserId ? (
                    <SeatAction
                      tip={localeText(locale, { en: "Hand the party lead to this player", ru: "Передать лидерство этому игроку" })}
                      onClick={() => onMakeLead(member.userId)}
                    >
                      <Crown className="size-3" /> {localeText(locale, { en: "make lead", ru: "лидер" })}
                    </SeatAction>
                  ) : null}
                  {humanDmTable && canAssignSeats && !sheet && member.userId !== campaign.dmUserId ? (
                    <>
                      <SeatAction
                        tip={localeText(locale, { en: "Hand this player the DM seat and the game", ru: "Передать игроку роль Мастера" })}
                        onClick={() => onAssignSeat("dm", member.userId)}
                      >
                        {localeText(locale, { en: "make DM", ru: "сделать Мастером" })}
                      </SeatAction>
                      {member.userId === campaign.assistantDmUserId ? (
                        <SeatAction
                          tip={localeText(locale, { en: "Take back the co-DM seat", ru: "Освободить место помощника Мастера" })}
                          onClick={() => onAssignSeat("assistant", null)}
                        >
                          {localeText(locale, { en: "remove co-DM", ru: "снять пом. Мастера" })}
                        </SeatAction>
                      ) : (
                        <SeatAction
                          tip={localeText(locale, { en: "Seat this player as co-DM: every DM power except handing out seats", ru: "Назначить помощником Мастера: все права Мастера, кроме назначения ведущих" })}
                          onClick={() => onAssignSeat("assistant", member.userId)}
                        >
                          {localeText(locale, { en: "make co-DM", ru: "сделать пом. Мастера" })}
                        </SeatAction>
                      )}
                    </>
                  ) : null}
                  {canMute && member.userId !== campaign.leadUserId && member.role !== "owner" ? (
                    <SeatAction
                      tip={member.muted
                        ? localeText(locale, { en: "Let this player speak at the table again", ru: "Снова разрешить игроку участвовать в игре" })
                        : localeText(locale, { en: "Mute: this player reads along but cannot act, ask or side-chat", ru: "Заглушить: игрок может читать, но не может действовать, задавать вопросы или писать в чат" })}
                      onClick={() => onMute(member.userId, !member.muted)}
                    >
                      {member.muted ? (
                        <>
                          <Volume2 className="size-3" /> {localeText(locale, { en: "unmute", ru: "разрешить участие" })}
                        </>
                      ) : (
                        <>
                          <VolumeX className="size-3" /> {localeText(locale, { en: "mute", ru: "заглушить" })}
                        </>
                      )}
                    </SeatAction>
                  ) : null}
                      </div>
                    </details>
                  ) : null}
                  {member.muted ? (
                    <SeatBadge tip={localeText(locale, { en: "Muted by the party lead", ru: "Заглушен лидером отряда" })}>
                      <VolumeX className="size-3" /> {localeText(locale, { en: "muted", ru: "заглушен" })}
                    </SeatBadge>
                  ) : null}
                  {member.useRealDice ? (
                    <SeatBadge tip={localeText(locale, { en: "Rolls physical dice: the DM waits for this player to enter real rolls", ru: "Бросает настоящие кости: игра ждёт ввода чисел" })}>
                      {localeText(locale, { en: "real dice", ru: "живые кости" })}
                    </SeatBadge>
                  ) : null}
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px]",
                      member.ready
                        ? "border border-emerald-500/30 bg-emerald-950/60 text-emerald-300"
                        : "border border-stone-700/70 bg-stone-900/60 text-stone-400",
                    )}
                  >
                    {member.ready ? localeText(locale, { en: "ready", ru: "готов" }) : localeText(locale, { en: "not ready", ru: "не готов" })}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
        {seatError ? <p className="mt-2 text-sm text-red-400">{seatError}</p> : null}
      </section>
      ) : null}

      {showCompanions ? (
        <section className="mb-6">
          <h2 className={cn(ui.sectionEyebrow, "mb-3 flex items-center gap-1.5")}>
            {humanDmTable ? <Users className="size-3.5" /> : <Bot className="size-3.5" />}{" "}
            {localeText(locale, { en: "Companions", ru: "Спутники" })}
          </h2>
          {partyCompanions.length ? (
            <ul className="mb-2 space-y-2">
              {partyCompanions.map((companion) => (
                <li
                  key={companion.id}
                  className={cn(ui.card, "flex items-center justify-between gap-3 px-4 py-2.5")}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    {companion.portrait ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={companion.portrait.url}
                        alt=""
                        className="size-10 shrink-0 rounded-lg border border-sky-500/30 object-cover"
                      />
                    ) : (
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-stone-700/60 bg-stone-900">
                        {humanDmTable ? (
                          <Users className="size-4 text-sky-300" />
                        ) : (
                          <Bot className="size-4 text-sky-300" />
                        )}
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="truncate font-medium text-stone-100">{companion.name}</p>
                      <p className="truncate text-sm text-stone-400">
                        {companion.race.replaceAll("_", " ")} {companion.class} {companion.level}
                      </p>
                    </div>
                  </div>
                  <Tooltip content={localeText(locale, { en: "Remove this companion", ru: "Удалить спутника" })}>
                    <button
                      type="button"
                      onClick={() => onDismissCompanion(companion.id)}
                      aria-label={localeText(locale, { en: `Remove ${companion.name}`, ru: `Удалить ${companion.name}` })}
                      className="rounded-full border border-stone-700/70 p-1.5 text-stone-500 transition-colors hover:border-red-500/40 hover:text-red-400"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </Tooltip>
                </li>
              ))}
            </ul>
          ) : null}
          {canBuildCompanion ? (
            <button
              type="button"
              onClick={onBuildCompanion}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-stone-700 px-3 py-3 text-sm text-stone-300 transition-colors hover:border-sky-700/60 hover:bg-stone-900 hover:text-sky-200"
            >
              <UserPlus className="size-4" /> {localeText(locale, { en: "Add a companion", ru: "Добавить спутника" })}
            </button>
          ) : (
            <p className="text-center text-xs text-stone-500">
              {localeText(locale, { en: "The party has its full number of companions.", ru: "В отряде максимальное количество спутников." })}
            </p>
          )}
        </section>
      ) : null}
    </>
  );
}
