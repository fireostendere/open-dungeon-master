"use client";

import {
  BookOpen, Crown, Gavel, Map as MapIcon, MessageSquareText, MessagesSquare,
  Gauge, Settings2, StickyNote, Swords, Users, MoreHorizontal, type LucideIcon,
} from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { Sheet } from "@/components/ui/Sheet";
import type { PlayerMapView } from "@/lib/battlemap/view";
import { visiblePanelTabs, type TableTabId, type TableTabInput } from "@/lib/dm/table-tabs";
import { useI18n, type Locale } from "@/lib/i18n";
import { mobileTabIds } from "./session-mobile";
import { useSessionMobile, useSessionReading } from "./SessionViewport";

export type PanelTab = TableTabId;
export type PanelTabDef = [PanelTab, string, LucideIcon, string];
export type StorySection = "story" | "facts" | "log";
export type PartySection = "party" | "bonds";
export type SubTabDef<T extends string> = [T, string, LucideIcon];
export type MobileView = "chat" | "panel";

export function SubTabs<T extends string>({ tabs, value, onChange }: {
  tabs: SubTabDef<T>[]; value: T; onChange: (next: T) => void;
}) {
  return <div className="mb-3 flex flex-wrap items-center gap-1.5">
    {tabs.map(([option, label, Icon]) => <button key={option} type="button" onClick={() => onChange(option)}
      className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors",
        value === option ? "border-amber-700 bg-amber-950/40 text-amber-200" : "border-stone-700 text-stone-400 hover:text-stone-200")}>
      <Icon className="size-3" />{label}
    </button>)}
  </div>;
}

const TAB_PRESENTATION: Record<Locale, Record<PanelTab, [string, LucideIcon, string]>> = {
  en: {
    dm: ["DM", Gavel, "Everything waiting on you, and every ruling the engine can make on your say-so."],
    lead: ["Lead", Crown, "Steer the table: the floor, notes waiting on you, invites and the lead seat."],
    party: ["Party", Users, "Character sheets, HP and conditions for the whole party, and their bonds with the people they have met."],
    battle: ["Battle", Swords, "Combat overview, your turn, enemy roster and combat log."],
    map: ["Map", MapIcon, "The scene map and discovered locations."],
    story: ["Story", BookOpen, "Chapters and the tale so far, the world-state record, and the audited log of rolls and stat changes."],
    notes: ["Notes", StickyNote, "Suggest story notes; the party lead approves them."],
    chat: ["Chat", MessagesSquare, "Side chat between players. The DM does not see it."],
    context: ["Context", Gauge, "What the DM was actually sent last turn, and anything the budget cut."],
    settings: ["Setup", Settings2, "Campaign settings, invites and game toggles."],
  },
  ru: {
    dm: ["Мастер", Gavel, "Всё, что ждет ваших решений, и возможности движка."],
    lead: ["Лидер", Crown, "Управление столом: право слова, заметки, приглашения и место лидера."],
    party: ["Отряд", Users, "Листы персонажей, HP и состояния отряда, а также связи с NPC."],
    battle: ["Бой", Swords, "Управление боем, ваш ход, список врагов и журнал боя."],
    map: ["Карта", MapIcon, "Карта сцены и открытые локации."],
    story: ["Сюжет", BookOpen, "Главы и история, состояние мира и журнал бросков."],
    notes: ["Заметки", StickyNote, "Предлагайте сюжетные заметки; лидер отряда утверждает их."],
    chat: ["Чат", MessagesSquare, "Шёпот между игроками. Мастер его не видит."],
    context: ["Контекст", Gauge, "Что было отправлено Мастеру на прошлом ходу."],
    settings: ["Настройки", Settings2, "Настройки кампании, приглашения и переключатели."],
  },
};

export function buildPanelTabs(input: TableTabInput, locale: Locale = "ru"): PanelTabDef[] {
  const dict = TAB_PRESENTATION[locale] ?? TAB_PRESENTATION.ru;
  return visiblePanelTabs(input).map(id => [id, ...dict[id]]);
}
export function tabAccentClass(tab: PanelTab, active: boolean): string {
  if (!active) return "";
  return tab === "lead" ? ui.railCellActiveEmber : ui.railCellActive;
}
export function tabBadgeClass(tab: PanelTab): string {
  return cn("absolute right-1.5 top-1 rounded-full bg-gradient-to-b px-1 text-[9px] font-semibold",
    tab === "lead" ? "from-ember-300 to-ember-500 text-stone-950 shadow-glow-ember"
      : "from-amber-300 to-amber-500 text-amber-950 shadow-glow-gold");
}

// The game-driven selection rules remain shared with the desktop SidePanel.
export function useSessionTabs({ chatTarget, battleMap, isLead }: {
  chatTarget: string | null; battleMap?: PlayerMapView | null; isLead: boolean;
}) {
  const [panelTab, setPanelTab] = useState<PanelTab>("party");
  const [mobileView, setMobileView] = useState<MobileView>("chat");
  const [seenChatTarget, setSeenChatTarget] = useState<string | null>(null);
  if (chatTarget && chatTarget !== seenChatTarget) {
    setSeenChatTarget(chatTarget); setPanelTab("chat"); setMobileView("panel");
  }
  const [seenMapId, setSeenMapId] = useState<string | null>(null);
  if (battleMap && battleMap.mapId !== seenMapId) {
    setSeenMapId(battleMap.mapId); setPanelTab("battle"); setMobileView("panel");
  }
  if (!battleMap && panelTab === "battle") setPanelTab("party");
  if (!isLead && panelTab === "lead") setPanelTab("party");
  return { panelTab, setPanelTab, mobileView, setMobileView };
}

function BottomTabBarInner({ tabs, mobileView, panelTab, onSelectChat, onSelectPanel, chatUnread, pendingCount, storyDue, steersStory }: {
  tabs: PanelTabDef[]; mobileView: MobileView; panelTab: PanelTab;
  onSelectChat: () => void; onSelectPanel: (tab: PanelTab) => void;
  chatUnread: number; pendingCount: number; storyDue: boolean; steersStory: boolean;
}) {
  const { locale } = useI18n();
  const mobile = useSessionMobile();
  const { reading, setReading } = useSessionReading();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const primaryIds = mobileTabIds(tabs.map(([id]) => id));
  const primary = primaryIds.map(id => tabs.find(([value]) => value === id)!);
  const overflow = tabs.filter(([id]) => !primaryIds.includes(id));
  const overflowActive = mobileView === "panel" && overflow.some(([id]) => id === panelTab);
  const selectedOverflow = overflow.find(([id]) => id === panelTab);
  const moreLabel = locale === "ru" ? "Ещё" : "More";
  const moreTitle = locale === "ru" ? "Разделы стола" : "Table sections";
  const overflowAttention = overflow.some(([id]) => (id === "dm" && storyDue)
    || ((id === "notes" || (id === "lead" && steersStory)) && pendingCount > 0));
  const closeMore = (open: boolean) => {
    setMoreOpen(open);
    if (!open) requestAnimationFrame(() => moreRef.current?.focus({ preventScroll: true }));
  };
  // A server-driven jump to a battle/chat panel must never leave an invisible
  // reading-mode overlay trapping the player in that panel.
  useEffect(() => { if (reading && mobileView !== "chat") setReading(false); }, [reading, mobileView, setReading]);
  const badge = (value: PanelTab) => {
    const count = value === "chat" ? chatUnread : value === "notes" || (value === "lead" && steersStory) ? pendingCount : 0;
    return count > 0 ? <span className="session-nav-badge">{count > 99 ? "99+" : count}</span>
      : value === "dm" && storyDue ? <span className="session-nav-dot" /> : null;
  };
  return <>
    <nav className="session-bottom-nav glass lg:hidden" aria-label={locale === "ru" ? "Навигация по столу" : "Table navigation"}>
      <button type="button" onClick={onSelectChat} aria-current={mobileView === "chat" ? "page" : undefined}>
        <MessageSquareText className="size-5" /><span>{locale === "ru" ? "Стол" : "Table"}</span>
      </button>
      {primary.map(([value, label, Icon]) => <button key={value} type="button" onClick={() => onSelectPanel(value)} data-tour={`tab-${value}`}
        aria-current={mobileView === "panel" && panelTab === value ? "page" : undefined}>
        <Icon className="size-5" /><span>{label}</span>{badge(value)}
      </button>)}
      {overflow.length ? <button ref={moreRef} type="button" onClick={() => closeMore(true)} aria-label={moreTitle}
        aria-expanded={moreOpen && mobile} aria-haspopup="dialog" aria-current={overflowActive ? "page" : undefined}>
        <MoreHorizontal className="size-5" /><span>{overflowActive ? selectedOverflow?.[1] : moreLabel}</span>
        {overflowAttention ? <span className="session-nav-dot" /> : null}
      </button> : null}
    </nav>
    <Sheet open={moreOpen && mobile} onOpenChange={closeMore} title={moreTitle} className="session-menu">
      <div className="session-menu-list">
        {overflow.map(([value, label, Icon, tip]) => <button key={value} type="button" data-tour={`tab-${value}`}
          aria-current={mobileView === "panel" && panelTab === value ? "page" : undefined}
          onClick={() => { closeMore(false); onSelectPanel(value); }}>
          <Icon className="size-5 shrink-0" /><span className="min-w-0 flex-1"><strong className="block font-medium">{label}</strong><small className="block text-stone-400">{tip}</small></span>{badge(value)}
        </button>)}
      </div>
    </Sheet>
  </>;
}
export const BottomTabBar = memo(BottomTabBarInner);
