"use client";

import type { ReactNode } from "react";
import type { Genre } from "@/lib/schemas/game-settings";
import type { CampaignDifficulty } from "@/lib/campaign-types";
import type { DmModeSetting } from "@/lib/schemas/game-settings-options";
import type { WorldPackSummary } from "@/lib/worlds/types";
import { featuresOn } from "@/app/create-campaign/FeelStep";
import type { StepProps } from "@/app/create-campaign/draft";
import { useI18n } from "@/lib/i18n";
import { campaignWizardCopy } from "@/lib/i18n/campaign-wizard";

export function ReviewStep({
  draft,
  gates,
  selectedPack,
  error,
}: StepProps & {
  selectedPack: WorldPackSummary | null;
  error: string;
}) {
  const { locale } = useI18n();
  const copy = campaignWizardCopy(locale);
  const { solo, storyKnownMissing } = gates;

  const genreNames: Record<Genre, string> = {
    high_fantasy: copy.genres.highFantasyName,
    dark_fantasy: copy.genres.darkFantasyName,
    mystery: copy.genres.mysteryName,
    horror: copy.genres.horrorName,
    cyberpunk: copy.genres.cyberpunkName,
    steampunk: copy.genres.steampunkName,
    post_apocalyptic: copy.genres.postApocalypticName,
    custom: copy.genres.customName,
  };
  const dmModes: Record<DmModeSetting, string> = {
    ai: copy.dmModes.aiLabel,
    human: copy.dmModes.humanLabel,
    assisted: copy.dmModes.assistedLabel,
  };
  const difficulties: Record<CampaignDifficulty, string> = {
    easy: copy.difficulty.easyLabel,
    normal: copy.difficulty.normalLabel,
    hard: copy.difficulty.hardLabel,
    deadly: copy.difficulty.deadlyLabel,
  };

  const genreName = genreNames[draft.genre];
  const setting = selectedPack ? `${selectedPack.name} (${genreName})` : genreName;
  const party = solo
    ? `${copy.review.solo} · ${copy.review.level} ${draft.startingLevel}`
    : `${draft.maxPlayers} ${copy.review.players} · ${copy.review.level} ${draft.startingLevel}`;
  const dice =
    draft.dicePolicy === "digital_only" ? copy.review.digitalOnly : copy.review.realAllowed;

  return (
    <div className="space-y-4 text-sm">
      <dl className="divide-y divide-stone-800/80 rounded-lg border border-stone-800 bg-stone-950/40">
        <Row label={copy.review.runsGame}>{dmModes[draft.dmMode]}</Row>
        <Row label={copy.review.setting}>{setting}</Row>
        <Row label={copy.review.party}>{party}</Row>
        <Row label={copy.review.difficulty}>{difficulties[draft.difficulty]}</Row>
        <Row label={copy.review.dice}>{dice}</Row>
        <Row label={copy.review.features}>
          {featuresOn(draft, gates)} {copy.review.on}
        </Row>
      </dl>
      <p className="text-stone-400">{solo ? copy.review.soloNext : copy.review.multiNext}</p>
      {solo && storyKnownMissing ? (
        <p className="rounded-lg border border-amber-900/50 bg-amber-950/30 p-3 text-amber-200">
          {copy.review.soloNoAi}
        </p>
      ) : null}
      {error ? <p className="text-red-400">{error}</p> : null}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-3 py-2">
      <dt className="shrink-0 text-xs uppercase tracking-wide text-stone-500">{label}</dt>
      <dd className="min-w-0 truncate text-right text-stone-200">{children}</dd>
    </div>
  );
}
