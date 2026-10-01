"use client";

import { Heart, HeartCrack, Loader2, Users } from "lucide-react";
import { GameIcon } from "@/components/ui/GameIcon";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import type { FriendshipTier, RomanceStage } from "@/lib/dm/relationship-logic";

// Where each character stands with the people they have dealt with. The
// server sends a tier WORD rather than the raw meter (the party lead also
// gets the number), so the table can see that the smith has warmed to them
// without turning the campaign into approval farming.

type RelationshipView = {
  id: string;
  characterId: string;
  characterName: string;
  subjectName: string;
  subjectKind: "npc" | "companion";
  tier: FriendshipTier;
  tierLabel: string;
  romance: RomanceStage;
  status: "active" | "parted" | "ended";
  apartChapters: number;
  history: string[];
  approval?: number;
};

// Eight tiers, five painted faces: each tier borrows the nearest one.
const TIER_GLYPH: Record<FriendshipTier, string> = {
  hostile: "attitude-hostile",
  disliked: "attitude-hostile",
  wary: "attitude-wary",
  neutral: "attitude-neutral",
  cordial: "attitude-friendly",
  friendly: "attitude-friendly",
  close: "attitude-allied",
  devoted: "attitude-allied",
};

const TIER_STYLES: Record<FriendshipTier, string> = {
  hostile: "border-red-900/60 bg-red-950/30 text-red-300",
  disliked: "border-red-900/40 bg-red-950/20 text-red-400/90",
  wary: "border-stone-700 bg-stone-900/40 text-stone-400",
  neutral: "border-stone-800 bg-stone-950/40 text-stone-500",
  cordial: "border-amber-900/40 bg-amber-950/20 text-amber-200/80",
  friendly: "border-amber-800/60 bg-amber-950/30 text-amber-200",
  close: "border-emerald-800/60 bg-emerald-950/30 text-emerald-200",
  devoted: "border-emerald-700 bg-emerald-950/40 text-emerald-100",
};

const COPY = {
  en: {
    tiers: {
      hostile: "Hostile",
      disliked: "Dislikes",
      wary: "Wary",
      neutral: "Neutral",
      cordial: "Cordial",
      friendly: "Friendly",
      close: "Close",
      devoted: "Devoted",
    },
    romance: {
      none: "",
      interested: "Interested",
      courting: "Courting",
      together: "Together",
      betrothed: "Betrothed",
      married: "Married",
    },
    companion: "companion",
    npc: "npc",
    away: "away",
    chapterShort: "ch",
    ended: "ended",
    romanceTitle: (stage: string) => `Romance: ${stage}`,
    trackingOff:
      "Relationship tracking is off for this campaign. The party lead can turn it on in Setup.",
    empty:
      "Nobody has an opinion yet. How NPCs and companions feel about each character builds as you deal with them, and shows up here.",
  },
  ru: {
    tiers: {
      hostile: "Враждебность",
      disliked: "Неприязнь",
      wary: "Настороженность",
      neutral: "Нейтрально",
      cordial: "Расположение",
      friendly: "Дружелюбие",
      close: "Близость",
      devoted: "Преданность",
    },
    romance: {
      none: "",
      interested: "Интерес",
      courting: "Ухаживание",
      together: "Вместе",
      betrothed: "Помолвка",
      married: "Брак",
    },
    companion: "спутник",
    npc: "NPC",
    away: "вдали",
    chapterShort: "гл.",
    ended: "завершено",
    romanceTitle: (stage: string) => `Романтика: ${stage}`,
    trackingOff:
      "Отслеживание отношений выключено для этой кампании. Лидер группы может включить его в настройках.",
    empty:
      "Пока ни у кого не сложилось заметного отношения. Оно будет формироваться по мере общения персонажей с NPC и спутниками и появится здесь.",
  },
} as const;

function BondRow({ bond }: { bond: RelationshipView }) {
  const { locale } = useI18n();
  const copy = COPY[locale];
  const romanceWord = copy.romance[bond.romance];
  return (
    <li className="rounded-md border border-stone-800 bg-stone-950/40 px-2.5 py-1.5">
      <div className="flex items-start gap-2">
        <GameIcon icon={{ kind: "glyph", key: TIER_GLYPH[bond.tier] }} size="size-6" />
        <span className="min-w-0 flex-1 text-xs text-stone-300">
          {bond.subjectName}
          <span className="ml-1.5 text-[10px] uppercase tracking-wide text-stone-600">
            {bond.subjectKind === "companion" ? copy.companion : copy.npc}
          </span>
          {bond.status === "parted" ? (
            <span className="ml-1.5 text-[10px] text-stone-500">
              {copy.away}
              {bond.apartChapters > 0 ? ` ${bond.apartChapters} ${copy.chapterShort}` : ""}
            </span>
          ) : null}
          {bond.status === "ended" ? (
            <span className="ml-1.5 text-[10px] text-stone-600">{copy.ended}</span>
          ) : null}
        </span>
        <span
          className={cn(
            "shrink-0 rounded-full border px-1.5 py-0.5 text-[10px]",
            TIER_STYLES[bond.tier],
          )}
          title={copy.tiers[bond.tier]}
        >
          {copy.tiers[bond.tier]}
          {bond.approval === undefined ? "" : ` ${bond.approval > 0 ? "+" : ""}${bond.approval}`}
        </span>
        {bond.romance !== "none" ? (
          <span
            className="flex shrink-0 items-center gap-1 rounded-full border border-rose-900/60 bg-rose-950/30 px-1.5 py-0.5 text-[10px] text-rose-200"
            title={copy.romanceTitle(romanceWord)}
          >
            {bond.status === "ended" ? (
              <HeartCrack className="size-2.5" />
            ) : (
              <Heart className="size-2.5" />
            )}
            {romanceWord}
          </span>
        ) : null}
      </div>
      {bond.history.length ? (
        <p className="mt-0.5 text-[11px] leading-4 text-stone-500">
          {bond.history[bond.history.length - 1]}
        </p>
      ) : null}
    </li>
  );
}

export function BondsPanel({ campaignId, refreshKey }: { campaignId: string; refreshKey: number }) {
  const { locale } = useI18n();
  const copy = COPY[locale];
  const [bonds, setBonds] = useState<RelationshipView[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/relationships`);
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      setEnabled(data.enabled !== false);
      setBonds(Array.isArray(data.relationships) ? data.relationships : []);
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (loading) {
    return (
      <p className="flex justify-center px-1 py-6 text-stone-600">
        <Loader2 className="size-4 animate-spin" />
      </p>
    );
  }
  if (!enabled) {
    return <p className="px-1 py-6 text-center text-xs text-stone-600">{copy.trackingOff}</p>;
  }
  if (!bonds.length) {
    return <p className="px-1 py-6 text-center text-xs text-stone-600">{copy.empty}</p>;
  }

  const byCharacter = new Map<string, RelationshipView[]>();
  for (const bond of bonds) {
    byCharacter.set(bond.characterId, [...(byCharacter.get(bond.characterId) ?? []), bond]);
  }

  return (
    <div className="space-y-3">
      {[...byCharacter.values()].map((group) => (
        <section key={group[0].characterId}>
          <h3 className="mb-1 flex items-center gap-1.5 text-xs font-medium text-stone-400">
            <Users className="size-3 text-amber-600" />
            {group[0].characterName}
          </h3>
          <ul className="space-y-1">
            {group.map((bond) => (
              <BondRow key={bond.id} bond={bond} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
