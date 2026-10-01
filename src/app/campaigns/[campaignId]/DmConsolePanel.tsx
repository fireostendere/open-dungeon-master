"use client";

import { useInlineText } from "@/lib/i18n/inline-text";
import { useMemo, useState } from "react";
import { GameIcon } from "@/components/ui/GameIcon";
import { adjudicationGlyph } from "@/app/campaigns/[campaignId]/SessionGlyph";
import { cn } from "@/lib/cn";
import { Ribbon } from "@/components/ui/Ribbon";
import { consoleAdjudications, type AdjudicationCategory } from "@/lib/dm/invoke-catalog";
import { DmActionForm } from "@/app/campaigns/[campaignId]/DmActionForm";
import { DmBeatComposer } from "@/app/campaigns/[campaignId]/DmBeatComposer";
import { DmAssistPanel } from "@/app/campaigns/[campaignId]/DmAssistPanel";
import type { CritRules } from "@/app/campaigns/[campaignId]/DmOddsPanel";
import { DmTablesPanel } from "@/app/campaigns/[campaignId]/DmTablesPanel";
import { DmMapStudioPanel } from "@/app/campaigns/[campaignId]/DmMapStudioPanel";
import { DmMapLibraryPanel } from "@/app/campaigns/[campaignId]/DmMapLibraryPanel";
import { DmNpcForgePanel } from "@/app/campaigns/[campaignId]/DmNpcForgePanel";
import { DmEncounterPrepPanel } from "@/app/campaigns/[campaignId]/DmEncounterPrepPanel";
import { DmBestiaryPanel } from "@/app/campaigns/[campaignId]/DmBestiaryPanel";
import { DmStoryboardPanel } from "@/app/campaigns/[campaignId]/DmStoryboardPanel";
import { DmWorkbenchPanel } from "@/app/campaigns/[campaignId]/DmWorkbenchPanel";
import type { CampaignMessage } from "@/lib/db/messages";
import type { DmBeat } from "@/lib/db/dm-beats";
import type { PublicEncounter } from "@/lib/db/encounter-view";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The DM's console: the queue of what the players have done and not yet been
// answered on, and every adjudication the rules engine can perform.
//
// The action list is not written here. It is rendered from the adjudication
// catalog (src/lib/dm/invoke-catalog.ts), which is the same list the AI DM
// is offered as tools, so a person running the table can do exactly what the
// machine can and the server enforces the rules either way.

// Who may speak, right now. In combat the initiative order owns this and
// the buttons stand down; the rest of the time it is the DM's to set.
function FloorControl({
  campaignId,
  mode,
}: {
  campaignId: string;
  mode: "open" | "hold" | "spotlight" | "initiative";
}) {
  const uiText = useInlineText();
  const [busy, setBusy] = useState(false);

  async function set(next: "open" | "hold") {
    setBusy(true);
    try {
      await fetch(`/api/campaigns/${campaignId}/floor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ set: next }),
      });
    } catch {
      // The floor_changed event is the source of truth; a failed click
      // simply leaves it where it was.
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-stone-800 bg-stone-950/60 px-2.5 py-2">
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">
        <GameIcon icon={{ kind: "glyph", key: "tab-session" }} size="size-5" />
        {uiText("The floor")}
      </p>
      {mode === "initiative" ? (
        <p className="flex items-center gap-1.5 text-xs text-stone-500">
          <GameIcon icon={{ kind: "glyph", key: "rest-initiative" }} size="size-5" />
          {uiText("The initiative order has it while the fight runs.")}
        </p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {(["open", "hold"] as const).map((option) => (
            <button
              key={option}
              type="button"
              disabled={busy || mode === option}
              onClick={() => set(option)}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border py-1 pl-1 pr-2 text-xs disabled:opacity-40",
                mode === option
                  ? "border-amber-700 bg-amber-950/50 text-amber-100"
                  : "border-stone-700 text-stone-400 hover:text-stone-200",
              )}
            >
              <GameIcon icon={{ kind: "glyph", key: option === "open" ? "tab-chat" : "cue-bell" }} size="size-5" />
              {option === "open" ? uiText("Anyone may act") : uiText("Hold everyone")}
            </button>
          ))}
          {mode === "spotlight" ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-amber-700 bg-amber-950/50 py-1 pl-1 pr-2 text-xs text-amber-100">
              <GameIcon icon={{ kind: "glyph", key: "tab-lead" }} size="size-5" />
              {uiText("Spotlight")}
            </span>
          ) : (
            <span className="self-center text-[11px] text-stone-600">
              {uiText("Give the floor to named players with Give the floor, under Story.")}
            </span>
          )}
        </div>
      )}
    </section>
  );
}

// The console rail: the catalog's own categories, plus three tabs that are
// not adjudications at all. "assist" answers questions and applies nothing;
// "tables" is the DM's own reference shelf; "maps" is the prep bench, where
// a map is built before the table sees it and a fight is written down before
// it happens.
type ConsoleTab = AdjudicationCategory | "assist" | "tables" | "maps" | "cast" | "bestiary" | "storyboard";

// The painted glyph each console tab wears (upstream's TAB_GLYPH).
const TAB_GLYPH: Record<ConsoleTab, string> = {
  assist: "tab-dm",
  combat: "tab-battle",
  party: "tab-party",
  world: "tab-map",
  social: "tab-chat",
  story: "tab-story",
  table: "tab-dice",
  maps: "system-maps",
  cast: "system-cast",
  bestiary: "system-bestiary",
  storyboard: "system-storyboard",
  tables: "system-tables",
};

export function DmConsolePanel({
  campaignId,
  sheets,
  encounter,
  messages,
  intents,
  floorMode,
  beats,
  variantRules,
}: {
  campaignId: string;
  sheets: CharacterSheet[];
  encounter: PublicEncounter | null;
  messages: CampaignMessage[];
  // Player actions waiting on the DM, oldest first (dm_intent_queued).
  intents: Array<{ messageId: string; userId: string; characterId: string; seq: number }>;
  floorMode: "open" | "hold" | "spotlight" | "initiative";
  // Story already written down, newest first.
  beats: DmBeat[];
  // The table's crit rules, for the assist rail's consequence preview.
  variantRules: CritRules;
}) {
  const uiText = useInlineText();
  // Hosted image generation is retired. Keep deterministic/manual map tools,
  // but never expose the old generate_image adjudication.
  const groups = useMemo(
    () => consoleAdjudications()
      .map((group) => ({
        ...group,
        entries: group.entries.filter((entry) => entry.name !== "generate_image"),
      }))
      .filter((group) => group.entries.length > 0),
    [],
  );
  // The rail carries the catalog's own categories plus two that are not
  // adjudications at all: the assist tools, which apply nothing, and the DM's
  // tables and monster lookup, which are reference.
  const [category, setCategory] = useState<ConsoleTab>("assist");
  const [openAction, setOpenAction] = useState("");
  // Lifted so the queue's "what now?" can hand a player's own words to the
  // suggester without the DM retyping them.
  const [assistIntent, setAssistIntent] = useState("");

  const sheetsById = useMemo(
    () => new Map(sheets.map((sheet) => [sheet.id, sheet])),
    [sheets],
  );
  const messagesById = useMemo(
    () => new Map(messages.map((message) => [message.id, message])),
    [messages],
  );
  const queue = useMemo(
    () =>
      intents
        .map((intent) => ({
          intent,
          message: messagesById.get(intent.messageId) ?? null,
          name: sheetsById.get(intent.characterId)?.name ?? "Someone",
        }))
        .filter((row) => row.message)
        .sort((a, b) => a.intent.seq - b.intent.seq),
    [intents, messagesById, sheetsById],
  );

  const active = groups.find((group) => group.category === category) ?? null;

  return (
    <div className="space-y-4">
      {/* Gold, the DM's colour: nobody else at the table has this tab, and
          the lead's desk wears ember so the two seats never blur. */}
      <Ribbon tone="gold">{uiText("Only you")}</Ribbon>

      <div data-tour="dm-floor">
        <FloorControl campaignId={campaignId} mode={floorMode} />
      </div>

      {/* Directly under the floor, because this is where the nudge sends
          them and a reminder that lands on a scroll is not a reminder. */}
      <div data-tour="dm-beats">
        <DmBeatComposer campaignId={campaignId} beats={beats} />
      </div>

      <section data-tour="dm-queue">
        <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">
          <GameIcon icon={{ kind: "glyph", key: "tab-log" }} size="size-5" />
          {uiText("Waiting on you")}
          {queue.length ? (
            <span className="rounded-full bg-amber-900/60 px-1.5 text-[10px] text-amber-200">
              {queue.length}
            </span>
          ) : null}
        </h3>
        {queue.length ? (
          <ul className="space-y-1.5">
            {queue.map(({ intent, message, name }) => (
              <li
                key={intent.messageId}
                className="rounded-lg border border-stone-800 bg-stone-950/60 px-2.5 py-2"
              >
                <p className="text-[11px] uppercase tracking-wide text-amber-200/80">{name}</p>
                <p className="whitespace-pre-wrap text-sm text-stone-300">{message?.content}</p>
                <button
                  type="button"
                  onClick={() => {
                    setAssistIntent(message?.content ?? "");
                    setCategory("assist");
                    setOpenAction("");
                  }}
                  className="mt-1 inline-flex items-center gap-1 text-[11px] text-stone-500 hover:text-amber-200"
                >
                  <GameIcon icon={{ kind: "glyph", key: "die-d20" }} size="size-5" />
                  {uiText("What should I press?")}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-stone-800 bg-stone-950/40 px-2.5 py-2 text-xs text-stone-500">
            {uiText("Nothing waiting. Everything the party has said has been answered.")}
          </p>
        )}
      </section>

      <section>
        <div className="mb-2 flex flex-wrap gap-1" data-tour="dm-console-tabs">
          {([
            ["assist", "Assist"],
            ...groups.map((group) => [group.category, group.label] as const),
            ["maps", "Maps"],
            ["cast", "Cast"],
            ["bestiary", "Bestiary"],
            ["storyboard", "Storyboard"],
            ["tables", "Tables"],
          ] as Array<readonly [ConsoleTab, string]>).map(([tab, label]) => (
            <button
              key={tab}
              type="button"
              onClick={() => {
                setCategory(tab);
                setOpenAction("");
              }}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border py-1 pl-1 pr-2 text-xs",
                tab === category
                  ? "border-amber-700 bg-amber-950/50 text-amber-100"
                  : "border-stone-700 text-stone-400 hover:text-stone-200",
              )}
            >
              <GameIcon icon={{ kind: "glyph", key: TAB_GLYPH[tab] }} size="size-5" />
              {label}
            </button>
          ))}
        </div>

        {category === "assist" ? (
          <DmAssistPanel
            campaignId={campaignId}
            sheets={sheets}
            encounter={encounter}
            variantRules={variantRules}
            intent={assistIntent}
            onIntentChange={setAssistIntent}
          />
        ) : category === "maps" ? (
          <div className="space-y-4">
            <DmMapStudioPanel campaignId={campaignId} />
            <DmMapLibraryPanel campaignId={campaignId} />
            <DmEncounterPrepPanel campaignId={campaignId} />
          </div>
        ) : category === "cast" ? (
          <DmNpcForgePanel campaignId={campaignId} />
        ) : category === "bestiary" ? (
          <div className="space-y-4">
            <DmBestiaryPanel campaignId={campaignId} />
            <DmWorkbenchPanel campaignId={campaignId} />
          </div>
        ) : category === "storyboard" ? (
          <DmStoryboardPanel campaignId={campaignId} />
        ) : category === "tables" ? (
          <DmTablesPanel campaignId={campaignId} />
        ) : (
        <ul className="space-y-1.5">
          {(active?.entries ?? []).map((entry) => (
            <li key={entry.name}>
              {openAction === entry.name ? (
                <div className="space-y-1">
                  <DmActionForm
                    campaignId={campaignId}
                    entry={entry}
                    sheets={sheets}
                    encounter={encounter}
                    glyph={adjudicationGlyph(entry.name, TAB_GLYPH[category])}
                  />
                  <button
                    type="button"
                    onClick={() => setOpenAction("")}
                    className="text-[11px] text-stone-500 hover:text-stone-300"
                  >
                    {uiText("Close")}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setOpenAction(entry.name)}
                  className="flex w-full items-center gap-2.5 rounded-lg border border-stone-800 bg-stone-950/40 px-2.5 py-2 text-left hover:border-stone-700"
                >
                  <GameIcon icon={{ kind: "glyph", key: adjudicationGlyph(entry.name, TAB_GLYPH[category]) }} size="size-7" />
                  <span className="min-w-0 grow">
                    <span className="block text-sm text-stone-200">{entry.label}</span>
                    <span className="block text-xs text-stone-500">{entry.summary}</span>
                  </span>
                </button>
              )}
            </li>
          ))}
        </ul>
        )}
      </section>
    </div>
  );
}
