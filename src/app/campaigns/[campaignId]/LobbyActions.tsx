"use client";

import Link from "next/link";
import { Check, Loader2, Pencil, Play, Trash2, UserRound } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import type { CampaignMember } from "@/lib/campaign-types";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";
import { characterDisplay } from "@/lib/i18n/character-display";

// Keep the chosen hero and the ways to change it beside the ready control.
function CharacterActions({
  campaignId,
  sheet,
  busy,
  onRemove,
}: {
  campaignId: string;
  sheet: CharacterSheet;
  busy: boolean;
  onRemove: () => void;
}) {
  const { t, locale } = useI18n();
  const copy = localeText(locale, { en: { switch: "Switch" }, ru: { switch: "Сменить" } });
  return (
    <div className={cn(ui.card, "space-y-3 p-4")}>
      <div className="flex items-center gap-3">
        {sheet.portrait ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={sheet.portrait.url} alt="" className="size-12 shrink-0 rounded-lg object-cover" />
        ) : <UserRound className="size-8 shrink-0 text-amber-200" />}
        <div className="min-w-0">
          <p className={ui.sectionEyebrow}>{localeText(locale, { en: "Your character", ru: "Ваш персонаж" })}</p>
          <p className="truncate font-medium text-stone-100">{sheet.name}</p>
          <p className="text-xs text-stone-400">{characterDisplay(sheet.class, locale)} · {localeText(locale, { en: `Level ${sheet.level}`, ru: `${sheet.level}-й уровень` })}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        <Link href={`/campaigns/${campaignId}/character?mode=edit`} className={ui.btnSmall}>
          <Pencil className="size-3" /> {t("common.edit")}
        </Link>
        <Link href={`/campaigns/${campaignId}/character?mode=replace`} className={ui.btnSmall}>
          <UserRound className="size-3" /> {copy.switch}
        </Link>
        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          className={cn(ui.btnSmall, "text-red-300")}
        >
          <Trash2 className="size-3" /> {t("common.delete")}
        </button>
      </div>
    </div>
  );
}

// Opening the adventure. Pulled out of the player branch because the DM needs
// it just as much: a DM who owned the table used to see a Ready button and
// nothing else, so a human-run game could never be started from the seat that
// was running it. `canStart` is the owner or the person in the DM seat (the
// PATCH route allows the same two). Structural blockers disable this button;
// unready players are handled by the caller's start confirmation.
function StartBlock({
  canStart,
  busy,
  blocker,
  onStart,
}: {
  canStart: boolean;
  busy: boolean;
  blocker: string;
  onStart: () => void;
}) {
  const { t, locale } = useI18n();
  const copy = localeText(locale, { en: { wait: "The owner or the DM starts the adventure." }, ru: { wait: "Владелец или мастер стола запускает приключение." } });
  if (!canStart) {
    return (
      <p className="text-center text-sm text-stone-500">
        {copy.wait}
      </p>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={onStart}
        disabled={busy || Boolean(blocker)}
        className={cn(ui.btnPrimary, "w-full py-2.5")}
      >
        <Play className="size-4" /> {t("campaign.startCampaign")}
      </button>
      {blocker ? <p className="text-center text-sm text-stone-500">{locale === "ru" ? ({
        "Every player needs a character before the adventure starts.": "Ждём, пока все игроки выберут персонажей.",
        "Waiting for everyone to ready up.": "Ждём готовности всех участников.",
        "The table is empty.": "За столом пока нет участников.",
        "Waiting for a player to join.": "Ждём, пока присоединится игрок.",
      } as Record<string, string>)[blocker] ?? blocker : blocker}</p> : null}
    </>
  );
}

// The first lobby block: choose a hero (or hand off the DM seat), ready up,
// then start. The server remains authoritative for seats and start blockers.
export function LobbyActions({
  campaign,
  myMember,
  mySheet,
  isDm,
  isSolo,
  isOwner,
  canStart,
  busy,
  error,
  startBlocker,
  onToggleReady,
  onStart,
  onBeginSolo,
  onRemoveCharacter,
  onDelete,
  dmCandidates,
  onPlayAsCharacter,
}: {
  campaign: { id: string };
  myMember: CampaignMember | undefined;
  mySheet: CharacterSheet | undefined;
  isDm: boolean;
  isSolo: boolean;
  isOwner: boolean;
  // Owner or the person in the DM seat: who may press Begin.
  canStart: boolean;
  busy: boolean;
  error: string;
  startBlocker: string;
  onToggleReady: () => void;
  onStart: () => void;
  onBeginSolo: () => void;
  onRemoveCharacter: () => void;
  onDelete: () => void;
  dmCandidates: Pick<CampaignMember, "userId" | "username">[];
  onPlayAsCharacter?: (userId: string) => void;
}) {
  const { t, locale } = useI18n();
  const [nextDm, setNextDm] = useState("");
  return (
    <section className="mb-6 space-y-3" aria-label={localeText(locale, { en: "Your seat and readiness", ru: "Ваше место и готовность" })}>
      {isDm ? (
        <div className={cn(ui.card, "flex flex-col items-center gap-3 p-4 text-center")}>
          <p className="font-display text-lg tracking-wide text-amber-50">
            {localeText(locale, { en: "Your seat: Dungeon Master", ru: "Ваше место: Мастер" })}
          </p>
          <p className="max-w-sm text-balance text-sm text-stone-400">
            {localeText(locale, { en: "The DM runs the game and does not need to ready up. To play a hero, hand this seat to another member first.", ru: "Мастер ведёт игру; готовность для него не требуется. Чтобы играть героем, сначала передайте это место другому участнику." })}
          </p>
          {onPlayAsCharacter ? (
            <div className="w-full space-y-2 border-t border-stone-800 pt-3 text-left">
              <label className="block text-xs text-stone-400">
                {localeText(locale, { en: "Who will be the DM?", ru: "Кто будет Мастером?" })}
                <select value={nextDm} onChange={event => setNextDm(event.target.value)} disabled={busy} className={cn(ui.input, "mt-1 w-full")}>
                  <option value="">{localeText(locale, { en: "Choose a member without a character", ru: "Выберите участника без персонажа" })}</option>
                  {dmCandidates.map(member => <option key={member.userId} value={member.userId}>{member.username}</option>)}
                </select>
              </label>
              <button type="button" disabled={busy || !dmCandidates.some(member => member.userId === nextDm)} onClick={() => onPlayAsCharacter(nextDm)} className={cn(ui.btnSecondary, "w-full")}>
                <UserRound className="size-4" /> {localeText(locale, { en: "Hand over the seat and choose a character", ru: "Передать роль и выбрать персонажа" })}
              </button>
            </div>
          ) : null}
        </div>
      ) : !mySheet ? (
        <div className={cn(ui.card, "flex flex-col gap-3 p-4")}>
          <p className="max-w-sm text-balance font-display text-xl tracking-wide text-amber-50">
            {localeText(locale, { en: "Choose a hero before the adventure starts", ru: "Выберите героя до начала приключения" })}
          </p>
          <Link href={`/campaigns/${campaign.id}/character`} className={cn(ui.btnPrimary, "w-full")}>
            <UserRound className="size-4" /> {localeText(locale, { en: "Choose from your library", ru: "Выбрать из библиотеки" })}
          </Link>
          <Link href={`/campaigns/${campaign.id}/character?mode=create`} className={cn(ui.btnSecondary, "w-full")}>
            {localeText(locale, { en: "Create a new character", ru: "Создать нового персонажа" })}
          </Link>
        </div>
      ) : (
        <>
          <CharacterActions
            campaignId={campaign.id}
            sheet={mySheet}
            busy={busy}
            onRemove={onRemoveCharacter}
          />
          {isSolo ? (
            <button
              type="button"
              onClick={onBeginSolo}
              disabled={busy}
              className={cn(ui.btnPrimary, "w-full py-2.5")}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
              {t("campaign.startCampaign")}
            </button>
          ) : (
            <button
              type="button"
              onClick={onToggleReady}
              disabled={busy}
              className={cn(
                "flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2.5 font-medium transition-colors disabled:opacity-60",
                myMember?.ready
                  ? "border border-stone-700 text-stone-300 hover:bg-stone-900"
                  : "border border-emerald-500/40 bg-emerald-700 text-emerald-50 hover:bg-emerald-600",
              )}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              {myMember?.ready ? t("common.notReady") : t("common.ready")}
            </button>
          )}
          <p className="text-center text-xs text-stone-600">
            {localeText(locale, { en: "Changing your character clears your ready status.", ru: "Смена персонажа сбрасывает статус готовности." })}
          </p>
        </>
      )}

      {isSolo ? null : (
        <StartBlock canStart={canStart} busy={busy} blocker={startBlocker} onStart={onStart} />
      )}
      {error ? <p role="alert" className="text-center text-sm text-red-400">{error}</p> : null}

      {isOwner ? (
        <details className="text-center text-xs text-stone-500">
          <summary className="cursor-pointer">{localeText(locale, { en: "Manage campaign", ru: "Управление кампанией" })}</summary>
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className="mx-auto flex items-center gap-1.5 pt-2 text-xs text-stone-600 transition-colors hover:text-red-400 disabled:opacity-60"
          >
            <Trash2 className="size-3.5" /> {localeText(locale, { en: "Delete this campaign", ru: "Удалить эту кампанию" })}
          </button>
        </details>
      ) : null}
    </section>
  );
}
