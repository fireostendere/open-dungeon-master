"use client";

import { ChevronDown, ChevronRight, Skull, Swords, Wind } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { MonsterTile } from "@/lib/ui";
import { HEALTH_COLORS } from "@/lib/bestiary/health";
import { DmInitiativePanel } from "@/app/campaigns/[campaignId]/DmInitiativePanel";
import type { PublicEncounter } from "@/lib/db/encounter-view";
import { useI18n } from "@/lib/i18n/context";
import { localeText } from "@/lib/i18n/locale-text";

function crLabel(cr: number): string {
  if (cr === 0.125) return "1/8";
  if (cr === 0.25) return "1/4";
  if (cr === 0.5) return "1/2";
  return String(cr);
}

// Live enemy roster during combat. Deliberately vague: players see health
// states, never numbers; exact HP stays on the server.
export function EncounterPanel({
  campaignId,
  encounter,
  steersStory,
  canEditOrder = false,
  embedded = false,
  genre,
}: {
  campaignId: string;
  encounter: PublicEncounter;
  steersStory: boolean;
  // The DM seat, which is who /dm/initiative answers. A party lead steers the
  // story but does not rearrange the turn order.
  canEditOrder?: boolean;
  embedded?: boolean;
  // The table's setting, so a high-rating enemy draws the genre's boss plate.
  genre?: string | null;
}) {
  const { locale } = useI18n();
  const copy = localeText(locale, { en: { confirm: "End this encounter without a resolution? No XP is awarded.", combat: "Combat", round: "Round", rolling: "Rolling initiative", force: "Force-end the encounter (lead only)", end: "End encounter", of: "of", standing: "standing", fled: "fled", rounds: "rd", hidden: "hidden" }, ru: { confirm: "Завершить эту встречу без исхода? Опыт не начисляется.", combat: "Бой", round: "Раунд", rolling: "Бросок инициативы", force: "Принудительно завершить встречу (только ведущий)", end: "Завершить встречу", of: "из", standing: "на ногах", fled: "сбежал", rounds: "раунд.", hidden: "скрыт" } });
  const [ending, setEnding] = useState(false);
  const [openGroups, setOpenGroups] = useState<string[]>([]);

  // A mob is every enemy from the same stat block. Initiative never rested
  // on enemies one at a time (advanceOrder walks past all of them to the
  // next player), so collapsing four goblins into one line loses nothing and
  // stops a swarm burying the roster. A group of one is just a row.
  const groups = useMemo(() => {
    const byKey = new Map<string, PublicEncounter["enemies"]>();
    for (const enemy of encounter.enemies) {
      const key = enemy.groupKey || enemy.id;
      byKey.set(key, [...(byKey.get(key) ?? []), enemy]);
    }
    return [...byKey.entries()].map(([key, members]) => ({ key, members }));
  }, [encounter.enemies]);

  async function forceEnd() {
    if (!window.confirm(copy.confirm)) {
      return;
    }
    setEnding(true);
    try {
      await fetch(`/api/campaigns/${campaignId}/encounter`, { method: "DELETE" });
    } finally {
      setEnding(false);
    }
  }

  return (
    <section
      className={cn(
        "rounded-lg border border-red-900/50 bg-red-950/10",
        embedded ? "p-3" : "p-4",
      )}
    >
      <header className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-red-300">
          <Swords className="size-4" />
           {copy.combat}{encounter.orderReady ? ` · ${copy.round} ${encounter.round}` : ` · ${copy.rolling}`}
        </h2>
        {steersStory ? (
          <button
            type="button"
            onClick={forceEnd}
            disabled={ending}
            className="text-xs text-stone-500 hover:text-red-300 disabled:opacity-50"
             title={copy.force}
          >
             {copy.end}
          </button>
        ) : null}
      </header>
      <ul className="space-y-1.5">
        {groups.flatMap((group) => {
          const standing = group.members.filter((member) => member.status === "alive");
          // One of a kind, or a mob the DM has opened up: show the members.
          if (group.members.length === 1 || openGroups.includes(group.key)) {
            const header =
              group.members.length === 1
                ? []
                : [
                    <li key={`${group.key}-header`}>
                      <button
                        type="button"
                        onClick={() =>
                          setOpenGroups((current) =>
                            current.filter((key) => key !== group.key),
                          )
                        }
                        className="flex w-full items-center gap-1 text-xs text-stone-500 hover:text-stone-300"
                      >
                        <ChevronDown className="size-3.5" />
                         {group.members[0].name.replace(/\s+\d+$/, "")} · {standing.length} {copy.of} {group.members.length} {copy.standing}
                      </button>
                    </li>,
                  ];
            return [...header, ...group.members.map((enemy) => renderEnemy(enemy))];
          }
          return [
            <li key={group.key}>
              <button
                type="button"
                onClick={() => setOpenGroups((current) => [...current, group.key])}
                className={cn(
                  "flex w-full items-center justify-between rounded-md border border-stone-800 bg-stone-950/60 px-2.5 py-1.5 text-left",
                  !standing.length && "opacity-60",
                )}
              >
                <span className="flex min-w-0 items-center gap-1.5 text-sm text-stone-200">
                  <ChevronRight className="size-3.5 shrink-0 text-stone-500" />
                  <span className="truncate">
                    {group.members[0].name.replace(/\s+\d+$/, "")} x{group.members.length}
                  </span>
                  <span className="shrink-0 rounded border border-stone-700 px-1 text-[10px] text-stone-500">
                    CR {crLabel(group.members[0].cr)}
                  </span>
                </span>
                <span className="ml-2 shrink-0 text-[10px] text-stone-500">
                   {standing.length} {copy.standing}
                </span>
              </button>
            </li>,
          ];
        })}
      </ul>
      {canEditOrder ? (
        <DmInitiativePanel campaignId={campaignId} encounter={encounter} />
      ) : null}
    </section>
  );

  function renderEnemy(enemy: PublicEncounter["enemies"][number]) {
          const out = enemy.status !== "alive";
          return (
            <li
              key={enemy.id}
              className={cn(
                "rounded-md border border-stone-800 bg-stone-950/60 px-2.5 py-1.5",
                out && "opacity-60",
              )}
            >
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    "flex min-w-0 items-center gap-1.5 text-sm text-stone-200",
                    out && "line-through decoration-stone-500",
                  )}
                >
                  <MonsterTile
                    type={enemy.type}
                    cr={enemy.cr}
                    genre={genre}
                    seed={enemy.name}
                    size="size-6"
                    className={out ? "grayscale" : ""}
                  />
                  {enemy.status === "dead" ? (
                    <Skull className="size-3.5 shrink-0 text-stone-500" />
                  ) : enemy.status === "fled" ? (
                    <Wind className="size-3.5 shrink-0 text-stone-500" />
                  ) : null}
                  <span className="truncate">{enemy.name}</span>
                  <span className="shrink-0 rounded border border-stone-700 px-1 text-[10px] text-stone-500">
                    CR {crLabel(enemy.cr)}
                  </span>
                </span>
                <span
                  className={cn(
                    "ml-2 shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize",
                    HEALTH_COLORS[enemy.status === "fled" ? "dead" : enemy.health],
                  )}
                >
                   {enemy.status === "fled" ? copy.fled : enemy.health}
                </span>
                {/* Exact HP may be campaign-visible; AC remains DM-only. */}
                {enemy.currentHp !== undefined && enemy.status === "alive" ? (
                  <span className="ml-1.5 shrink-0 rounded-full border border-amber-900/60 bg-amber-950/30 px-2 py-0.5 font-mono text-[10px] text-amber-200/90">
                    {enemy.currentHp}/{enemy.maxHp} HP{enemy.ac !== undefined ? ` · AC ${enemy.ac}` : ""}
                  </span>
                ) : null}
              </div>
              {enemy.hpPercent !== undefined && enemy.status === "alive" ? (
                <div
                  className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-stone-800"
                  role="progressbar"
                  aria-label={`${enemy.name} HP`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={enemy.hpPercent}
                >
                  <div
                    className="h-full rounded-full bg-red-700 transition-[width]"
                    style={{ width: `${enemy.hpPercent}%` }}
                  />
                </div>
              ) : null}
              {enemy.conditions?.length ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {enemy.conditions.map((condition) => (
                    <span
                      key={condition}
                      className="rounded-full border border-amber-900/60 bg-amber-950/30 px-1.5 py-px text-[10px] capitalize text-amber-300"
                    >
                      {condition}
                      {enemy.conditionRounds?.[condition]
                         ? ` (${enemy.conditionRounds[condition]} ${copy.rounds})`
                        : ""}
                    </span>
                  ))}
                </div>
              ) : null}
            </li>
          );
  }
}
