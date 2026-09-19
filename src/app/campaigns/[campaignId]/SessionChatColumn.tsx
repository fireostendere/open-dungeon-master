"use client";
import type { ComponentProps } from "react";
import { SessionChatColumn as LegacySessionChatColumn } from "./LegacySessionChatColumn";
import { LocationChat } from "./LocationChat";
import { useLocationChat } from "./useLocationChat";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";
import { cn } from "@/lib/cn";

// Keep the established table unchanged until its DM explicitly enables the
// location ledger. Switching is a server fact, not a local UI preference.
export function SessionChatColumn(props: ComponentProps<typeof LegacySessionChatColumn>) {
  const chat = useLocationChat(props.campaignId, props.meUserId);
  const { locale } = useI18n();
  const t = localeText(locale, {
    en: { enable: "Enable location chats", start: "Starting location", loading: "Loading location permissions…", retry: "Retry", history: "Shared mechanics, Ask and earlier story", note: "Text scenes for a human DM or external MCP narrator. Rolls, combat, facts and other legacy game projections are still shared, not location-private." },
    ru: { enable: "Включить чаты локаций", start: "Начальная локация", loading: "Загрузка доступа к локациям…", retry: "Повторить", history: "Общие механики, Ask и прежняя история", note: "Текстовые сцены для ведущего или внешнего MCP-рассказчика. Броски, бой, факты и другие старые игровые представления пока общие, а не приватные по локациям." },
    pl: { enable: "Włącz czaty lokacji", start: "Lokacja początkowa", loading: "Ładowanie uprawnień lokacji…", retry: "Ponów", history: "Wspólne mechaniki, Ask i wcześniejsza historia", note: "Sceny tekstowe dla MG lub narratora MCP. Rzuty, walka, fakty i inne starsze widoki gry są nadal wspólne, a nie prywatne dla lokacji." },
  });
  if (chat.loading) return <div className="flex-1 p-4 text-sm text-stone-400"><p>{chat.error || t.loading}</p>
    {chat.error ? <button type="button" onClick={chat.refresh}>{t.retry}</button> : null}</div>;
  const view = chat.view;
  if (view?.enabled) return <div className={cn("min-w-0 flex-1 flex-col overflow-y-auto", props.visible ? "flex" : "hidden lg:flex")}>
    <LocationChat chat={chat} members={props.state.members} dmUserId={props.state.campaign?.dmUserId} />
    <details className="m-3 min-h-0 rounded border border-stone-800 p-2 text-sm text-stone-400"><summary>{t.history}</summary>
      <p className="my-2 text-xs">{t.note}</p>
      <LegacySessionChatColumn {...props}>{null}</LegacySessionChatColumn>
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
