"use client";

import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { GameIcon } from "@/components/ui/GameIcon";
import { BEAT_LABELS, type BeatKind, type BeatLinks, type Board, type BoardInventory, type BoardNode } from "@/lib/workshop/board";
import { KIND_CHIP, LINK_FIELDS } from "@/app/workshop/storyboard/beat-fields";
import { useI18n } from "@/lib/i18n/context";
import { localeText } from "@/lib/i18n/locale-text";

// The workshop's storyboard: every card as a card. Kind chip, title, the
// first line of what happens, a chip per thing it points at, and how many
// cards it leads to. Tapping one hands it to the caller, which opens the
// editor.
//
// One column on a phone, because the board reads top to bottom there; two
// or three on a desk. Still no canvas: the x and y on each beat wait for
// one, but arrows drawn between cards that reflow with the viewport would
// be arrows pointing at the wrong thing.

// The painted glyph for a kind of card and for each thing a card points at.
const KIND_GLYPH: Record<BeatKind, string> = {
  setting: "system-region",
  backstory: "tab-journal",
  event: "tab-timeline",
  encounter: "system-encounters",
  hook: "quest-active",
  secret: "quest-hidden",
  npc_moment: "system-cast",
};
const LINK_GLYPH: Record<keyof BeatLinks, string> = {
  npcId: "system-cast",
  mapId: "system-maps",
  encounterId: "system-encounters",
  locationId: "system-region",
};

// The first line with words in it, so a card whose body opens with a blank
// line still shows something.
function excerpt(body: string): string {
  return body.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
}

export function BeatBoard({
  board,
  inventory,
  onOpen,
}: {
  board: Board;
  inventory: BoardInventory;
  onOpen: (node: BoardNode) => void;
}) {
  const { locale } = useI18n();
  const copy = localeText(locale, { en: { empty: "Nothing on the board. Start with a reason the party would go somewhere.", open: "Open", leads: "leads to" }, ru: { empty: "На доске пока ничего нет. Начните с причины, по которой группа куда-то отправится.", open: "Открыть", leads: "ведёт к" } });
  if (board.nodes.length === 0) {
    return (
      <p className="text-xs text-stone-500">
        {copy.empty}
      </p>
    );
  }
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {board.order.map((id) => {
        const node = board.nodes.find((entry) => entry.id === id);
        if (!node) {
          return null;
        }
        const line = excerpt(node.body);
        const links = LINK_FIELDS.flatMap(([field, bucket, , short]) => {
          const linked = node.links[field];
          const name = linked ? inventory[bucket].find((entry) => entry.id === linked)?.name : "";
          return name ? [{ field, short, name }] : [];
        });
        return (
          <li key={node.id}>
            <button
              type="button"
              onClick={() => onOpen(node)}
              aria-label={`${copy.open} ${node.title}`}
              className={cn(
                ui.cardHover,
                "flex h-full w-full flex-col gap-2 p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40",
              )}
            >
              <span className="flex items-center gap-2">
                <GameIcon icon={{ kind: "glyph", key: KIND_GLYPH[node.kind] }} size="size-8" />
                <span
                  className={cn(
                    "w-fit rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-wider",
                    KIND_CHIP[node.kind],
                  )}
                >
                  {BEAT_LABELS[node.kind]}
                </span>
              </span>
              <span className="font-display tracking-wide text-amber-50">{node.title}</span>
              {line ? <span className="line-clamp-1 text-sm text-stone-300">{line}</span> : null}
              {links.length ? (
                <span className="flex flex-wrap gap-1">
                  {links.map((link) => (
                    <span
                      key={link.field}
                      className="inline-flex items-center gap-1 rounded-md border border-stone-700 px-1.5 py-0.5 text-[10px] text-stone-400"
                    >
                      <GameIcon icon={{ kind: "glyph", key: LINK_GLYPH[link.field] }} size="size-4" />
                      <span className="text-stone-600">{link.short} </span>
                      {link.name}
                    </span>
                  ))}
                </span>
              ) : null}
              <span className="mt-auto flex items-center gap-1 text-[11px] text-stone-500">
                <ArrowRight className="size-3" aria-hidden="true" />
                {copy.leads} {node.out.length}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
