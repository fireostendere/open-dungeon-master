"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  BookUser,
  Crown,
  Flag,
  MessageSquare,
  MoreVertical,
  Pencil,
  ShieldBan,
  StickyNote,
  UserMinus,
  Volume2,
  VolumeX,
  Wrench,
} from "lucide-react";
import { useState } from "react";
import { Tooltip } from "@/components/ui/Tooltip";
import { ReportDialog, type ReportTarget } from "@/app/campaigns/[campaignId]/ReportDialog";
import { useI18n } from "@/lib/i18n";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const COPY = {
  en: {
    options: (name: string) => `Options for ${name}: sheet, notes, message and more`,
    viewSheet: "View sheet",
    notes: "Notes",
    message: "Message",
    editBackstory: "Edit backstory",
    adjustStats: "Adjust stats",
    makeLead: "Make party lead",
    dismissCompanion: "Dismiss companion",
    unmute: "Unmute player",
    mute: "Mute player",
    report: "Report player",
    block: "Block player",
  },
  ru: {
    options: (name: string) => `Действия для ${name}: лист, заметки, сообщение и другое`,
    viewSheet: "Открыть лист",
    notes: "Заметки",
    message: "Сообщение",
    editBackstory: "Редактировать предысторию",
    adjustStats: "Изменить характеристики",
    makeLead: "Сделать лидером группы",
    dismissCompanion: "Отпустить спутника",
    unmute: "Включить звук игрока",
    mute: "Заглушить игрока",
    report: "Пожаловаться на игрока",
    block: "Заблокировать игрока",
  },
  pl: {
    options: (name: string) => `Opcje dla ${name}: karta, notatki, wiadomość i więcej`,
    viewSheet: "Otwórz kartę",
    notes: "Notatki",
    message: "Wiadomość",
    editBackstory: "Edytuj historię",
    adjustStats: "Dostosuj statystyki",
    makeLead: "Ustaw jako lidera drużyny",
    dismissCompanion: "Odpraw towarzysza",
    unmute: "Włącz dźwięk gracza",
    mute: "Wycisz gracza",
    report: "Zgłoś gracza",
    block: "Zablokuj gracza",
  },
} as const;

// Per-character options menu on each party card: sheet, notes, private
// message, and the lead-only corrections and lead transfer.
export function CharacterMenu({
  sheet,
  steersStory,
  mine = false,
  leadUserId,
  canTransferLead,
  onViewSheet,
  onNotes,
  onAdjust,
  onEditBackstory,
  onMessage,
  canModerate = false,
  canMute = false,
  muted = false,
}: {
  sheet: CharacterSheet;
  steersStory: boolean;
  mine?: boolean;
  leadUserId: string;
  canTransferLead: boolean;
  onViewSheet: () => void;
  onNotes: () => void;
  onAdjust: () => void;
  onEditBackstory?: () => void;
  onMessage?: () => void;
  canModerate?: boolean;
  canMute?: boolean;
  muted?: boolean;
}) {
  const { locale } = useI18n();
  const copy = COPY[locale];
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);

  const item =
    "flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-stone-300 outline-none data-[highlighted]:bg-stone-800";

  const defer = (action: () => void) => (event: Event) => {
    event.preventDefault();
    setTimeout(action, 0);
  };

  async function makeLead() {
    await fetch(`/api/campaigns/${sheet.campaignId}/lead`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: sheet.userId }),
    });
  }

  async function setMuted(next: boolean) {
    await fetch(`/api/campaigns/${sheet.campaignId}/mute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: sheet.userId, muted: next }),
    });
  }

  async function dismissCompanion() {
    await fetch(`/api/campaigns/${sheet.campaignId}/companions/${sheet.id}`, {
      method: "DELETE",
    });
  }

  const optionsLabel = copy.options(sheet.name);

  return (
    <DropdownMenu.Root>
      <Tooltip content={optionsLabel}>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            aria-label={optionsLabel}
            className="rounded p-1 text-stone-500 hover:bg-stone-900 hover:text-stone-300"
          >
            <MoreVertical className="size-3.5" />
          </button>
        </DropdownMenu.Trigger>
      </Tooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="panel z-50 min-w-40 rounded-lg p-1"
        >
          <DropdownMenu.Item className={item} onSelect={defer(onViewSheet)}>
            <BookUser className="size-3.5 text-stone-500" /> {copy.viewSheet}
          </DropdownMenu.Item>
          <DropdownMenu.Item className={item} onSelect={defer(onNotes)}>
            <StickyNote className="size-3.5 text-stone-500" /> {copy.notes}
          </DropdownMenu.Item>
          {onMessage ? (
            <DropdownMenu.Item className={item} onSelect={defer(onMessage)}>
              <MessageSquare className="size-3.5 text-stone-500" /> {copy.message}
            </DropdownMenu.Item>
          ) : null}
          {mine && onEditBackstory ? (
            <DropdownMenu.Item className={item} onSelect={defer(onEditBackstory)}>
              <Pencil className="size-3.5 text-stone-500" /> {copy.editBackstory}
            </DropdownMenu.Item>
          ) : null}
          {steersStory ? (
            <DropdownMenu.Item className={item} onSelect={defer(onAdjust)}>
              <Wrench className="size-3.5 text-stone-500" /> {copy.adjustStats}
            </DropdownMenu.Item>
          ) : null}
          {canTransferLead && sheet.userId !== leadUserId && !sheet.isCompanion ? (
            <DropdownMenu.Item className={item} onSelect={makeLead}>
              <Crown className="size-3.5 text-amber-400" /> {copy.makeLead}
            </DropdownMenu.Item>
          ) : null}
          {steersStory && sheet.isCompanion ? (
            <DropdownMenu.Item className={item} onSelect={dismissCompanion}>
              <UserMinus className="size-3.5 text-red-400" /> {copy.dismissCompanion}
            </DropdownMenu.Item>
          ) : null}
          {canMute ? (
            <DropdownMenu.Item className={item} onSelect={() => setMuted(!muted)}>
              {muted ? (
                <>
                  <Volume2 className="size-3.5 text-stone-500" /> {copy.unmute}
                </>
              ) : (
                <>
                  <VolumeX className="size-3.5 text-orange-400" /> {copy.mute}
                </>
              )}
            </DropdownMenu.Item>
          ) : null}
          {canModerate ? (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-stone-800" />
              <DropdownMenu.Item
                className={item}
                onSelect={defer(() =>
                  setReportTarget({ userId: sheet.userId, authorType: "player", label: sheet.name }),
                )}
              >
                <Flag className="size-3.5 text-amber-400" /> {copy.report}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className={item}
                onSelect={defer(() =>
                  setReportTarget({
                    userId: sheet.userId,
                    authorType: "player",
                    label: sheet.name,
                    mode: "block",
                  }),
                )}
              >
                <ShieldBan className="size-3.5 text-red-400" /> {copy.block}
              </DropdownMenu.Item>
            </>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
      {canModerate ? (
        <ReportDialog
          campaignId={sheet.campaignId}
          target={reportTarget}
          onClose={() => setReportTarget(null)}
        />
      ) : null}
    </DropdownMenu.Root>
  );
}
