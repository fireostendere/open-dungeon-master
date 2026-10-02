"use client";

import { MoreHorizontal, type LucideIcon } from "lucide-react";
import { memo, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import type { PlayerMapView } from "@/lib/battlemap/view";
import {
  visiblePanelTabs,
  type TableTabId,
  type TableTabInput,
} from "@/lib/dm/table-tabs";
import type { Locale } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";
import { Sheet } from "@/components/ui/Sheet";
import { GameIcon } from "@/components/ui/GameIcon";
import { SUBTAB_GLYPHS, TABLE_GLYPH, TAB_GLYPHS, paintedRailIcon } from "@/app/campaigns/[campaignId]/SessionGlyph";

// The id list is owned by src/lib/dm/table-tabs.ts, where the visibility
// rules are testable without React; this alias keeps the name the rest of
// the session code has always used.
export type PanelTab = TableTabId;

export type PanelTabDef = [PanelTab, string, LucideIcon, string];

// Second-level navigation inside a single tab. Facts and the audited log are
// both records of what the story has already made true, so they live under
// Story; bonds are grouped per character exactly like the roster, so they
// live under Party. Keeping them here rather than in the rail is what stops
// the header overflowing in a 320px panel.
export type StorySection = "story" | "facts" | "log";
export type PartySection = "party" | "bonds";

export type SubTabDef<T extends string> = [T, string, LucideIcon];

// The shared secondary row, deliberately quieter than the main rail: pills
// rather than the rail's icon-over-label cells, so it never reads as a second
// set of top-level tabs.
export function SubTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: SubTabDef<T>[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      {tabs.map(([option, label, Icon]) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors",
            value === option
              ? "border-amber-700 bg-amber-950/40 text-amber-200"
              : "border-stone-700 text-stone-400 hover:text-stone-200",
          )}
        >
          {/* A painting where the section has one; otherwise the line icon
              the panel passed. */}
          {SUBTAB_GLYPHS[option] ? (
            <GameIcon icon={{ kind: "glyph", key: SUBTAB_GLYPHS[option] }} size="size-5" className="-my-0.5 -ml-1" />
          ) : (
            <Icon className="size-3" />
          )}
          {label}
        </button>
      ))}
    </div>
  );
}

// Which of the two session columns is visible below the lg breakpoint. On
// desktop both render side by side and this state has no visual effect.
export type MobileView = "chat" | "panel";

// One painted rail icon per tab, built once at module scope so each keeps a
// stable component identity across renders.
const RAIL_ICONS = Object.fromEntries(
  Object.entries(TAB_GLYPHS).map(([tab, glyph]) => [tab, paintedRailIcon(glyph)]),
) as Record<PanelTab, LucideIcon>;
const TableIcon = paintedRailIcon(TABLE_GLYPH);

// Label, icon and rail tooltip per tab. Presentation only: which of these
// a given viewer sees, and in what order, is visiblePanelTabs's decision.
const TAB_PRESENTATION: Record<Locale, Record<PanelTab, [string, LucideIcon, string]>> = {
  en: {
    dm: [
      "DM",
      RAIL_ICONS.dm,
      "Everything waiting on you, and every ruling the engine can make on your say-so.",
    ],
    lead: [
      "Lead",
      RAIL_ICONS.lead,
      "Steer the table: the floor, notes waiting on you, invites and the lead seat.",
    ],
    party: [
      "Party",
      RAIL_ICONS.party,
      "Character sheets, HP and conditions for the whole party, and their bonds with the people they have met.",
    ],
    battle: ["Battle", RAIL_ICONS.battle, "Combat overview, your turn, enemy roster and combat log."],
    map: ["Map", RAIL_ICONS.map, "The scene map and discovered locations."],
    story: [
      "Story",
      RAIL_ICONS.story,
      "Chapters and the tale so far, the world-state record, and the audited log of rolls and stat changes.",
    ],
    notes: ["Notes", RAIL_ICONS.notes, "Suggest story notes; the party lead approves them."],
    chat: ["Chat", RAIL_ICONS.chat, "Side chat between players. The DM does not see it."],
    context: [
      "Context",
      RAIL_ICONS.context,
      "What the DM was actually sent last turn, and anything the budget cut.",
    ],
    settings: ["Setup", RAIL_ICONS.settings, "Campaign settings, invites and game toggles."],
  },
  ru: {
    dm: [
      "Мастер",
      RAIL_ICONS.dm,
      "Всё, что ждет ваших решений, и возможности движка.",
    ],
    lead: [
      "Лидер",
      RAIL_ICONS.lead,
      "Управление столом: право слова, заметки, приглашения и место лидера.",
    ],
    party: [
      "Отряд",
      RAIL_ICONS.party,
      "Листы персонажей, HP и состояния отряда, а также связи с NPC.",
    ],
    battle: ["Бой", RAIL_ICONS.battle, "Управление боем, ваш ход, список врагов и журнал боя."],
    map: ["Карта", RAIL_ICONS.map, "Карта сцены и открытые локации."],
    story: [
      "Сюжет",
      RAIL_ICONS.story,
      "Главы и история, состояние мира и журнал бросков.",
    ],
    notes: ["Заметки", RAIL_ICONS.notes, "Предлагайте сюжетные заметки; лидер отряда утверждает их."],
    chat: ["Чат", RAIL_ICONS.chat, "Шёпот между игроками. Мастер его не видит."],
    context: [
      "Контекст",
      RAIL_ICONS.context,
      "Что было отправлено Мастеру на прошлом ходу.",
    ],
    settings: ["Настройки", RAIL_ICONS.settings, "Настройки кампании, приглашения и переключатели."],
  },
};

// Single source of truth for the panel tab list, shared by the desktop rail
// strip and the mobile bottom bar. The gating flags are documented on
// TableTabInput (src/lib/dm/table-tabs.ts).
export function buildPanelTabs(input: TableTabInput, locale: Locale = "ru"): PanelTabDef[] {
  const dict = TAB_PRESENTATION[locale] ?? TAB_PRESENTATION.ru;
  return visiblePanelTabs(input).map((id) => [id, ...dict[id]]);
}

// The lead tab is the one place in the rail that is not the DM's gold: the
// same ember the composer's Direct pill wears, so the two halves of "the lead
// steering the table" read as one thing. The classes are the icon-rail
// recipes from src/lib/ui.tsx, so the bottom bar and the docked IconRail
// look like the same control.
export function tabAccentClass(tab: PanelTab, active: boolean): string {
  if (!active) {
    return "";
  }
  return tab === "lead" ? ui.railCellActiveEmber : ui.railCellActive;
}

// The count pill on a tab. Gold everywhere except the lead tab, where it
// matches the ember accent above.
export function tabBadgeClass(tab: PanelTab): string {
  return cn(
    "absolute right-1.5 top-1 rounded-full bg-gradient-to-b px-1 text-[9px] font-semibold",
    tab === "lead"
      ? "from-ember-300 to-ember-500 text-stone-950 shadow-glow-ember"
      : "from-amber-300 to-amber-500 text-amber-950 shadow-glow-gold",
  );
}

// Owns which panel tab is active (shared by rail and mobile) and which column
// shows below lg. The auto-jumps mirror the old SidePanel behavior: an
// incoming chat target opens the chat tab (and the panel column on a phone),
// combat starting selects the battle map. On a phone the battle map does not
// pull the player off the story; SessionView switches them over when their
// own turn comes.
export function useSessionTabs({
  chatTarget,
  battleMap,
  hasEncounter,
  isLead,
}: {
  chatTarget: string | null;
  battleMap?: PlayerMapView | null;
  hasEncounter: boolean;
  // The lead tab disappears when the seat is handed to someone else, so a
  // stale selection falls back exactly as battle does when the map goes.
  isLead: boolean;
}) {
  const [panelTab, setPanelTab] = useState<PanelTab>("party");
  const [mobileView, setMobileView] = useState<MobileView>("chat");

  // "Message" on a party card jumps to the chat tab; SideChatPanel opens the
  // 1:1 thread from the same request. State-from-props during render, per
  // React's "adjusting state when a prop changes" pattern.
  const [seenChatTarget, setSeenChatTarget] = useState<string | null>(null);
  if (chatTarget && chatTarget !== seenChatTarget) {
    setSeenChatTarget(chatTarget);
    setPanelTab("chat");
    setMobileView("panel");
  }

  // Combat starting jumps to the battle map; the tab itself disappears when
  // the encounter ends, so fall back off it.
  const [seenMapId, setSeenMapId] = useState<string | null>(null);
  if (battleMap && battleMap.mapId !== seenMapId) {
    setSeenMapId(battleMap.mapId);
    setPanelTab("battle");
  }
  if (!battleMap && !hasEncounter && panelTab === "battle") {
    setPanelTab("party");
  }
  if (!isLead && panelTab === "lead") {
    setPanelTab("party");
  }

  return { panelTab, setPanelTab, mobileView, setMobileView };
}

// Mobile-only navigation: the main game chat ("Table") plus the panel tabs,
// each filling the screen when selected. Hidden at lg and up. A phone fits
// six readable cells; past that the least-used tabs move into a "More" sheet
// (the open tab always keeps its place in the bar).
const MAX_BAR_CELLS = 6;
const BAR_PRIORITY: PanelTab[] = ["battle", "dm", "lead", "party", "map", "chat", "story", "notes", "context", "settings"];

function barCells(tabs: PanelTabDef[], active: PanelTab | null): { bar: PanelTabDef[]; more: PanelTabDef[] } {
  if (tabs.length + 1 <= MAX_BAR_CELLS) return { bar: tabs, more: [] };
  const rank = (tab: PanelTab) => {
    const i = BAR_PRIORITY.indexOf(tab);
    return i < 0 ? BAR_PRIORITY.length : i;
  };
  const slots = MAX_BAR_CELLS - 2; // "Table" and "More" take two
  const chosen = new Set([...tabs].sort((a, b) => rank(a[0]) - rank(b[0])).slice(0, slots).map(([id]) => id));
  if (active && !chosen.has(active) && tabs.some(([id]) => id === active)) {
    const weakest = [...chosen].sort((a, b) => rank(b) - rank(a))[0];
    chosen.delete(weakest);
    chosen.add(active);
  }
  return { bar: tabs.filter(([id]) => chosen.has(id)), more: tabs.filter(([id]) => !chosen.has(id)) };
}

const barCellClass = "min-h-[3.25rem] min-w-0 flex-1 basis-0 gap-1 px-1 py-1.5";
const barLabelClass = "max-w-full truncate text-[11px] font-medium leading-none";

function BottomTabBarInner({
  tabs,
  mobileView,
  panelTab,
  onSelectChat,
  onSelectPanel,
  chatUnread,
  pendingCount,
  storyDue,
  steersStory,
}: {
  tabs: PanelTabDef[];
  mobileView: MobileView;
  panelTab: PanelTab;
  onSelectChat: () => void;
  onSelectPanel: (tab: PanelTab) => void;
  chatUnread: number;
  pendingCount: number;
  // The DM has story to write down (src/lib/dm/beat-cadence.ts).
  storyDue: boolean;
  // Pending notes are the lead's to approve only while they steer the
  // story; at a human-DM table the count is the DM's and the lead tab stays
  // quiet.
  steersStory: boolean;
}) {
  const { locale } = useI18n();
  const [moreOpen, setMoreOpen] = useState(false);
  const copy = localeText(locale, {
    en: { table: "Table", more: "More", moreTitle: "More panels" },
    ru: { table: "Стол", more: "Ещё", moreTitle: "Другие разделы" },
  });
  const { bar, more } = barCells(tabs, mobileView === "panel" ? panelTab : null);
  const marks = (value: PanelTab) => ({
    unread: value === "chat" && chatUnread > 0,
    due: value === "dm" && storyDue,
    count: (value === "notes" || (value === "lead" && steersStory)) && pendingCount ? pendingCount : value === "chat" && chatUnread ? chatUnread : 0,
  });
  const moreMarked = more.some(([value]) => {
    const m = marks(value);
    return m.unread || m.due || m.count > 0;
  });
  const moreActive = mobileView === "panel" && more.some(([value]) => value === panelTab);

  const cellBadges = (value: PanelTab) => {
    const m = marks(value);
    return (
      <>
        {m.unread ? <span className="absolute left-1.5 top-1 size-1.5 rounded-full bg-red-500" /> : null}
        {m.due ? <span className="absolute right-1.5 top-1 size-1.5 rounded-full bg-amber-400" /> : null}
        {m.count ? <span className={tabBadgeClass(value)}>{m.count}</span> : null}
      </>
    );
  };

  return (
    <nav className="glass flex items-stretch gap-0.5 border-t border-stone-700/40 px-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-1 lg:hidden">
      <button
        type="button"
        onClick={onSelectChat}
        aria-current={mobileView === "chat" ? "page" : undefined}
        className={cn(ui.railCell, barCellClass, mobileView === "chat" && ui.railCellActive)}
      >
        <TableIcon className="shrink-0" />
        <span className={barLabelClass}>{copy.table}</span>
      </button>
      {bar.map(([value, label, Icon]) => {
        const active = mobileView === "panel" && panelTab === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => onSelectPanel(value)}
            data-tour={`tab-${value}`}
            aria-current={active ? "page" : undefined}
            className={cn(ui.railCell, barCellClass, tabAccentClass(value, active))}
          >
            <Icon className={cn("size-5 shrink-0", value === "chat" && chatUnread > 0 && "animate-wiggle")} />
            <span className={barLabelClass}>{label}</span>
            {cellBadges(value)}
          </button>
        );
      })}
      {more.length ? (
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          className={cn(ui.railCell, barCellClass, moreActive && ui.railCellActive)}
        >
          <MoreHorizontal className="size-5 shrink-0" />
          <span className={barLabelClass}>{copy.more}</span>
          {moreMarked ? <span className="absolute right-1.5 top-1 size-2 rounded-full bg-amber-400" /> : null}
        </button>
      ) : null}
      {more.length ? (
        <Sheet open={moreOpen} onOpenChange={setMoreOpen} title={copy.moreTitle} className="lg:hidden">
          <div className="grid grid-cols-3 gap-2">
            {more.map(([value, label, Icon, tip]) => {
              const active = mobileView === "panel" && panelTab === value;
              return (
                <button
                  key={value}
                  type="button"
                  data-tour={`tab-${value}`}
                  title={tip}
                  onClick={() => {
                    setMoreOpen(false);
                    onSelectPanel(value);
                  }}
                  className={cn(
                    "relative flex min-h-[4.5rem] flex-col items-center justify-center gap-1.5 rounded-xl bg-stone-900 px-2 py-2 text-center text-xs text-stone-300",
                    active && "bg-amber-400/10 text-amber-300",
                  )}
                >
                  <Icon className="size-5" />
                  <span className="leading-tight">{label}</span>
                  {cellBadges(value)}
                </button>
              );
            })}
          </div>
        </Sheet>
      ) : null}
    </nav>
  );
}

export const BottomTabBar = memo(BottomTabBarInner);
