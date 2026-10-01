"use client";

import { useState } from "react";
import { Search, UserPlus } from "lucide-react";
import { GameIcon } from "@/components/ui/GameIcon";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { npcPlaceholder, npcRoleLabel } from "@/lib/placeholders";
import { describeNpc, draftFrom } from "@/lib/npcs/forge";
import { useI18n } from "@/lib/i18n/context";
import { localeText } from "@/lib/i18n/locale-text";

// The cast, two ways. CastChips is the DM console's compact row of names,
// moved here unchanged from DmNpcForgePanel. CastRows is the workshop's
// full-width list: portrait, attitude, where they are, the one line a player
// notices, how many people they have feelings about and what they want.
// Both hand the tap to the caller, which opens the editor.

export type Npc = {
  id: string;
  name: string;
  attitude: string;
  trait: string;
  location: string;
  // Optional so a roster fetched from a server that predates the column
  // still renders; the placeholder falls back to a hash of the name.
  role?: string;
  aliases: string[];
  portraitUrl: string;
  archived: boolean;
  agency: {
    personality: Record<string, number> | null;
    goals: { scene?: string; session?: { text: string; progress: number; target: number }; ambition?: string };
    relations: Array<{ npcName: string; score: number; note?: string }>;
  };
};

type ListProps = {
  npcs: Npc[];
  selectedId: string;
  onOpen: (npc: Npc | null) => void;
};

export function CastChips({ npcs, selectedId, onOpen }: ListProps) {
  const { locale } = useI18n();
  const copy = localeText(locale, { en: { cast: "The cast", new: "Someone new", empty: "Nobody written yet. Everything here also fills itself in as the party meets people." }, ru: { cast: "Персонажи", new: "Новый персонаж", empty: "Пока никого нет. Этот список также пополняется, когда группа знакомится с людьми." } });
  return (
    <section className="space-y-2 rounded-lg border border-stone-800 bg-stone-950/40 px-2.5 py-2">
      <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">
        <GameIcon icon={{ kind: "glyph", key: "system-cast" }} size="size-5" />
          {copy.cast}
      </p>
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          onClick={() => onOpen(null)}
          className={cn(
            "flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px]",
            selectedId === ""
              ? "border-amber-700 bg-amber-950/50 text-amber-100"
              : "border-stone-700 text-stone-400 hover:text-stone-200",
          )}
        >
          <UserPlus className="size-3" /> {copy.new}
        </button>
        {npcs.map((npc) => (
          <button
            key={npc.id}
            type="button"
            title={describeNpc(draftFrom(npc as Parameters<typeof draftFrom>[0]))}
            onClick={() => onOpen(npc)}
            className={cn(
              "flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px]",
              npc.id === selectedId
                ? "border-amber-700 bg-amber-950/50 text-amber-100"
                : "border-stone-700 text-stone-400 hover:text-stone-200",
              npc.archived && "opacity-50",
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={npc.portraitUrl || npcPlaceholder(npc.role, npc.name)}
              alt=""
              className="size-4 rounded-full object-cover"
            />
            {npc.name}
          </button>
        ))}
      </div>
      {npcs.length === 0 ? (
        <p className="text-[11px] text-stone-500">
          {copy.empty}
        </p>
      ) : null}
    </section>
  );
}

// The painted face of an attitude; "indifferent" is the engine's word for
// what the glyph set calls neutral.
const ATTITUDE_GLYPH: Record<string, string> = {
  friendly: "attitude-friendly",
  hostile: "attitude-hostile",
  indifferent: "attitude-neutral",
};

const ATTITUDE_TAG: Record<string, string> = {
  friendly: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  hostile: "border-red-500/40 bg-red-500/10 text-red-300",
  indifferent: "border-stone-600/60 bg-stone-800/60 text-stone-400",
};

// The first goal that has words in it, longest horizon first: an ambition
// says more about a person than what they want from the next scene.
function wants(npc: Npc): string {
  const { goals } = npc.agency;
  return (goals.ambition || goals.session?.text || goals.scene || "").trim();
}

function matches(npc: Npc, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  return [npc.name, ...npc.aliases].some((name) => name.toLowerCase().includes(needle));
}

export function CastRows({ npcs, onOpen }: Omit<ListProps, "selectedId">) {
  const { locale } = useI18n();
  const copy = localeText(locale, { en: { search: "Search the cast", searchLabel: "Search the cast by name or alias", new: "Someone new", archived: "set aside", relation: "relationship", relations: "relationships", wants: "wants", empty: "Nobody written yet. Everything here also fills itself in as the party meets people.", noMatch: "Nobody by that name or alias." }, ru: { search: "Поиск персонажей", searchLabel: "Искать персонажа по имени или прозвищу", new: "Новый персонаж", archived: "отложен", relation: "связь", relations: "связей", wants: "цель", empty: "Пока никого нет. Этот список также пополняется, когда группа знакомится с людьми.", noMatch: "Никого с таким именем или прозвищем нет." } });
  const [query, setQuery] = useState("");
  const shown = npcs.filter((npc) => matches(npc, query));

  return (
    <div className="space-y-2">
      <label className="relative block" data-tour="cast-search">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-500" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={copy.search}
          aria-label={copy.searchLabel}
          className={`${ui.input} pl-9`}
        />
      </label>

      <ul className="space-y-2">
        {shown.map((npc) => {
          const goal = wants(npc);
          const relations = npc.agency.relations.length;
          return (
            <li key={npc.id}>
              <button
                type="button"
                onClick={() => onOpen(npc)}
                className={cn(
                  ui.cardHover,
                  "flex w-full items-start gap-3 p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40",
                  npc.archived && "opacity-60",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={npc.portraitUrl || npcPlaceholder(npc.role, npc.name)}
                  alt=""
                  className="size-11 shrink-0 rounded-full border border-amber-400/25 bg-stone-950 object-cover"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-display tracking-wide text-amber-50">{npc.name}</span>
                    {npc.role ? (
                      <span className="text-xs text-stone-400">{npcRoleLabel(npc.role)}</span>
                    ) : null}
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-sm border py-0.5 pl-0.5 pr-1.5 text-[10px] uppercase tracking-wider",
                        ATTITUDE_TAG[npc.attitude] ?? ATTITUDE_TAG.indifferent,
                      )}
                    >
                      <GameIcon icon={{ kind: "glyph", key: ATTITUDE_GLYPH[npc.attitude] ?? "attitude-neutral" }} size="size-3.5" />
                      {npc.attitude}
                    </span>
                    {npc.archived ? (
                      <span className="rounded-sm border border-stone-600/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-stone-500">
                        {copy.archived}
                      </span>
                    ) : null}
                  </div>
                  {npc.location ? (
                    <p className="truncate text-xs text-stone-500">{npc.location}</p>
                  ) : null}
                  {npc.trait ? (
                    <p className="mt-1 line-clamp-2 text-sm text-stone-300">{npc.trait}</p>
                  ) : null}
                  <p className="mt-1 truncate text-[11px] text-stone-500">
                    {relations} {relations === 1 ? copy.relation : copy.relations}
                    {goal ? <> · {copy.wants}: {goal}</> : null}
                  </p>
                </div>
              </button>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            onClick={() => onOpen(null)}
            data-tour="cast-new"
            className={cn(
              ui.cardHover,
              "flex w-full items-center gap-3 border-dashed p-3 text-left text-stone-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40",
            )}
          >
            <span className="relative shrink-0">
              <GameIcon icon={{ kind: "glyph", key: "system-cast" }} size="size-11" />
              <UserPlus className="absolute -bottom-1 -right-1 size-4 rounded-full bg-stone-900 p-0.5 text-amber-300" aria-hidden="true" />
            </span>
            <span className="font-display tracking-wide">{copy.new}</span>
          </button>
        </li>
      </ul>

      {npcs.length === 0 ? (
        <p className="text-[11px] text-stone-500">
          {copy.empty}
        </p>
      ) : shown.length === 0 ? (
        <p className="text-[11px] text-stone-500">{copy.noMatch}</p>
      ) : null}
    </div>
  );
}
