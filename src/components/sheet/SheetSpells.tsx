"use client";

import { useState } from "react";
import { spellClassFor } from "@/lib/classes";
import { localizedContentName } from "@/lib/help";
import { useI18n } from "@/lib/i18n";
import { characterDisplay } from "@/lib/i18n/character-display";
import { useInlineText } from "@/lib/i18n/inline-text";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { spellLevelOf } from "@/lib/srd/spell-lists";
import {
  casterViewsOf,
  grantedSpellsOf,
  heldSpells,
  maxSpellLevelOf,
  preparedCount,
  spellCapOf,
  spellbookOf,
  type CasterView,
  type PrepAction,
  type PrepErrorCode,
} from "@/lib/srd/spell-prep";
import { SpellBook, type SpellTile } from "./SpellBook";
import { useSpellLookups, useSpellPool, type PoolSpell } from "./useSpellPool";

// A character's spells as a spell book, one per caster class. The owner of a
// prepared caster can change what is prepared right here: unpreparing takes
// effect at once, a new pick waits for the next long rest
// (src/lib/srd/spell-prep.ts, POST /sheet/spells). Everyone else reads it.

export function SheetSpells({
  sheet,
  editable = false,
}: {
  sheet: Pick<CharacterSheet, "class" | "level" | "subclass" | "classes" | "abilities" | "spellcasting"> & {
    campaignId?: string;
  };
  // The owner, in a campaign: may change prepared spells.
  editable?: boolean;
}) {
  const views = casterViewsOf(sheet);
  if (!views.length) {
    return null;
  }
  return (
    <div className="space-y-4">
      {views.map((view) => (
        <CasterBook
          key={view.classId}
          view={view}
          sheet={sheet}
          editable={editable && Boolean(sheet.campaignId)}
          showClass={views.length > 1}
        />
      ))}
    </div>
  );
}

function CasterBook({
  view,
  sheet,
  editable,
  showClass,
}: {
  view: CasterView;
  sheet: Parameters<typeof SheetSpells>[0]["sheet"];
  editable: boolean;
  showClass: boolean;
}) {
  const uiText = useInlineText();
  const { locale } = useI18n();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "note" | "error"; text: string } | null>(null);
  const maxLevel = maxSpellLevelOf(view);
  const canPrepare = editable && view.style !== "known";
  // The whole class list is only needed while a prepared caster edits.
  const { pool, loading } = useSpellPool(
    spellClassFor(view.classId),
    maxLevel,
    editing && view.style === "prepared",
  );

  // Pack and homebrew spells the checklist does not know get their level
  // from the pack, so none lands under a blank tab.
  const lookups = useSpellLookups([
    ...view.cantrips,
    ...view.known,
    ...view.prepared,
    ...view.pending,
    ...view.spellbook,
  ]);
  const tiles = buildTiles(view, [...lookups.values(), ...(editing ? pool : [])], editing);
  const cap = spellCapOf(view, sheet.abilities);
  const counters = [
    ...(view.cantrips.length ? [{ label: uiText("Cantrips"), value: view.cantrips.length }] : []),
    view.style === "known"
      ? {
          label: uiText("Known"),
          value: heldSpells(view).filter((name) => !isGranted(view, name)).length,
          max: cap?.count,
        }
      : {
          label: uiText("Prepared"),
          value: preparedCount(view),
          max: cap?.count,
          extra: view.pending.length
            ? uiText("({count} at long rest)", { count: view.pending.length })
            : undefined,
        },
    ...(view.style === "spellbook" ? [{ label: uiText("Spellbook"), value: spellbookOf(view).length }] : []),
  ];

  // The server words its answers in English for the narrator and the API;
  // the sheet says the same thing in the player's language.
  function successNote(action: PrepAction, spell: string) {
    return action === "prepare"
      ? uiText("{spell} will be prepared after the next long rest.", { spell })
      : action === "unprepare"
        ? uiText("{spell} is no longer prepared. Preparing it again takes a long rest.", { spell })
        : uiText("{spell} will not be prepared.", { spell });
  }
  function errorText(code: PrepErrorCode | undefined, spell: string, limit?: number): string | null {
    switch (code) {
      case "known_caster":
        return uiText("A caster who knows their spells always has them ready. They swap one for another when they gain a level, not at a rest.");
      case "cantrip":
        return uiText("{spell} is a cantrip: always ready, never prepared.", { spell });
      case "granted":
        return uiText("{spell} comes with the subclass and is always prepared.", { spell });
      case "not_in_book":
        return uiText("{spell} is not in the spellbook. A wizard prepares only spells written in it.", { spell });
      case "not_on_list":
        return uiText("{spell} is not on the list this class can prepare at its level.", { spell });
      case "full":
        return uiText("Already {count} prepared, counting the ones waiting for the long rest. Unprepare one first.", { count: limit ?? cap?.count ?? 0 });
      case "already_prepared":
        return uiText("{spell} is already prepared.", { spell });
      case "already_pending":
        return uiText("{spell} is already waiting for the next long rest.", { spell });
      default:
        return null;
    }
  }

  async function toggle(tile: SpellTile) {
    const action: PrepAction =
      tile.state === "pending" ? "cancel" : tile.state === "ready" ? "unprepare" : "prepare";
    const spell = tile.label ?? localizedContentName("spells", tile.name, locale);
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/campaigns/${sheet.campaignId}/sheet/spells`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, spell: tile.name, classId: view.classId }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        code?: PrepErrorCode;
        limit?: number;
      };
      setMessage(
        response.ok
          ? { tone: "note", text: successNote(action, spell) }
          : {
              tone: "error",
              // A 404 means the server answering does not have this action
              // (an older build not yet updated).
              text:
                errorText(data.code, spell, data.limit) ??
                (response.status === 404
                  ? uiText("The server does not know how to change prepared spells yet. Update the server this table runs on.")
                  : (data.error ?? uiText("Could not change that spell."))),
            },
      );
    } catch {
      setMessage({ tone: "error", text: uiText("Could not reach the server.") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {showClass ? (
        <p className="eyebrow mb-1.5 text-[10px] text-amber-400/80">{characterDisplay(view.classId, locale)}</p>
      ) : null}
      <SpellBook
        tiles={tiles}
        maxLevel={maxLevel}
        counters={counters}
        busy={busy}
        onTile={editing ? toggle : undefined}
        canToggle={(tile) => tile.state !== "granted" && tile.level !== 0}
        emptyText={
          editing
            ? loading
              ? uiText("Loading the class list...")
              : uiText("Nothing to prepare at this level.")
            : uiText("Nothing prepared at this level.")
        }
        header={
          canPrepare ? (
            <button
              type="button"
              onClick={() => {
                setEditing((current) => !current);
                setMessage(null);
              }}
              className={
                editing
                  ? "ml-auto rounded-full bg-amber-300 px-3 py-0.5 text-xs font-medium text-stone-950 hover:bg-amber-200"
                  : "ml-auto rounded-full border border-amber-500/50 px-3 py-0.5 text-xs text-amber-200 hover:bg-amber-400/10"
              }
            >
              {editing
                ? uiText("Done")
                : view.style === "spellbook"
                  ? uiText("Prepare from spellbook")
                  : uiText("Change prepared spells")}
            </button>
          ) : null
        }
        footer={
          <>
            {editing ? (
              <p className="mt-2 text-[11px] text-stone-500">
                {uiText("Tap a spell to prepare it: it becomes ready after your next long rest. Tapping a ready spell unprepares it at once. Cantrips and subclass spells never change.")}
              </p>
            ) : view.style === "known" && editable ? (
              <p className="mt-2 text-[11px] text-stone-500">
                {uiText("You know these spells and always have them ready. You can swap one when you level up.")}
              </p>
            ) : null}
            {message ? (
              <p
                role={message.tone === "error" ? "alert" : "status"}
                className={message.tone === "error" ? "mt-2 text-xs text-red-300" : "mt-2 text-xs text-sky-300"}
              >
                {message.text}
              </p>
            ) : null}
          </>
        }
      />
    </div>
  );
}

function isGranted(view: CasterView, name: string) {
  return grantedSpellsOf(view).some((entry) => entry.toLowerCase() === name.toLowerCase());
}

// Tiles for one caster: what is ready, what waits, and while editing what
// could be prepared (the class list, or a wizard's book).
// `pool` is every pack row at hand: the class list while editing, plus the
// looked-up rows for this caster's own pack spells (already taken, so they
// never turn into "available" tiles).
function buildTiles(view: CasterView, pool: PoolSpell[], editing: boolean): SpellTile[] {
  const levels = new Map(pool.map((spell) => [spell.name.toLowerCase(), spell]));
  const tile = (name: string, state: SpellTile["state"]): SpellTile => {
    const row = levels.get(name.toLowerCase());
    return {
      name,
      level: row?.level ?? spellLevelOf(name),
      state,
      data: row?.data,
      slug: row?.slug,
      homebrew: row?.source === "homebrew",
    };
  };
  const granted = grantedSpellsOf(view);
  const taken = new Set<string>();
  // First state wins: a name an older sheet wrote in two lists is one tile.
  const tiles: SpellTile[] = [
    ...view.cantrips.map((name) => ({ ...tile(name, "ready"), level: 0 })),
    ...granted.map((name) => tile(name, "granted")),
    ...heldSpells(view).map((name) => tile(name, "ready")),
    ...view.pending.map((name) => tile(name, "pending")),
  ].filter((entry) => {
    const key = entry.name.toLowerCase();
    if (taken.has(key)) {
      return false;
    }
    taken.add(key);
    return true;
  });
  if (view.style === "spellbook") {
    // The book is always worth seeing: it is what the wizard owns.
    tiles.push(
      ...spellbookOf(view)
        .filter((name) => !taken.has(name.toLowerCase()))
        .map((name) => tile(name, "inBook")),
    );
  } else if (editing && view.style === "prepared") {
    tiles.push(
      ...pool
        .filter((spell) => spell.level > 0 && !taken.has(spell.name.toLowerCase()))
        .map((spell) => tile(spell.name, "available")),
    );
  }
  return tiles;
}
