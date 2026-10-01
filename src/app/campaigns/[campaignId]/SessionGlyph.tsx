"use client";

import type { LucideIcon } from "lucide-react";
import { GameIcon } from "@/components/ui/GameIcon";
import { cn } from "@/lib/cn";
import type { TableTabId } from "@/lib/dm/table-tabs";
import type { InputKind } from "@/lib/campaign-types";

// Which painting stands for which part of the running session (from
// upstream's sessionGlyphs.ts). Names are files under
// public/assets/icons/glyph, without the extension.
export const TAB_GLYPHS: Record<TableTabId, string> = {
  dm: "tab-dm",
  lead: "tab-lead",
  party: "tab-party",
  battle: "tab-battle",
  map: "tab-map",
  story: "tab-story",
  notes: "tab-notes",
  chat: "tab-chat",
  context: "tab-context",
  settings: "tab-settings",
};

// The "Table" cell of the phone's bottom bar: the transcript itself.
export const TABLE_GLYPH = "tab-session";

// Second-level pills (SubTabs). A section this map does not know keeps the
// line icon its panel passed.
export const SUBTAB_GLYPHS: Record<string, string> = {
  story: "tab-story",
  facts: "tab-facts",
  log: "tab-log",
  party: "tab-party",
  bonds: "tab-bonds",
};

// The composer's mode pills.
export const MODE_GLYPHS: Record<InputKind, string> = {
  do: "rest-initiative",
  ooc: "skill-persuasion",
  ask: "tab-reference",
  lead: "tab-lead",
  narrate: "tab-dm",
};

// A DM action's painting: rests, death and levelling have glyphs of their
// own; everything else wears the fallback (its console tab's, or the DM's).
export function adjudicationGlyph(name: string, fallback: string): string {
  if (name.includes("long_rest")) return "rest-long";
  if (name.includes("rest")) return "rest-short";
  if (name.includes("death")) return "rest-death-save";
  if (name.includes("level")) return "rest-level-up";
  if (name.includes("xp")) return "rest-xp";
  if (name.includes("inspiration")) return "rest-inspiration";
  if (name.includes("exhaustion")) return "rest-exhaustion";
  if (name.includes("heal") || name.includes("damage") || name.includes("hp")) return "rest-hp";
  if (name.includes("quest")) return "quest-active";
  if (name.includes("gold") || name.includes("coin") || name.includes("purse")) return "coin-purse";
  if (name.includes("initiative")) return "rest-initiative";
  if (name.includes("concentration")) return "rest-concentration-break";
  if (name.includes("spell") || name.includes("cast")) return "rest-spell-slot";
  if (name.includes("check") || name.includes("roll") || name.includes("save")) return "die-d20";
  if (name.includes("loot") || name.includes("item") || name.includes("treasure")) return "tab-loot";
  if (name.includes("shop") || name.includes("merchant")) return "tab-shop";
  if (name.includes("handout") || name.includes("image")) return "tab-handout";
  if (name.includes("ambience") || name.includes("music") || name.includes("sound")) return "tab-ambience";
  if (name.includes("npc")) return "system-cast";
  if (name.includes("faction")) return "tab-factions";
  if (name.includes("lore")) return "system-lore";
  if (name.includes("time") || name.includes("calendar")) return "tab-timeline";
  if (name.includes("floor") || name.includes("spotlight")) return "tab-lead";
  return fallback;
}

// A painted glyph that can stand wherever the rail expects a line icon. The
// shared IconRail and the phone's bottom bar take a LucideIcon; this gives
// them a component of that shape which paints instead, so the badges, dots
// and tour anchors stay exactly as they are. The caller's size class is
// dropped: a painting needs more room than a 16 px line icon, and
// .rail-glyph sets it (globals.css).
export function paintedRailIcon(glyph: string): LucideIcon {
  function PaintedRailIcon({ className }: { className?: string }) {
    const rest = (className ?? "").replace(/\bsize-\S+/g, "").trim();
    return <GameIcon icon={{ kind: "glyph", key: glyph }} size="" className={cn("rail-glyph", rest)} />;
  }
  PaintedRailIcon.displayName = `PaintedRailIcon(${glyph})`;
  return PaintedRailIcon as unknown as LucideIcon;
}
