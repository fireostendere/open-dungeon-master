"use client";

// Watches the campaign state for big moments and plays their cinematics one
// at a time: combat start, your turn, an enemy slain, combat won, a hero at
// 0 HP or dead, loot in your hands, a rest.
//
// The stream only hands us reduced state (and rebuilds it from a snapshot
// every few seconds), so every trigger is a change between the previous and
// the current value, with a baseline taken on first sight so reloading the
// page mid-session never replays anything.

import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicEncounter } from "@/lib/db/encounter-view";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { AuditEntry } from "@/app/campaigns/[campaignId]/useCampaignStream";
import { useI18n } from "@/lib/i18n";
import { CombatStart, type InitiativeEntry } from "@/components/fx/cinematics/CombatStart";
import { SlainBanner, TurnBanner } from "@/components/fx/cinematics/Banners";
import { FallenCinematic, LootReveal, RestCinematic } from "@/components/fx/cinematics/Moments";
import { lootIcon, lootRarity } from "@/components/fx/cinematics/loot-look";

type Item =
  | { id: number; kind: "combat"; round: number; order: InitiativeEntry[] }
  | { id: number; kind: "turn"; subtitle: string }
  | { id: number; kind: "slain"; name: string }
  | { id: number; kind: "won" }
  | { id: number; kind: "fallen"; name: string; mine: boolean; dead: boolean; successes: number; failures: number }
  | { id: number; kind: "loot"; item: string; qty: number }
  | { id: number; kind: "rest"; rest: "long" | "short" };

type NewItem = Item extends infer T ? (T extends Item ? Omit<T, "id"> : never) : never;

const SEEN_ENCOUNTERS = "odm:fx-seen-encounters";
const OFF_KEY = "odm:cinematics";

function readSeen(): Set<string> {
  try {
    return new Set(JSON.parse(window.sessionStorage.getItem(SEEN_ENCOUNTERS) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function writeSeen(seen: Set<string>) {
  try {
    window.sessionStorage.setItem(SEEN_ENCOUNTERS, JSON.stringify([...seen].slice(-20)));
  } catch {
    // Replays on reload are harmless.
  }
}

export function FxDirector({
  encounter,
  ownCombatTurn,
  sheets,
  meId,
  auditLog,
}: {
  encounter: PublicEncounter | null;
  ownCombatTurn: boolean;
  sheets: CharacterSheet[];
  meId: string | undefined;
  auditLog: AuditEntry[];
}) {
  const { locale } = useI18n();
  const copy =
    locale === "ru"
      ? { round: "Раунд", won: "Бой выигран", wonSub: "Все враги повержены" }
      : { round: "Round", won: "Victory", wonSub: "Every foe has fallen" };
  const [queue, setQueue] = useState<Item[]>([]);
  const nextId = useRef(1);
  const enabled = useRef(true);

  useEffect(() => {
    try {
      enabled.current = window.localStorage.getItem(OFF_KEY) !== "off";
    } catch {
      enabled.current = true;
    }
  }, []);

  const push = useCallback((item: NewItem) => {
    if (!enabled.current || document.hidden) return;
    setQueue((q) => (q.length > 6 ? q : [...q, { ...item, id: nextId.current++ } as Item]));
  }, []);
  const done = useCallback(() => setQueue((q) => q.slice(1)), []);

  // --- combat start, enemies slain, combat won ---
  const seenRef = useRef<Set<string> | null>(null);
  const enemyStatus = useRef(new Map<string, string>());
  const lastEncounter = useRef<PublicEncounter | null>(null);
  const wonTimer = useRef<number | null>(null);
  const latestEncounter = useRef(encounter);
  useEffect(() => {
    latestEncounter.current = encounter;
  });

  useEffect(() => {
    if (!seenRef.current) {
      // First sight: whatever fight is already on is not news.
      seenRef.current = readSeen();
      if (encounter) {
        seenRef.current.add(encounter.id);
        writeSeen(seenRef.current);
      }
    }
    const seen = seenRef.current;
    if (encounter && encounter.status === "active") {
      if (!seen.has(encounter.id)) {
        seen.add(encounter.id);
        writeSeen(seen);
        enemyStatus.current.clear();
        push({
          kind: "combat",
          round: encounter.round,
          order: encounter.orderReady
            ? encounter.order.filter((e) => !e.hidden).map((e) => ({ id: e.id, name: e.name, kind: e.kind, initiative: e.initiative }))
            : [],
        });
      }
      for (const enemy of encounter.enemies) {
        const before = enemyStatus.current.get(enemy.id);
        if (before === "alive" && enemy.status === "dead" && !enemy.hidden) push({ kind: "slain", name: enemy.name });
        enemyStatus.current.set(enemy.id, enemy.status);
      }
      lastEncounter.current = encounter;
      if (wonTimer.current) {
        window.clearTimeout(wonTimer.current);
        wonTimer.current = null;
      }
    } else if (lastEncounter.current && !wonTimer.current) {
      // Some emitters briefly null the encounter; only a fight that stays
      // gone, with every visible enemy down, counts as won.
      const last = lastEncounter.current;
      wonTimer.current = window.setTimeout(() => {
        wonTimer.current = null;
        const now = latestEncounter.current;
        if (now && now.status === "active") return;
        lastEncounter.current = null;
        const visible = last.enemies.filter((e) => !e.hidden);
        const statuses = visible.map((e) => enemyStatus.current.get(e.id) ?? e.status);
        if (visible.length && statuses.every((s) => s !== "alive") && statuses.some((s) => s === "dead")) push({ kind: "won" });
      }, 1800);
    }
  }, [encounter, push]);

  useEffect(() => () => {
    if (wonTimer.current) window.clearTimeout(wonTimer.current);
  }, []);

  // --- your turn ---
  const prevTurn = useRef<boolean | null>(null);
  const mySheet = sheets.find((s) => s.userId === meId);
  useEffect(() => {
    if (prevTurn.current === false && ownCombatTurn && mySheet) {
      push({ kind: "turn", subtitle: `${mySheet.name} · ${copy.round} ${encounter?.round ?? 1}` });
    }
    prevTurn.current = ownCombatTurn;
  }, [ownCombatTurn, mySheet, encounter?.round, copy.round, push]);

  // --- 0 HP and death ---
  const hpRef = useRef(new Map<string, { hp: number; dead: boolean }>());
  useEffect(() => {
    for (const sheet of sheets) {
      const hp = sheet.currentHp ?? 0;
      const dead = Boolean(sheet.deathSaves?.dead);
      const before = hpRef.current.get(sheet.id);
      if (before) {
        const mine = sheet.userId === meId;
        if (dead && !before.dead) {
          push({ kind: "fallen", name: sheet.name, mine, dead: true, successes: 0, failures: 3 });
        } else if (before.hp > 0 && hp <= 0 && !dead) {
          push({ kind: "fallen", name: sheet.name, mine, dead: false, successes: sheet.deathSaves?.successes ?? 0, failures: sheet.deathSaves?.failures ?? 0 });
        }
      }
      hpRef.current.set(sheet.id, { hp, dead });
    }
  }, [sheets, meId, push]);

  // --- loot and rest, from the audit trail ---
  const auditSeq = useRef<number | null>(null);
  useEffect(() => {
    const maxSeq = auditLog.reduce((m, e) => Math.max(m, e.seq), 0);
    if (auditSeq.current === null) {
      auditSeq.current = maxSeq;
      return;
    }
    const since = auditSeq.current;
    auditSeq.current = Math.max(since, maxSeq);
    if (!mySheet) return;
    const fresh = auditLog.filter((e) => e.seq > since && e.characterId === mySheet.id && !e.revertedAt).sort((a, b) => a.seq - b.seq);
    for (const entry of fresh) {
      if (entry.kind === "grant_item" && typeof entry.delta.name === "string") {
        push({ kind: "loot", item: entry.delta.name, qty: typeof entry.delta.qty === "number" ? entry.delta.qty : 1 });
      } else if (entry.kind === "rest_long" || entry.kind === "rest_short") {
        push({ kind: "rest", rest: entry.kind === "rest_long" ? "long" : "short" });
      }
    }
  }, [auditLog, mySheet, push]);

  const current = queue[0];
  if (!current) return null;
  switch (current.kind) {
    case "combat":
      return <CombatStart key={current.id} active round={current.round} order={current.order} onDone={done} />;
    case "turn":
      return <TurnBanner key={current.id} active subtitle={current.subtitle} onDone={done} />;
    case "slain":
      return <SlainBanner key={current.id} active name={current.name} onDone={done} />;
    case "won":
      return (
        <TurnBanner
          key={current.id}
          active
          tone="emerald"
          title={copy.won}
          subtitle={copy.wonSub}
          onDone={done}
        />
      );
    case "fallen":
      return (
        <FallenCinematic
          key={current.id}
          active
          name={current.name}
          mine={current.mine}
          dead={current.dead}
          successes={current.successes}
          failures={current.failures}
          onDone={done}
        />
      );
    case "loot":
      return <LootReveal key={current.id} active item={current.item} qty={current.qty} rarity={lootRarity(current.item)} icon={lootIcon(current.item)} onDone={done} />;
    case "rest":
      return <RestCinematic key={current.id} active kind={current.rest} onDone={done} />;
  }
}
