"use client";

import { cn } from "@/lib/cn";
import { InfoButton } from "@/components/ui/InfoDialog";
import { ToggleCard } from "@/app/create-campaign/fields";
import { NarratorFields } from "@/app/create-campaign/NarratorFields";
import type { CampaignDraft, StepProps, WizardGates } from "@/app/create-campaign/draft";
import { useI18n } from "@/lib/i18n";
import { campaignWizardCopy } from "@/lib/i18n/campaign-wizard";

export function featuresOn(draft: CampaignDraft, gates: WizardGates): number {
  const { aiNarrates, solo } = gates;
  const bonds = draft.relationships !== "off";
  return [
    aiNarrates && draft.aiStorySetup,
    draft.ttsEnabled,
    draft.mapsEnabled,
    draft.ambienceEnabled,
    draft.ambienceEnabled && draft.ambienceAuto,
    draft.multiclassingEnabled,
    aiNarrates && draft.worldSimulation,
    draft.inventoryApprovals,
    bonds,
    bonds && draft.romance !== "off",
    aiNarrates && draft.narrationGuard,
    !solo && draft.midGameJoinOpen,
    !solo && draft.holdSubmissions,
  ].filter(Boolean).length;
}

export function FeelStep(props: StepProps) {
  const { locale } = useI18n();
  const copy = campaignWizardCopy(locale);
  const { draft, patch, gates } = props;
  const { aiNarrates, solo, ttsAvailable, mapsAvailable } = gates;
  const bonds = draft.relationships !== "off";

  return (
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {aiNarrates ? (
          <ToggleCard
            active={draft.aiStorySetup}
            onClick={() => patch({ aiStorySetup: !draft.aiStorySetup })}
            label={copy.feel.aiSetupLabel}
            hint={copy.feel.aiSetupHint}
          />
        ) : null}
        <ToggleCard
          active={draft.ttsEnabled}
          disabled={!ttsAvailable}
          onClick={() => patch({ ttsEnabled: !draft.ttsEnabled })}
          label={copy.feel.voiceNarrationLabel}
          hint={ttsAvailable ? copy.feel.voiceNarrationHint : copy.feel.noSpeech}
        />
        <ToggleCard
          active={draft.mapsEnabled}
          disabled={!mapsAvailable}
          onClick={() => patch({ mapsEnabled: !draft.mapsEnabled })}
          label={copy.feel.mapsLabel}
          hint={mapsAvailable ? copy.feel.mapsHint : copy.feel.noImages}
        />
        <ToggleCard
          active={draft.ambienceEnabled}
          onClick={() => patch({ ambienceEnabled: !draft.ambienceEnabled })}
          label={copy.feel.ambienceLabel}
          hint={copy.feel.ambienceHint}
        />
        {draft.ambienceEnabled ? (
          <ToggleCard
            active={draft.ambienceAuto}
            onClick={() => patch({ ambienceAuto: !draft.ambienceAuto })}
            label={copy.feel.ambienceAutoLabel}
            hint={copy.feel.ambienceAutoHint}
          />
        ) : null}
        <ToggleCard
          active={draft.multiclassingEnabled}
          onClick={() => patch({ multiclassingEnabled: !draft.multiclassingEnabled })}
          label={copy.feel.multiclassLabel}
          hint={copy.feel.multiclassHint}
        />
        {aiNarrates ? (
          <div className="relative flex">
            <ToggleCard
              active={draft.worldSimulation}
              onClick={() => patch({ worldSimulation: !draft.worldSimulation })}
              label={copy.feel.livingWorldLabel}
              hint={copy.feel.livingWorldHint}
            />
            <InfoButton
              label={copy.feel.livingWorldInfoLabel}
              text={copy.feel.livingWorldInfo}
              className="absolute right-1.5 top-1.5"
            />
          </div>
        ) : null}
        <ToggleCard
          active={draft.inventoryApprovals}
          onClick={() => patch({ inventoryApprovals: !draft.inventoryApprovals })}
          label={copy.feel.itemOffersLabel}
          hint={copy.feel.itemOffersHint}
        />
        <div className="relative flex">
          <ToggleCard
            active={bonds}
            onClick={() => patch({ relationships: bonds ? "off" : "on" })}
            label={copy.feel.bondsLabel}
            hint={copy.feel.bondsHint}
          />
          <InfoButton
            label={copy.feel.bondsInfoLabel}
            text={copy.feel.bondsInfo}
            className="absolute right-1.5 top-1.5"
          />
        </div>
        {bonds ? (
          <div className="relative flex">
            <ToggleCard
              active={draft.romance !== "off"}
              onClick={() => patch({ romance: draft.romance === "off" ? "on" : "off" })}
              label={copy.feel.romanceLabel}
              hint={copy.feel.romanceHint}
            />
            <InfoButton
              label={copy.feel.romanceInfoLabel}
              text={copy.feel.romanceInfo}
              className="absolute right-1.5 top-1.5"
            />
          </div>
        ) : null}
        {aiNarrates ? (
          <div className="relative flex">
            <ToggleCard
              active={draft.narrationGuard}
              onClick={() => patch({ narrationGuard: !draft.narrationGuard })}
              label={copy.feel.outcomeLabel}
              hint={copy.feel.outcomeHint}
            />
            <InfoButton
              label={copy.feel.outcomeInfoLabel}
              text={copy.feel.outcomeInfo}
              className="absolute right-1.5 top-1.5"
            />
          </div>
        ) : null}
        {!solo ? (
          <ToggleCard
            active={draft.midGameJoinOpen}
            onClick={() => patch({ midGameJoinOpen: !draft.midGameJoinOpen })}
            label={copy.feel.midJoinLabel}
            hint={copy.feel.midJoinHint}
          />
        ) : null}
        {!solo ? (
          <ToggleCard
            active={draft.holdSubmissions}
            onClick={() => patch({ holdSubmissions: !draft.holdSubmissions })}
            label={copy.feel.heldLabel}
            hint={copy.feel.heldHint}
          />
        ) : null}
      </div>

      <NarratorFields {...props} className={cn(!aiNarrates && !draft.ttsEnabled && "hidden")} />
    </div>
  );
}
