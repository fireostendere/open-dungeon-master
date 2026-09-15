"use client";

import { ImageIcon } from "lucide-react";
import { InfoButton } from "@/components/ui/InfoDialog";
import { cn } from "@/lib/cn";
import { GENRE_PRESETS } from "@/lib/genres";
import type { Genre } from "@/lib/schemas/game-settings";
import { FieldLabel, inputClass } from "@/app/create-campaign/fields";
import type { StepProps } from "@/app/create-campaign/draft";
import { useI18n } from "@/lib/i18n";
import { campaignWizardCopy } from "@/lib/i18n/campaign-wizard";

export function WorldStep({
  draft,
  patch,
  gates,
  onPickGenre,
}: StepProps & {
  onPickGenre: (genre: Genre) => void;
}) {
  const { locale } = useI18n();
  const copy = campaignWizardCopy(locale);
  const showsAiFill = gates.aiNarrates && draft.aiStorySetup;
  const genreCopy: Record<Genre, { name: string; blurb: string }> = {
    high_fantasy: { name: copy.genres.highFantasyName, blurb: copy.genres.highFantasyBlurb },
    dark_fantasy: { name: copy.genres.darkFantasyName, blurb: copy.genres.darkFantasyBlurb },
    mystery: { name: copy.genres.mysteryName, blurb: copy.genres.mysteryBlurb },
    horror: { name: copy.genres.horrorName, blurb: copy.genres.horrorBlurb },
    cyberpunk: { name: copy.genres.cyberpunkName, blurb: copy.genres.cyberpunkBlurb },
    steampunk: { name: copy.genres.steampunkName, blurb: copy.genres.steampunkBlurb },
    post_apocalyptic: {
      name: copy.genres.postApocalypticName,
      blurb: copy.genres.postApocalypticBlurb,
    },
    custom: { name: copy.genres.customName, blurb: copy.genres.customBlurb },
  };
  const settingInfo = `${copy.world.settingsInfoIntro}\n\n${GENRE_PRESETS.map(
    (preset) => `**${genreCopy[preset.id].name}**: ${genreCopy[preset.id].blurb}`,
  ).join("\n\n")}`;

  return (
    <div className="space-y-4 text-sm">
      <div>
        <FieldLabel className="mb-1.5">
          <span className="flex items-center gap-1">
            {copy.world.setting}
            <InfoButton label={copy.world.settingsInfoLabel} text={settingInfo} />
          </span>
        </FieldLabel>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {GENRE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => onPickGenre(preset.id)}
              title={genreCopy[preset.id].blurb}
              className={cn(
                "rounded-lg border px-2 py-1.5 text-xs transition-colors",
                draft.genre === preset.id
                  ? "border-amber-200/40 bg-amber-200/10 text-amber-100"
                  : "border-stone-800 text-stone-400 hover:border-stone-600",
              )}
            >
              {genreCopy[preset.id].name}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-stone-500">{genreCopy[draft.genre].blurb}</p>
        {draft.genre === "custom" ? (
          <textarea
            value={draft.customGenreText}
            onChange={(event) => patch({ customGenreText: event.target.value })}
            rows={2}
            maxLength={500}
            placeholder={copy.world.customPlaceholder}
            className={cn(inputClass, "mt-2")}
          />
        ) : null}
      </div>

      <label className="block">
        <FieldLabel>
          {copy.world.premise} ({copy.world.optional}
          {showsAiFill ? `; ${copy.world.aiFills}` : ""})
        </FieldLabel>
        <textarea
          value={draft.description}
          onChange={(event) => patch({ description: event.target.value, descriptionTouched: true })}
          rows={2}
          maxLength={500}
          className={inputClass}
        />
      </label>

      <label className="block">
        <FieldLabel>{copy.world.themeNotes}</FieldLabel>
        <input
          value={draft.theme}
          onChange={(event) => patch({ theme: event.target.value, themeTouched: true })}
          maxLength={120}
          placeholder={copy.world.themePlaceholder}
          className={inputClass}
        />
      </label>

      <div className="flex items-start gap-3 rounded-lg border border-stone-800 bg-stone-950/40 p-3">
        <ImageIcon className="mt-0.5 size-4 shrink-0 text-amber-300/70" aria-hidden="true" />
        <div>
          <span className="block text-stone-300">{copy.world.coverArt}</span>
          <p className="mt-0.5 text-xs text-stone-500">{copy.world.coverHelp}</p>
        </div>
      </div>
    </div>
  );
}
