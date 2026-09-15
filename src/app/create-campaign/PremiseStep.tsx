"use client";

import { useMemo } from "react";
import OptionPicker, { type PickerGroup } from "@/app/characters/builder/OptionPicker";
import { UnofficialPackNotice } from "@/components/UnofficialPackNotice";
import { DM_MODES } from "@/lib/schemas/game-settings-options";
import type { FranchiseGroup, WorldPackSummary } from "@/lib/worlds/types";
import { FieldLabel, inputClass, ToggleCard } from "@/app/create-campaign/fields";
import type { StepProps } from "@/app/create-campaign/draft";
import { useI18n } from "@/lib/i18n";
import { campaignWizardCopy } from "@/lib/i18n/campaign-wizard";

export function PremiseStep({
  draft,
  patch,
  gates,
  packs,
  franchises,
  selectedPack,
  onChoosePack,
  onClearPack,
}: StepProps & {
  packs: WorldPackSummary[];
  franchises: FranchiseGroup[];
  selectedPack: WorldPackSummary | null;
  onChoosePack: (pack: WorldPackSummary) => void;
  onClearPack: () => void;
}) {
  const { locale } = useI18n();
  const copy = campaignWizardCopy(locale);
  const { storyKnownMissing, storyUnreachable, aiNarrates } = gates;

  const packGroups = useMemo<PickerGroup[]>(
    () => [
      {
        label: null,
        options: [
          {
            id: "",
            name: copy.premise.noPack,
            infoText: copy.premise.noPackInfo,
          },
        ],
      },
      ...franchises.map((group) => ({
        label: group.editions.length === 1 ? null : group.franchise,
        options: group.editions.map((edition) => ({
          id: edition.id,
          name: group.editions.length === 1 ? edition.name : edition.edition || edition.name,
          infoText: edition.blurb,
        })),
      })),
    ],
    [copy.premise.noPack, copy.premise.noPackInfo, franchises],
  );

  const modeCopy = {
    ai: { label: copy.dmModes.aiLabel, hint: copy.dmModes.aiHint },
    human: { label: copy.dmModes.humanLabel, hint: copy.dmModes.humanHint },
    assisted: { label: copy.dmModes.assistedLabel, hint: copy.dmModes.assistedHint },
  } as const;

  return (
    <div className="space-y-4 text-sm">
      <label className="block">
        <FieldLabel>{copy.premise.title}</FieldLabel>
        <input
          value={draft.title}
          onChange={(event) => patch({ title: event.target.value })}
          required
          maxLength={80}
          placeholder={copy.premise.titlePlaceholder}
          className={inputClass}
        />
      </label>

      <div>
        <FieldLabel className="mb-1.5">{copy.premise.whoRuns}</FieldLabel>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {DM_MODES.filter((mode) => mode === "human" || !storyKnownMissing).map((mode) => (
            <ToggleCard
              key={mode}
              active={draft.dmMode === mode}
              onClick={() => patch({ dmMode: mode })}
              label={modeCopy[mode].label}
              hint={modeCopy[mode].hint}
            />
          ))}
        </div>
        {storyKnownMissing ? (
          <p className="mt-1.5 text-xs text-stone-500">{copy.premise.noAi}</p>
        ) : null}
        {storyUnreachable && aiNarrates ? (
          <p className="mt-1.5 text-xs text-amber-300">{copy.premise.aiOffline}</p>
        ) : null}
        {draft.dmMode !== "ai" ? (
          <p className="mt-1.5 text-xs text-stone-500">{copy.premise.humanSeat}</p>
        ) : null}
      </div>

      {franchises.length ? (
        <div>
          <FieldLabel>{copy.premise.prebuiltWorld}</FieldLabel>
          <OptionPicker
            value={draft.worldPack}
            groups={packGroups}
            placeholder={copy.premise.noPack}
            className={inputClass}
            onChange={(id) => {
              const next = packs.find((pack) => pack.id === id);
              if (next) onChoosePack(next);
              else onClearPack();
            }}
          />
          {selectedPack ? (
            <>
              {selectedPack.cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={selectedPack.cover}
                  alt=""
                  className="mt-2 aspect-video w-full max-w-sm rounded-lg border border-stone-800 object-cover"
                />
              ) : null}
              <p className="mt-1 text-xs text-stone-500">{selectedPack.blurb}</p>
              <UnofficialPackNotice
                rightsHolder={selectedPack.rightsHolder}
                inspiredBy={selectedPack.inspiredBy}
                className="mt-1.5"
              />
            </>
          ) : (
            <p className="mt-1 text-xs text-stone-500">{copy.premise.packHelp}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
