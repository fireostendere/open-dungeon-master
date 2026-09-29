"use client";

import { useMemo, useState } from "react";
import {
  Flame,
  Heart,
  RotateCcw,
  ScrollText,
  Shield,
  ShieldAlert,
  Skull,
  Sparkles,
  Swords,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n/context";
import { localeText } from "@/lib/i18n/locale-text";
import type { PublicEncounter } from "@/lib/db/encounter-view";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { StoredRoll } from "@/lib/db/rolls";
import type { AuditEntry } from "@/app/campaigns/[campaignId]/useCampaignStream";

export type CombatLogFilter = "all" | "attacks" | "healing" | "casualties";

type CombatLogItem = {
  id: string;
  timestamp: number;
  category: "attacks" | "healing" | "casualties" | "other";
  icon: typeof Swords;
  iconColor: string;
  badgeClass: string;
  badgeText: string;
  actor: string;
  action: string;
  target?: string;
  detail?: string;
  resultClass?: string;
  resultText?: string;
  extra?: string;
};

export function CombatLog({
  encounter,
  sheets,
  rolls = [],
  auditLog = [],
}: {
  encounter: PublicEncounter | null;
  sheets: CharacterSheet[];
  rolls: StoredRoll[];
  auditLog: AuditEntry[];
}) {
  const { locale } = useI18n();
  const [filter, setFilter] = useState<CombatLogFilter>("all");

  const copy = localeText(locale, {
    en: {
      title: "Combat Log",
      empty: "No combat rolls or damage recorded yet.",
      all: "All",
      attacks: "Attacks & Damage",
      healing: "Healing",
      casualties: "Casualties",
      hit: "HIT",
      miss: "MISS",
      critHit: "CRIT HIT!",
      critMiss: "CRIT MISS!",
      attackRoll: "Attack",
      damageRoll: "Damage",
      save: "Save",
      damageTaken: "Damage taken",
      healed: "Healed",
      condition: "Condition",
      slain: "Slain",
      fled: "Fled",
      unconscious: "Unconscious (0 HP)",
      hpRemaining: "HP remaining",
      round: "Round",
      aliveEnemies: "Alive enemies",
      fallenEnemies: "Fallen",
      hero: "Hero",
      enemy: "Enemy",
      character: "Character",
      total: "Total",
      damageAbbrev: "dmg",
      success: "Success",
      failure: "Failure",
      tempHpAction: "Temporary HP",
      conditionApplied: "Condition applied",
    },
    ru: {
      title: "Журнал боя",
      empty: "В этом бою пока нет зафиксированных ударов и урона.",
      all: "Все",
      attacks: "Атаки и урон",
      healing: "Лечение",
      casualties: "Потери",
      hit: "ПОПАДАНИЕ",
      miss: "ПРОМАХ",
      critHit: "КРИТИЧЕСКИЙ УДАР!",
      critMiss: "КРИТИЧЕСКИЙ ПРОМАХ!",
      attackRoll: "Атака",
      damageRoll: "Урон",
      save: "Спасбросок",
      damageTaken: "Получен урон",
      healed: "Исцеление",
      condition: "Состояние",
      slain: "Повержен",
      fled: "Сбежал",
      unconscious: "Без сознания (0 HP)",
      hpRemaining: "осталось HP",
      round: "Раунд",
      aliveEnemies: "Живых врагов",
      fallenEnemies: "Повержено",
      hero: "Герой",
      enemy: "Враг",
      character: "Персонаж",
      total: "Итог",
      damageAbbrev: "урона",
      success: "Успех",
      failure: "Провал",
      tempHpAction: "Временные ОЗ",
      conditionApplied: "Получено состояние",
    },
  });

  const sheetNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const sheet of sheets) {
      map.set(sheet.id, sheet.name);
    }
    return map;
  }, [sheets]);

  const enemyNameById = useMemo(() => {
    const map = new Map<string, string>();
    if (encounter?.enemies) {
      for (const enemy of encounter.enemies) {
        map.set(enemy.id, enemy.name);
      }
    }
    return map;
  }, [encounter]);

  const parseRollName = (detail: string): { actor?: string; weapon: string } => {
    if (!detail) return { weapon: "" };
    if (detail.includes(":")) {
      const parts = detail.split(":");
      return { actor: parts[0].trim(), weapon: parts.slice(1).join(":").trim() };
    }
    return { weapon: detail.trim() };
  };

  const feedItems = useMemo<CombatLogItem[]>(() => {
    const items: CombatLogItem[] = [];

    // 1. Process Rolls (attacks, damage, saves)
    for (const roll of rolls) {
      const parsed = parseRollName(roll.detail);
      const isPlayerRoll = roll.requestedBy === "player" || (roll.characterId && sheetNameById.has(roll.characterId));
      const actorName = isPlayerRoll
        ? (roll.characterId ? sheetNameById.get(roll.characterId) : undefined) ?? parsed.actor ?? copy.hero
        : parsed.actor ?? copy.enemy;

      const targetName = roll.targetEnemyId
        ? enemyNameById.get(roll.targetEnemyId) ?? copy.enemy
        : !isPlayerRoll && roll.characterId
          ? sheetNameById.get(roll.characterId) ?? copy.hero
          : undefined;

      const time = roll.createdAt ? new Date(roll.createdAt).getTime() : (roll.eventSeq ?? 0);

      if (roll.kind === "attack") {
        const isCrit20 = roll.breakdown?.crit === "nat20";
        const isCrit1 = roll.breakdown?.crit === "nat1";
        const hit = roll.success === true;
        const miss = roll.success === false;

        let badgeText = hit ? copy.hit : miss ? copy.miss : copy.attackRoll;
        let badgeClass = hit
          ? "border-emerald-600/60 bg-emerald-950/40 text-emerald-200"
          : miss
            ? "border-stone-700 bg-stone-900/60 text-stone-400"
            : "border-amber-700/60 bg-amber-950/40 text-amber-200";

        if (isCrit20) {
          badgeText = copy.critHit;
          badgeClass = "border-amber-400 bg-amber-500/20 text-amber-200 font-bold shadow-sm";
        } else if (isCrit1) {
          badgeText = copy.critMiss;
          badgeClass = "border-red-600 bg-red-950/40 text-red-300 font-bold";
        }

        items.push({
          id: `roll-${roll.id}`,
          timestamp: time,
          category: "attacks",
          icon: isCrit20 ? Sparkles : Swords,
          iconColor: isCrit20 ? "text-amber-300" : hit ? "text-emerald-400" : "text-stone-400",
          badgeClass,
          badgeText,
          actor: actorName,
          action: parsed.weapon ? `(${parsed.weapon})` : "",
          target: targetName,
          resultText: `${copy.total}: ${roll.total}`,
          resultClass: hit ? "text-emerald-300 font-semibold" : "text-stone-400",
        });
      } else if (roll.kind === "damage") {
        items.push({
          id: `roll-${roll.id}`,
          timestamp: time,
          category: "attacks",
          icon: Flame,
          iconColor: "text-red-400",
          badgeClass: "border-red-800/60 bg-red-950/40 text-red-200 font-semibold",
          badgeText: `${roll.total} ${copy.damageAbbrev}`,
          actor: actorName,
          action: parsed.weapon ? `(${parsed.weapon})` : "",
          target: targetName,
          detail: roll.expression ? `[${roll.expression}]` : undefined,
        });
      } else if (roll.kind === "saving_throw") {
        const success = roll.success === true;
        items.push({
          id: `roll-${roll.id}`,
          timestamp: time,
          category: "other",
          icon: Shield,
          iconColor: success ? "text-sky-400" : "text-amber-500",
          badgeClass: success
            ? "border-sky-700/60 bg-sky-950/40 text-sky-200"
            : "border-red-900/60 bg-red-950/30 text-red-300",
          badgeText: `${copy.save}: ${roll.total}${roll.dc ? ` vs DC ${roll.dc}` : ""}`,
          actor: actorName,
          action: roll.detail ? `(${roll.detail})` : "",
          resultText: roll.success !== null ? (success ? copy.success : copy.failure) : undefined,
          resultClass: success ? "text-sky-300" : "text-red-400",
        });
      }
    }

    // 2. Process Audit Log (damage applied to party, heals, conditions)
    for (const entry of auditLog) {
      const time = entry.createdAt ? new Date(entry.createdAt).getTime() : entry.seq;
      const charName = entry.characterName ?? (entry.characterId ? sheetNameById.get(entry.characterId) : undefined) ?? copy.character;

      if (entry.kind === "apply_damage") {
        const d = entry.delta as { amount?: number; currentHp?: number; type?: string };
        const amount = d.amount ?? 0;
        const currentHp = d.currentHp;
        const isDead = typeof currentHp === "number" && currentHp <= 0;

        items.push({
          id: `audit-${entry.id}`,
          timestamp: time,
          category: isDead ? "casualties" : "attacks",
          icon: isDead ? Skull : ShieldAlert,
          iconColor: isDead ? "text-red-500" : "text-rose-400",
          badgeClass: isDead
            ? "border-red-600 bg-red-950 text-red-200 font-bold"
            : "border-rose-800/60 bg-rose-950/40 text-rose-200",
          badgeText: isDead ? copy.unconscious : `-${amount} HP`,
          actor: charName,
          action: `${copy.damageTaken}: ${amount} ${d.type ? `(${d.type})` : ""}`,
          detail: typeof currentHp === "number" ? `(${copy.hpRemaining}: ${currentHp})` : undefined,
        });
      } else if (entry.kind === "heal") {
        const d = entry.delta as { amount?: number; newHp?: number };
        const amount = d.amount ?? 0;

        items.push({
          id: `audit-${entry.id}`,
          timestamp: time,
          category: "healing",
          icon: Heart,
          iconColor: "text-emerald-400",
          badgeClass: "border-emerald-700/60 bg-emerald-950/40 text-emerald-200 font-semibold",
          badgeText: `+${amount} HP`,
          actor: charName,
          action: copy.healed,
          detail: typeof d.newHp === "number" ? `(HP: ${d.newHp})` : undefined,
        });
      } else if (entry.kind === "grant_temp_hp") {
        const d = entry.delta as { tempHp?: number };
        items.push({
          id: `audit-${entry.id}`,
          timestamp: time,
          category: "healing",
          icon: Shield,
          iconColor: "text-amber-300",
          badgeClass: "border-amber-700/60 bg-amber-950/40 text-amber-200",
          badgeText: `+${d.tempHp ?? 0} Temp HP`,
          actor: charName,
          action: copy.tempHpAction,
        });
      } else if (entry.kind === "set_condition") {
        const d = entry.delta as { condition?: string };
        items.push({
          id: `audit-${entry.id}`,
          timestamp: time,
          category: "other",
          icon: Zap,
          iconColor: "text-amber-400",
          badgeClass: "border-amber-800/60 bg-amber-950/30 text-amber-300",
          badgeText: `${copy.condition}: ${d.condition ?? ""}`,
          actor: charName,
          action: copy.conditionApplied,
        });
      }
    }

    // Keep status-only rows next to the newest recorded event without using wall-clock time.
    const latestEventTimestamp = items.reduce(
      (latest, item) => Math.max(latest, item.timestamp),
      0,
    );

    // 3. Process fallen enemies
    if (encounter?.enemies) {
      for (const enemy of encounter.enemies) {
        if (enemy.status === "dead") {
          items.push({
            id: `enemy-dead-${enemy.id}`,
            timestamp: latestEventTimestamp + 1,
            category: "casualties",
            icon: Skull,
            iconColor: "text-red-400",
            badgeClass: "border-red-900 bg-red-950/80 text-red-200 font-bold",
            badgeText: copy.slain,
            actor: enemy.name,
            action: copy.slain,
          });
        } else if (enemy.status === "fled") {
          items.push({
            id: `enemy-fled-${enemy.id}`,
            timestamp: latestEventTimestamp,
            category: "casualties",
            icon: RotateCcw,
            iconColor: "text-stone-400",
            badgeClass: "border-stone-700 bg-stone-900 text-stone-300",
            badgeText: copy.fled,
            actor: enemy.name,
            action: copy.fled,
          });
        }
      }
    }

    // Sort newest first
    return items.sort((a, b) => b.timestamp - a.timestamp);
  }, [rolls, auditLog, encounter?.enemies, sheetNameById, enemyNameById, copy]);

  const filteredItems = useMemo(() => {
    if (filter === "all") return feedItems;
    return feedItems.filter((item) => item.category === filter);
  }, [feedItems, filter]);

  const aliveCount = encounter?.enemies.filter((e) => e.status === "alive").length ?? 0;
  const deadCount = encounter?.enemies.filter((e) => e.status === "dead").length ?? 0;

  return (
    <section className="rounded-xl border border-stone-800 bg-stone-950/80 p-3 shadow-elev-1">
      {/* Header */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-stone-800/80 pb-2">
        <div className="flex items-center gap-1.5 text-stone-200 font-medium">
          <ScrollText className="size-4 text-amber-400" />
          <span>{copy.title}</span>
          <span className="ml-1 rounded-full bg-stone-800 px-2 py-0.5 text-[11px] text-stone-400">
            {feedItems.length}
          </span>
        </div>

        {/* Quick Encounter Status */}
        {encounter ? (
          <div className="flex items-center gap-2 text-xs">
            <span className="rounded bg-amber-950/60 px-2 py-0.5 text-amber-300 font-semibold border border-amber-800/40">
              {copy.round} {encounter.round}
            </span>
            <span className="text-stone-400">
              {copy.aliveEnemies}: <strong className="text-stone-200">{aliveCount}</strong>
            </span>
            {deadCount > 0 ? (
              <span className="text-red-400 flex items-center gap-0.5">
                <Skull className="size-3" /> {deadCount}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Filter Tabs */}
      <div className="mb-3 flex flex-wrap items-center gap-1">
        {(
          [
            ["all", copy.all],
            ["attacks", copy.attacks],
            ["healing", copy.healing],
            ["casualties", copy.casualties],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={cn(
              "rounded-lg px-2.5 py-1 text-xs transition-colors",
              filter === key
                ? "bg-amber-500/20 text-amber-200 font-medium border border-amber-600/50"
                : "text-stone-400 hover:text-stone-200 hover:bg-stone-900 border border-transparent",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Event Stream */}
      {filteredItems.length === 0 ? (
        <div className="py-6 text-center text-xs text-stone-500">
          <p>{copy.empty}</p>
        </div>
      ) : (
        <ol className="max-h-[min(460px,45dvh)] space-y-1.5 overflow-y-auto overscroll-contain pr-1">
          {filteredItems.map((item) => {
            const Icon = item.icon;
            return (
              <li
                key={item.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-stone-800/80 bg-stone-900/50 px-2.5 py-1.5 text-xs text-stone-300 hover:border-stone-700/80 transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Icon className={cn("size-3.5 shrink-0", item.iconColor)} />
                  <div className="min-w-0 truncate">
                    <span className="font-semibold text-stone-200">{item.actor}</span>
                    {item.target ? (
                      <>
                        <span className="text-stone-500 mx-1">→</span>
                        <span className="text-stone-300">{item.target}</span>
                      </>
                    ) : null}
                    {item.action ? (
                      <span className="text-stone-400 ml-1.5">{item.action}</span>
                    ) : null}
                    {item.detail ? (
                      <span className="text-stone-500 ml-1.5 text-[11px]">{item.detail}</span>
                    ) : null}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {item.resultText ? (
                    <span className={cn("text-[11px]", item.resultClass)}>
                      {item.resultText}
                    </span>
                  ) : null}
                  <span
                    className={cn(
                      "rounded border px-1.5 py-0.5 text-[10px] tracking-wide uppercase",
                      item.badgeClass,
                    )}
                  >
                    {item.badgeText}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
