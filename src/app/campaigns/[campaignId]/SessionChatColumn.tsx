"use client";
import { useEffect, type ComponentProps } from "react";
import { SessionChatColumn as LegacySessionChatColumn } from "./LegacySessionChatColumn";
import { LocationNotes } from "./LocationNotes";
import { LocationChat } from "./LocationChat";
import { useLocationChat } from "./useLocationChat";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";
import { cn } from "@/lib/cn";

// Keep the established table unchanged until its DM explicitly enables the
// location ledger. Switching is a server fact, not a local UI preference.
export function SessionChatColumn(props: ComponentProps<typeof LegacySessionChatColumn> & { refreshCampaign?: () => Promise<unknown> }) {
  const chat = useLocationChat(props.campaignId, props.meUserId, props.state.spatialEnabled);
  const { refreshCampaign } = props;
  const spatialState = chat.view?.enabled ? JSON.stringify([chat.view.current, chat.view.floor,
    chat.view.rooms, chat.view.stealth, chat.page.messages.at(-1)?.seq]) : null;
  useEffect(() => {
    if (spatialState) void refreshCampaign?.();
  }, [spatialState, refreshCampaign]);
  const { locale } = useI18n();
  const t = localeText(locale, {
    en: { enable: "Enable location chats", start: "Starting location", loading: "Loading location permissions…", retry: "Retry", history: "Shared mechanics and earlier story", note: "Text scenes for a human DM or external MCP narrator. Messages stay with their witnesses. Hidden and invisible actions go to their author and the DM; others receive only perceived consequences." },
    ru: { enable: "Включить чаты локаций", start: "Начальная локация", loading: "Загрузка доступа к локациям…", retry: "Повторить", history: "Общие механики и прежняя история", note: "Текстовые сцены для ведущего или внешнего MCP-рассказчика. Сообщения видят только свидетели. Скрытые и невидимые действия доступны автору и мастеру; остальные получают только воспринятые последствия." },
  });
  if (chat.loading) return <div className={cn("min-w-0 flex-1 p-4 text-sm text-stone-400", props.visible ? "block" : "hidden lg:block")}><p>{chat.error || t.loading}</p>
    {chat.error ? <button type="button" onClick={chat.refresh}>{t.retry}</button> : null}</div>;
  const view = chat.view;
  if (view?.enabled) return <div className={cn("min-h-0 min-w-0 flex-1 flex-col overflow-y-auto", props.visible ? "flex" : "hidden lg:flex")}>
    <LocationChat
      key={`${props.campaignId}:${props.meUserId}`}
      chat={chat}
      members={props.state.members}
      sheets={props.state.sheets}
      oocMessages={props.state.oocMessages.map(message => ({
        id: message.id,
        roomId: null,
        seq: message.seq,
        kind: "ooc" as const,
        authorUserId: message.userId,
        content: message.content.replace(/^\s*\(ooc\)\s*/i, ""),
        createdAt: message.createdAt,
      }))}
      asks={props.state.asks}
      refreshAsks={props.refreshAsks}
      dmUserId={props.state.campaign?.dmUserId}
      globalTurnEnabled={Boolean(props.state.campaign?.gameSettings?.globalTurn?.enabled)}
      globalTurnState={props.state.campaign?.globalTurnState ?? null}
    />
    {chat.selected && chat.selected !== "ooc" ? <LocationNotes
      key={`${props.campaignId}:${props.meUserId}:${chat.selected}`}
      campaignId={props.campaignId} userId={props.meUserId} roomId={chat.selected}
      active={view.current?.roomId === chat.selected} isDm={view.isDm} /> : null}
    <details className="m-3 shrink-0 rounded border border-stone-800 p-2 text-sm text-stone-400"><summary>{t.history}</summary>
      <p className="my-2 text-xs">{t.note}</p>
      <div className="flex h-[min(32rem,70dvh)] min-h-48 flex-col">
        <LegacySessionChatColumn {...props} showAsks={false} showOoc={false}>{null}</LegacySessionChatColumn>
      </div>
    </details>
  </div>;
  const mayEnable = props.state.caps?.role === "dm" && props.state.campaign?.gameSettings.dmMode === "human" && props.state.campaign.status === "active";
  return <LegacySessionChatColumn {...props}>
    {props.children}
    {mayEnable ? <div className="px-3 pb-2 text-xs text-stone-400"><p>{t.note}</p>
      <button type="button" className="mt-1 rounded border border-stone-700 px-2 py-1" disabled={chat.busy}
        onClick={() => void chat.command({ operation: "enable", name: t.start })}>{t.enable}</button>
      {chat.error ? <p role="alert">{chat.error}</p> : null}
      {chat.pending ? <button type="button" disabled={chat.busy} onClick={() => void chat.retry()}>{t.retry}</button> : null}
    </div> : null}
  </LegacySessionChatColumn>;
}
