"use client";

import { Check, Loader2 } from "lucide-react";
import { GameIcon } from "@/components/ui/GameIcon";
import { useState } from "react";
import { ui } from "@/lib/ui";
import { thresholdsForParty } from "@/lib/srd/encounter-math";
import { TARGET_PARTY_LIMITS, targetPartyLevels, type TargetParty } from "@/lib/workshop/kind";
import { useI18n } from "@/lib/i18n/context";
import { workshopCopy } from "@/app/workshop/copy";
import { localeText } from "@/lib/i18n/locale-text";

// The party a workshop is building for, declared once and read by every tool
// that needs numbers before any character sheet exists.
//
// It shows the XP budget it implies right here, because a DM setting "four at
// level three" wants to know what that buys, and because a number with its
// consequence attached is the difference between a setting and a decision.
//
// Selects rather than number fields: both ranges are short and closed, and a
// select cannot be typed out of bounds on a phone keyboard.

function range(limits: { min: number; max: number }): number[] {
  return Array.from({ length: limits.max - limits.min + 1 }, (_, index) => limits.min + index);
}

const SIZES = range(TARGET_PARTY_LIMITS.size);
const LEVELS = range(TARGET_PARTY_LIMITS.level);

const select = `${ui.input} w-auto py-1 pr-7`;

export function TargetPartyBar({
  workshopId,
  targetParty,
  onSaved,
}: {
  workshopId: string;
  targetParty: TargetParty;
  onSaved: (targetParty: TargetParty) => void;
}) {
  const { locale } = useI18n();
  const copy = workshopCopy(locale);
  const budgetCopy = localeText(locale, {
    en: "One fight is easy up to {easy} XP, medium to {medium}, hard to {hard}, deadly beyond {deadly}. Adjusted for how many creatures you field.",
    ru: "Один бой лёгкий до {easy} XP, средний до {medium}, тяжёлый до {hard}, смертельный выше {deadly}. Значения скорректированы по числу существ.",
  });
  const [size, setSize] = useState(targetParty.size);
  const [level, setLevel] = useState(targetParty.level);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const dirty = size !== targetParty.size || level !== targetParty.level;
  const budget = thresholdsForParty(targetPartyLevels({ size, level }));

  async function save() {
    setBusy(true);
    setSaved(false);
    try {
      const response = await fetch(`/api/workshops/${workshopId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetParty: { size, level } }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.workshop) {
        onSaved(data.workshop.gameSettings.targetParty);
        setSaved(true);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`${ui.card} p-3`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <GameIcon icon={{ kind: "glyph", key: "system-party" }} size="size-7" />
        <span className="text-sm text-stone-400">{copy.building}</span>
        <select
          value={size}
          onChange={(event) => {
            setSize(Number(event.target.value));
            setSaved(false);
          }}
          aria-label={copy.partySize}
          className={select}
        >
          {SIZES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <span className="text-sm text-stone-400">{size === 1 ? copy.hero : copy.heroes} {locale === "ru" ? "уровня" : "at level"}</span>
        <select
          value={level}
          onChange={(event) => {
            setLevel(Number(event.target.value));
            setSaved(false);
          }}
          aria-label={copy.partyLevel}
          className={select}
        >
          {LEVELS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        {dirty ? (
          <button type="button" onClick={save} disabled={busy} className={ui.btnSmall}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null} {copy.save}
          </button>
        ) : saved ? (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
            <Check className="size-3.5" /> {copy.saved}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-xs text-stone-500">
        {budgetCopy.replace("{easy}", budget.easy.toLocaleString()).replace("{medium}", budget.medium.toLocaleString()).replace("{hard}", budget.hard.toLocaleString()).replace("{deadly}", budget.deadly.toLocaleString())}
      </p>
    </div>
  );
}
