"use client";

import { InfoButton } from "@/components/ui/InfoDialog";
import { cn } from "@/lib/cn";
import {
  CAMPAIGN_DIFFICULTIES,
  type CampaignDifficulty,
} from "@/lib/campaign-types";
import {
  CAMPAIGN_LENGTHS,
  type CampaignLengthSetting,
} from "@/lib/schemas/game-settings-options";
import { FieldLabel, inputClass, ToggleCard } from "@/app/create-campaign/fields";
import type { StepProps } from "@/app/create-campaign/draft";
import { useI18n } from "@/lib/i18n";
import { campaignWizardCopy } from "@/lib/i18n/campaign-wizard";

export function PartyStep({ draft, patch, gates }: StepProps) {
  const { locale } = useI18n();
  const copy = campaignWizardCopy(locale);
  const { solo, aiNarrates } = gates;
  const difficultyCopy: Record<CampaignDifficulty, { label: string; hint: string }> = {
    easy: { label: copy.difficulty.easyLabel, hint: copy.difficulty.easyHint },
    normal: { label: copy.difficulty.normalLabel, hint: copy.difficulty.normalHint },
    hard: { label: copy.difficulty.hardLabel, hint: copy.difficulty.hardHint },
    deadly: { label: copy.difficulty.deadlyLabel, hint: copy.difficulty.deadlyHint },
  };
  const lengthCopy: Record<CampaignLengthSetting, string> = {
    short: copy.length.short,
    standard: copy.length.standard,
    epic: copy.length.epic,
  };

  return (
    <div className="space-y-4 text-sm">
      <p className="text-xs text-stone-400">{copy.party.formation}</p>
      <div className={cn("grid gap-3", solo ? "grid-cols-2" : "grid-cols-3")}>
        {!solo ? (
          <label className="block">
            <FieldLabel>{copy.party.players}</FieldLabel>
            <input
              type="number"
              min={1}
              max={8}
              value={draft.maxPlayers}
              onChange={(event) => patch({ maxPlayers: Number(event.target.value) })}
              className={inputClass}
            />
          </label>
        ) : null}
        <label className="block">
          <FieldLabel>{copy.party.startLevel}</FieldLabel>
          <input
            type="number"
            min={1}
            max={20}
            value={draft.startingLevel}
            onChange={(event) => patch({ startingLevel: Number(event.target.value) })}
            className={inputClass}
          />
        </label>
        <label className="block">
          <FieldLabel>
            <span className="flex items-center gap-1">
              {copy.party.difficulty}
              <InfoButton label={copy.party.difficulty} text={copy.party.difficultyInfo} />
            </span>
          </FieldLabel>
          <select
            value={draft.difficulty}
            onChange={(event) => patch({ difficulty: event.target.value as CampaignDifficulty })}
            className={inputClass}
          >
            {CAMPAIGN_DIFFICULTIES.map((value) => (
              <option key={value} value={value}>
                {difficultyCopy[value].label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-stone-500">{difficultyCopy[draft.difficulty].hint}</p>
        </label>
      </div>

      {aiNarrates ? (
        <label className="block">
          <FieldLabel>
            <span className="flex items-center gap-1">
              {copy.party.campaignLength}
              <InfoButton label={copy.party.campaignLength} text={copy.party.lengthInfo} />
            </span>
          </FieldLabel>
          <select
            value={draft.campaignLength}
            onChange={(event) =>
              patch({ campaignLength: event.target.value as CampaignLengthSetting })
            }
            className={inputClass}
          >
            {CAMPAIGN_LENGTHS.map((value) => (
              <option key={value} value={value}>
                {lengthCopy[value]}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-stone-500">{copy.party.lengthHelp}</p>
        </label>
      ) : null}

      <div>
        <FieldLabel className="mb-1.5">{copy.party.dice}</FieldLabel>
        <div className="flex gap-2">
          <ToggleCard
            active={draft.dicePolicy === "digital_only"}
            onClick={() => patch({ dicePolicy: "digital_only" })}
            label={copy.party.digitalOnly}
            hint={copy.party.digitalHint}
          />
          <ToggleCard
            active={draft.dicePolicy === "real_allowed"}
            onClick={() => patch({ dicePolicy: "real_allowed" })}
            label={copy.party.realAllowed}
            hint={solo ? copy.party.realSoloHint : copy.party.realMultiHint}
          />
        </div>
      </div>
    </div>
  );
}
