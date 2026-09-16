"use client";

import { useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useI18n, type Locale } from "@/lib/i18n";
import { MessageList } from "@/app/campaigns/[campaignId]/MessageList";
import { ReportDialog, type ReportTarget } from "@/app/campaigns/[campaignId]/ReportDialog";
import { ItemProposalBar } from "@/app/campaigns/[campaignId]/ItemProposalBar";
import { UtilityCallStrip } from "@/app/campaigns/[campaignId]/UtilityCallStrip";
import { AskDock } from "@/app/campaigns/[campaignId]/AskPanel";
import { DmCoverNotice } from "@/app/campaigns/[campaignId]/DmDelegationPanel";
import type { NarrationAudio } from "@/app/campaigns/[campaignId]/useNarrationAudio";
import type { CampaignState } from "@/app/campaigns/[campaignId]/useCampaignStream";
import type { CampaignMessage } from "@/lib/db/messages";

const fallbackCopy = {
  en: { dm: "the Dungeon Master", player: "this player", tts: "Could not read that passage aloud.", continue: "Could not continue the scene.", switchTake: "Could not switch takes.", saveEdit: "Could not save that edit.", pin: "Could not pin that." },
  ru: { dm: "ведущего", player: "этого игрока", tts: "Не удалось озвучить этот фрагмент.", continue: "Не удалось продолжить сцену.", switchTake: "Не удалось переключить вариант повествования.", saveEdit: "Не удалось сохранить правку.", pin: "Не удалось закрепить этот фрагмент." },
  pl: { dm: "Mistrza Gry", player: "tego gracza", tts: "Nie udało się odczytać tego fragmentu na głos.", continue: "Nie udało się kontynuować sceny.", switchTake: "Nie udało się przełączyć wariantu narracji.", saveEdit: "Nie udało się zapisać zmiany.", pin: "Nie udało się przypiąć tego fragmentu." },
} satisfies Record<Locale, Record<string, string>>;

export function SessionChatColumn({
  state,
  campaignId,
  meUserId,
  steersStory,
  narration,
  visible,
  askOpen,
  onAskOpenChange,
  refreshAsks,
  refreshFacts,
  onError,
  onLoreCheck,
  onRenarrate,
  onPinned,
  children,
}: {
  state: CampaignState;
  campaignId: string;
  meUserId: string;
  steersStory: boolean;
  narration: NarrationAudio;
  visible: boolean;
  askOpen: boolean;
  onAskOpenChange: (open: boolean) => void;
  refreshAsks: () => Promise<void>;
  refreshFacts: () => Promise<void>;
  onError: (message: string) => void;
  onLoreCheck: (message: CampaignMessage, selection: string) => void;
  onRenarrate: (message: CampaignMessage) => void;
  onPinned: () => void;
  children: ReactNode;
}) {
  const { locale } = useI18n();
  const text = fallbackCopy[locale];
  const { campaign, messages, rolls, sheets, locations, dmStatus, dmDraft, utilityCalls } = state;
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const [justBlocked, setJustBlocked] = useState<string[]>([]);
  const blockedUserIds = useMemo(
    () => [...new Set([...state.blockedUserIds, ...justBlocked])],
    [state.blockedUserIds, justBlocked],
  );
  const ttsEnabled = Boolean(campaign?.gameSettings?.ttsEnabled);
  const visibleUtilityCalls = utilityCalls.filter((call) => call.kind !== "ask");

  return (
    <div className={cn("min-w-0 flex-1 flex-col", visible ? "flex" : "hidden lg:flex")}>
      <ReportDialog
        campaignId={campaignId}
        target={reportTarget}
        onClose={() => setReportTarget(null)}
        onBlocked={(userId) => setJustBlocked((current) => [...current, userId])}
      />
      <MessageList
        messages={messages}
        campaignId={campaignId}
        canRetryTurn={steersStory}
        canIllustrate={steersStory}
        rolls={rolls}
        sheets={sheets}
        members={state.members}
        meUserId={meUserId}
        blockedUserIds={blockedUserIds}
        onReport={(message) => {
          if (message.authorType === "dm") {
            setReportTarget({ messageId: message.id, authorType: "dm", label: text.dm });
            return;
          }
          const sheet = sheets.find((entry) => entry.id === message.characterId) ?? sheets.find((entry) => entry.userId === message.userId);
          const member = state.members.find((entry) => entry.userId === message.userId);
          setReportTarget({
            messageId: message.id,
            userId: message.userId ?? undefined,
            authorType: "player",
            label: sheet?.name ?? member?.username ?? text.player,
          });
        }}
        locations={locations}
        dmStatus={dmStatus}
        dmDraft={dmDraft}
        mediaStatus={state.mediaStatus}
        onReplayAudio={
          ttsEnabled
            ? async (messageId) => {
                narration.unlock();
                const known = state.narrationAudio[messageId];
                if (known) {
                  narration.play(messageId, known);
                  return null;
                }
                const response = await fetch(`/api/campaigns/${campaignId}/messages/${messageId}/narrate`, { method: "POST" });
                if (!response.ok) {
                  const data = await response.json().catch(() => ({}));
                  return data.error || text.tts;
                }
                const data = await response.json();
                narration.play(messageId, data.url);
                return null;
              }
            : undefined
        }
        onLoreCheck={(message) => {
          const selection = window.getSelection()?.toString().trim() ?? "";
          onLoreCheck(message, selection.length > 3 ? selection : "");
        }}
        onRenarrate={steersStory ? onRenarrate : undefined}
        onContinueScene={
          steersStory
            ? async (message) => {
                const response = await fetch(`/api/campaigns/${campaignId}/messages/${message.id}/continue`, { method: "POST" });
                if (!response.ok) {
                  const data = await response.json().catch(() => ({}));
                  onError(data.error || text.continue);
                }
              }
            : undefined
        }
        onSelectVariant={
          steersStory
            ? async (message, index) => {
                const response = await fetch(`/api/campaigns/${campaignId}/messages/${message.id}/renarrate`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "select", index }),
                });
                if (!response.ok) {
                  const data = await response.json().catch(() => ({}));
                  onError(data.error || text.switchTake);
                }
              }
            : undefined
        }
        onEditSave={
          steersStory
            ? async (message, content) => {
                const response = await fetch(`/api/campaigns/${campaignId}/messages/${message.id}/edit`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ content }),
                });
                if (!response.ok) {
                  const data = await response.json().catch(() => ({}));
                  return data.error || text.saveEdit;
                }
                return null;
              }
            : undefined
        }
        onPinMemory={async (message) => {
          const selection = window.getSelection()?.toString().trim() ?? "";
          const isFullMessage = selection.length <= 3;
          const response = await fetch(`/api/campaigns/${campaignId}/pins`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messageId: message.id, text: isFullMessage ? message.content : selection, isFullMessage }),
          });
          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            onError(data.error || text.pin);
            return;
          }
          onPinned();
        }}
        onPinCanon={
          steersStory
            ? async (message) => {
                const selection = window.getSelection()?.toString().trim() ?? "";
                const excerpt = (selection.length > 3 ? selection : message.content).trim().slice(0, 300);
                if (!excerpt) return;
                await fetch(`/api/campaigns/${campaignId}/facts`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ category: "lore", subject: "", fact: excerpt, sourceSeq: message.seq }),
                });
                await refreshFacts();
              }
            : undefined
        }
      />

      <ItemProposalBar campaignId={campaignId} proposals={state.itemProposals} sheets={sheets} meUserId={meUserId} steersStory={steersStory} />
      <AskDock campaignId={campaignId} asks={state.asks} meUserId={meUserId} loaded={state.asksLoaded} open={askOpen} onOpenChange={onAskOpenChange} onAsked={refreshAsks} />
      <UtilityCallStrip calls={visibleUtilityCalls} />
      <DmCoverNotice cover={campaign?.dmCover ?? null} />
      {children}
    </div>
  );
}
