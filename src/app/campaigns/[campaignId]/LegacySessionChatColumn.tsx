"use client";

import { useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { sessionText, type SessionTextKey } from "@/lib/i18n/session-text";
import { sessionRequest } from "@/lib/i18n/session-request";
import { MessageList } from "@/app/campaigns/[campaignId]/MessageList";
import { ReportDialog, type ReportTarget } from "@/app/campaigns/[campaignId]/ReportDialog";
import { ItemProposalBar } from "@/app/campaigns/[campaignId]/ItemProposalBar";
import { UtilityCallStrip } from "@/app/campaigns/[campaignId]/UtilityCallStrip";
import { DmCoverNotice } from "@/app/campaigns/[campaignId]/DmDelegationPanel";
import { NarrationLanguageSetting } from "@/app/campaigns/[campaignId]/NarrationLanguageSetting";
import { ClosingMessageBanner } from "@/app/campaigns/[campaignId]/ClosingMessageBanner";
import type { CampaignState } from "@/app/campaigns/[campaignId]/useCampaignStream";
import type { CampaignMessage } from "@/lib/db/messages";

// Message actions retain their authoritative routes and the original permission
// gates. Shared request handling localizes both HTTP and network failures.
export function SessionChatColumn({
  state, campaignId, meUserId, steersStory, visible,
  loadOlderMessages,
  refreshFacts, onError, onLoreCheck, onRenarrate, onPinned,
  onOpenClosingMessage, hasOpenedFinale, defaultMode, children,
}: {
  state: CampaignState;
  loadOlderMessages: () => Promise<boolean>;
  campaignId: string;
  meUserId: string;
  steersStory: boolean;
  visible: boolean;
  refreshAsks: () => Promise<void>;
  refreshFacts: () => Promise<void>;
  onError: (message: string) => void;
  onLoreCheck: (message: CampaignMessage, selection: string) => void;
  onRenarrate: (message: CampaignMessage) => void;
  onPinned: () => void;
  onOpenClosingMessage?: () => void;
  hasOpenedFinale?: boolean;
  defaultMode?: "victory" | "defeat";
  children: ReactNode;
}) {
  const { locale } = useI18n();
  const { campaign, messages, rolls, sheets, locations, dmStatus, dmDraft, utilityCalls } = state;
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const [justBlocked, setJustBlocked] = useState<string[]>([]);
  const blockedUserIds = useMemo(() => [...new Set([...state.blockedUserIds, ...justBlocked])], [state.blockedUserIds, justBlocked]);
  const visibleUtilityCalls = utilityCalls.filter(call => call.kind !== "ask");
  const selection = () => window.getSelection()?.toString().trim() ?? "";
  const errorText = (cause: unknown, fallback: SessionTextKey) => cause instanceof Error ? cause.message : sessionText(locale, fallback);
  const write = (suffix: string, fallback: SessionTextKey, body?: Record<string, unknown>) =>
    sessionRequest(locale, fallback, `/api/campaigns/${campaignId}/${suffix}`, {
      method: "POST", ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
  const reportWrite = async (suffix: string, fallback: SessionTextKey, body?: Record<string, unknown>) => {
    try { await write(suffix, fallback, body); return true; }
    catch (cause) { onError(errorText(cause, fallback)); return false; }
  };
  return (
    <div className={cn("min-w-0 flex-1 flex-col", visible ? "flex" : "hidden lg:flex")}>
      <ReportDialog campaignId={campaignId} target={reportTarget} onClose={() => setReportTarget(null)}
        onBlocked={userId => setJustBlocked(current => [...current, userId])} />
      <MessageList
        messages={messages} asks={state.asks} hasOlderMessages={state.hasOlderMessages} onLoadOlder={loadOlderMessages}
        campaignId={campaignId} canRetryTurn={steersStory} canIllustrate={steersStory}
        rolls={rolls} sheets={sheets} members={state.members} meUserId={meUserId} blockedUserIds={blockedUserIds}
        campaignStatus={campaign?.status} onOpenClosingMessage={onOpenClosingMessage}
        onReport={message => {
          if (message.authorType === "dm") {
            setReportTarget({ messageId: message.id, authorType: "dm", label: sessionText(locale, "dm") });
            return;
          }
          const sheet = sheets.find(entry => entry.id === message.characterId) ?? sheets.find(entry => entry.userId === message.userId);
          const member = state.members.find(entry => entry.userId === message.userId);
          setReportTarget({ messageId: message.id, userId: message.userId ?? undefined, authorType: "player",
            label: sheet?.name ?? member?.username ?? sessionText(locale, "player") });
        }}
        locations={locations} dmStatus={dmStatus} dmDraft={dmDraft} mediaStatus={state.mediaStatus}
        onLoreCheck={message => { const selected = selection(); onLoreCheck(message, selected.length > 3 ? selected : ""); }}
        onRenarrate={steersStory ? onRenarrate : undefined}
        onContinueScene={steersStory ? async message => { await reportWrite(`messages/${message.id}/continue`, "continueFailed"); } : undefined}
        onSelectVariant={steersStory ? async (message, index) => { await reportWrite(`messages/${message.id}/renarrate`, "variantFailed", { action: "select", index }); } : undefined}
        onEditSave={steersStory ? async (message, content) => {
          try { await write(`messages/${message.id}/edit`, "editFailed", { content }); return null; }
          catch (cause) { return errorText(cause, "editFailed"); }
        } : undefined}
        onPinMemory={async message => {
          const selected = selection();
          const isFullMessage = selected.length <= 3;
          if (await reportWrite("pins", "pinFailed", { messageId: message.id, text: isFullMessage ? message.content : selected, isFullMessage })) onPinned();
        }}
        onPinCanon={steersStory ? async message => {
          const selected = selection();
          const excerpt = (selected.length > 3 ? selected : message.content).trim().slice(0, 300);
          if (!excerpt) return;
          if (await reportWrite("facts", "canonFailed", { category: "lore", subject: "", fact: excerpt, sourceSeq: message.seq })) {
            try { await refreshFacts(); } catch { onError(sessionText(locale, "networkFailed")); }
          }
        } : undefined}
      />
      <ItemProposalBar campaignId={campaignId} proposals={state.itemProposals} sheets={sheets} meUserId={meUserId} steersStory={steersStory} />
      <UtilityCallStrip calls={visibleUtilityCalls} />
      <DmCoverNotice cover={campaign?.dmCover ?? null} />
      {steersStory && campaign ? <NarrationLanguageSetting key={campaignId} campaignId={campaignId} language={campaign.gameSettings.language} /> : null}
      {campaign?.status === "ended" ? (
        <ClosingMessageBanner
          campaignTitle={campaign.title}
          hasOpened={Boolean(hasOpenedFinale)}
          defaultMode={defaultMode}
          onOpenClosingMessage={onOpenClosingMessage ?? (() => {})}
        />
      ) : null}
      {children}
    </div>
  );
}
