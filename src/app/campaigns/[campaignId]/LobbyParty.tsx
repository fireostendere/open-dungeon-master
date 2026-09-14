"use client";

import { Bot, Crown, Trash2, UserPlus, Users, Volume2, VolumeX } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Tooltip } from "@/components/ui/Tooltip";
import { UserAvatar, ui } from "@/lib/ui";
import type { CampaignMember } from "@/lib/campaign-types";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { useI18n } from "@/lib/i18n";

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
        <h2 className={cn(ui.sectionEyebrow, "mb-1")}>
          {locale === "ru" ? `Отряд · ${members.length}/${campaign.maxPlayers}` : `Party · ${members.length}/${campaign.maxPlayers}`}
        </h2>
        <p className="mb-3 text-xs text-stone-400">
          {locale === "ru"
            ? "Отряд формируется из участников кампании и их персонажей."
            : "The party is formed by campaign members and their assigned characters."}
        </p>
        <ul className="space-y-2">
          {members.map((member) => {
            const sheet = sheets.find((entry) => entry.userId === member.userId);
            return (
              <li
                key={member.userId}
                className={cn(ui.card, "flex flex-wrap items-center justify-between gap-3 px-4 py-3")}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <UserAvatar url={member.avatar?.url} userId={member.userId} size="size-12" />
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-1.5 font-medium text-stone-100">
                      <span className="truncate">{member.username}</span>
                      {humanDmTable && member.userId === campaign.dmUserId ? (
                        <SeatBadge>{locale === "ru" ? "Мастер" : "DM"}</SeatBadge>
                      ) : null}
                      {humanDmTable && member.userId === campaign.assistantDmUserId ? (
                        <SeatBadge>{locale === "ru" ? "пом. Мастера" : "co-DM"}</SeatBadge>
                      ) : null}
                      {member.userId === campaign.leadUserId ? (
                        <SeatBadge>
                          <Crown className="size-3" /> {locale === "ru" ? "лидер отряда" : "party lead"}
                        </SeatBadge>
                      ) : member.role === "owner" ? (
                        <SeatBadge>{locale === "ru" ? "создатель" : "owner"}</SeatBadge>
                      ) : null}
                    </p>
                    <p className="truncate text-sm text-stone-400">
                      {sheet
                        ? `${sheet.name} · ${sheet.race.replaceAll("_", " ")} ${sheet.class} ${sheet.level}`
                        : (locale === "ru" ? "Персонаж ещё не создан" : "No character yet")}
                    </p>
                  </div>
                </div>
                <span className="flex flex-wrap items-center gap-1.5">
                  {canMakeLead && member.userId !== campaign.leadUserId ? (
                    <SeatAction
                      tip={locale === "ru" ? "Передать лидерство этому игроку" : "Hand the party lead to this player"}
                      onClick={() => onMakeLead(member.userId)}
                    >
                      <Crown className="size-3" /> {locale === "ru" ? "лидер" : "make lead"}
                    </SeatAction>
                  ) : null}
                  {humanDmTable && canAssignSeats && member.userId !== campaign.dmUserId ? (
                    <>
                      <SeatAction
                        tip={locale === "ru" ? "Передать игроку роль Мастера" : "Hand this player the DM seat and the game"}
                        onClick={() => onAssignSeat("dm", member.userId)}
                      >
                        {locale === "ru" ? "сделать Мастером" : "make DM"}
                      </SeatAction>
                      {member.userId === campaign.assistantDmUserId ? (
                        <SeatAction
                          tip={locale === "ru" ? "Освободить место помощника Мастера" : "Take back the co-DM seat"}
                          onClick={() => onAssignSeat("assistant", null)}
                        >
                          {locale === "ru" ? "снять пом. Мастера" : "remove co-DM"}
                        </SeatAction>
                      ) : (
                        <SeatAction
                          tip={locale === "ru" ? "Назначить помощником Мастера" : "Seat this player as co-DM: every DM power except handing out seats"}
                          onClick={() => onAssignSeat("assistant", member.userId)}
                        >
                          {locale === "ru" ? "сделать пом. Мастера" : "make co-DM"}
                        </SeatAction>
                      )}
                    </>
                  ) : null}
                  {canMute && member.userId !== campaign.leadUserId && member.role !== "owner" ? (
                    <SeatAction
                      tip={
                        locale === "ru"
                          ? (member.muted ? "Включить микрофон игроку" : "Заглушить: игрок следит за игрой, но не может действовать")
                          : (member.muted ? "Let this player speak at the table again" : "Mute: this player reads along but cannot act, ask or side-chat")
                      }
                      onClick={() => onMute(member.userId, !member.muted)}
                    >
                      {member.muted ? (
                        <>
                          <Volume2 className="size-3" /> {locale === "ru" ? "вкл. звук" : "unmute"}
                        </>
                      ) : (
                        <>
                          <VolumeX className="size-3" /> {locale === "ru" ? "заглушить" : "mute"}
                        </>
                      )}
                    </SeatAction>
                  ) : null}
                  {member.muted ? (
                    <SeatBadge tip={locale === "ru" ? "Заглушен лидером отряда" : "Muted by the party lead"}>
                      <VolumeX className="size-3" /> {locale === "ru" ? "заглушен" : "muted"}
                    </SeatBadge>
                  ) : null}
                  {member.useRealDice ? (
                    <SeatBadge tip={locale === "ru" ? "Бросает настоящие кости: игра ждёт ввода чисел" : "Rolls physical dice: the DM waits for this player to enter real rolls"}>
                      {locale === "ru" ? "живые кости" : "real dice"}
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
                    {member.ready ? (locale === "ru" ? "готов" : "ready") : (locale === "ru" ? "не готов" : "not ready")}
                  </span>
                </span>
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
            {locale === "ru" ? "Спутники" : "Companions"}
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
                  <Tooltip content={locale === "ru" ? "Удалить спутника" : "Remove this companion"}>
                    <button
                      type="button"
                      onClick={() => onDismissCompanion(companion.id)}
                      aria-label={locale === "ru" ? `Удалить ${companion.name}` : `Remove ${companion.name}`}
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
              <UserPlus className="size-4" /> {locale === "ru" ? "Добавить спутника" : "Add a companion"}
            </button>
          ) : (
            <p className="text-center text-xs text-stone-500">
              {locale === "ru" ? "В отряде максимальное количество спутников." : "The party has its full number of companions."}
            </p>
          )}
        </section>
      ) : null}
    </>
  );
}
