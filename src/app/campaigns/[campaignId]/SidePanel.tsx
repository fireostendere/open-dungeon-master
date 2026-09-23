"use client";

import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { memo, useMemo, useSyncExternalStore } from "react";
import { cn } from "@/lib/cn";
import { IconRail, type IconRailItem } from "@/components/ui/IconRail";
import { Tooltip } from "@/components/ui/Tooltip";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";
import {
  SidePanelRouter,
  type SidePanelRouterProps,
} from "@/app/campaigns/[campaignId]/SidePanelRouter";
import type { PanelTab, PanelTabDef } from "@/app/campaigns/[campaignId]/SessionTabs";

// Keep the desktop collapse preference per browser, using the same external
// store pattern as useChatChime.
const COLLAPSED_KEY = "odm_side_panel_collapsed";
const COLLAPSED_EVENT = "odm-side-panel-collapse";

function subscribeCollapsed(callback: () => void) {
  window.addEventListener(COLLAPSED_EVENT, callback);
  return () => window.removeEventListener(COLLAPSED_EVENT, callback);
}

function readCollapsed() {
  return window.localStorage.getItem(COLLAPSED_KEY) === "1";
}

function setCollapsed(collapsed: boolean) {
  window.localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
  window.dispatchEvent(new Event(COLLAPSED_EVENT));
}

// The session's context column: party sheets, the current area map, story
// chapters, table notes, and the stat-change log. From lg up it is docked
// beside the chat with a vertical icon rail on its outer edge, so the story
// never disappears behind a panel and every tab is one click away without
// a sideways scroll. Below lg it fills the screen when the bottom tab bar
// selects a panel, and the bottom bar is the rail. Tab state lives in
// SessionView (SessionTabs) so the two rails stay in sync.
function SidePanelInner({
  tabs,
  onTabChange,
  pendingCount,
  chatUnread,
  mobileVisible,
  storyDue,
  ...content
}: SidePanelRouterProps & {
  tabs: PanelTabDef[];
  onTabChange: (tab: PanelTab) => void;
  pendingCount: number;
  chatUnread: number;
  mobileVisible: boolean;
  // The quiet half of the story-capture nudge: a dot on the DM tab. The loud
  // half is the banner above the composer (src/lib/dm/beat-cadence.ts).
  storyDue: boolean;
}) {
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false);
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: { collapse: "Hide panel", expand: "Show panel" },
    ru: { collapse: "Скрыть панель", expand: "Показать панель" },
  });
  const { tab, steersStory } = content;

  const items = useMemo<IconRailItem<PanelTab>[]>(
    () =>
      tabs.map(([value, label, icon, tip]) => ({
        value,
        label,
        icon,
        tip,
        tour: `tab-${value}`,
        // The approval queue is the lead's only while they steer the story,
        // so the lead tab carries the count on that condition and the Notes
        // tab keeps it unconditionally as before.
        badge:
          value === "chat"
            ? chatUnread || undefined
            : (value === "notes" || (value === "lead" && steersStory)) && pendingCount
              ? pendingCount
              : undefined,
        dot:
          value === "chat" && chatUnread > 0
            ? "red"
            : value === "dm" && storyDue
              ? "amber"
              : value === "battle" && content.ownCombatTurn
                ? "amber"
                : undefined,
        // The one place in the rail that is not the DM's gold: the same
        // ember the composer's Direct pill wears (see tabAccentClass).
        accent: value === "lead" ? "ember" : "gold",
      })),
    [tabs, chatUnread, pendingCount, steersStory, storyDue, content.ownCombatTurn],
  );

  return (
    <aside
      className={cn(
        "shrink-0 bg-gradient-to-b from-stone-950/70 to-stone-950/30 lg:flex lg:flex-row lg:border-l lg:border-stone-700/50",
        mobileVisible ? "flex w-full min-w-0 flex-col" : "hidden",
      )}
    >
      <div
        id="side-panel-content"
        className={cn(
          "min-h-0 min-w-0 flex-1 overflow-y-auto p-3 lg:w-[clamp(24rem,42vw,48rem)] lg:min-w-[24rem] lg:max-w-[65vw] lg:flex-none lg:resize-x lg:overflow-auto",
          collapsed && "lg:hidden",
        )}
      >
        <div className="mx-auto w-full max-w-2xl lg:max-w-none">
          <SidePanelRouter {...content} />
        </div>
      </div>
      {/* The rail sits on the outer edge, away from the chat, so the eye
          reads chat, context, then the switch between contexts. It scrolls
          on a short window rather than clipping the last tabs. */}
      <div
        className={cn(
          "hidden shrink-0 flex-col items-stretch gap-1 overflow-y-auto border-l border-stone-700/40 py-2 [scrollbar-width:none] lg:flex lg:transition-[width] lg:duration-200",
          collapsed ? "w-14 px-1" : "w-24 px-1.5",
        )}
      >
        <Tooltip content={collapsed ? copy.expand : copy.collapse} side="left">
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? copy.expand : copy.collapse}
            aria-expanded={!collapsed}
            aria-controls="side-panel-content"
            className="flex h-12 items-center justify-center rounded-xl border border-stone-700/60 bg-stone-900/60 text-stone-200 shadow-sm transition-colors hover:border-amber-500/50 hover:bg-stone-800 hover:text-amber-200"
          >
            {collapsed ? <ChevronsLeft className="size-6" /> : <ChevronsRight className="size-6" />}
          </button>
        </Tooltip>
        {!collapsed ? <IconRail items={items} value={tab} onChange={onTabChange} tipSide="left" /> : null}
      </div>
    </aside>
  );
}

// Memoized: the session view re-renders on every streamed DM token, and
// this panel's props are unchanged during narration.
export const SidePanel = memo(SidePanelInner);
