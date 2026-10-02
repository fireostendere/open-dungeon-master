"use client";

import { useI18n } from "@/lib/i18n";
import { characterDisplay } from "@/lib/i18n/character-display";
import { helpText } from "@/lib/i18n/help-copy";
import { useInlineText } from "@/lib/i18n/inline-text";
import { UnofficialPackNotice } from "@/components/UnofficialPackNotice";
import { GameTerm } from "@/components/ui/GameTerm";
import { InfoButton } from "@/components/ui/InfoDialog";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { describeSkill } from "@/lib/help";
import type { WorldPack } from "@/lib/worlds/types";
import OptionPicker, { type PickerGroup } from "../OptionPicker";
import { backgroundInfoText } from "../usePickerGroups";
import type { BackgroundOption } from "../useBuilderOptions";
import type { BuilderState } from "../useBuilderState";
import { Field, StepPanel, inputClass } from "./shared";

const GENDERS = ["Female", "Male", "Nonbinary"];

export type BuilderRole = "pc" | "companion";

// Step 1: the name, who plays them, level, background and alignment. The
// setting notices live here too, so the first thing a player sees under a
// world pack is whose names they are about to choose from.
export function IdentityStep({
  state,
  pack,
  packInstalled,
  fixedLevel,
  role,
  alignmentGroups,
  alignmentInfo,
  backgroundGroups,
  background,
}: {
  state: BuilderState;
  pack: WorldPack | null;
  packInstalled: boolean;
  fixedLevel?: number;
  // Offered by the library page only: a campaign already knows which door
  // the character comes through.
  role?: { value: BuilderRole; onChange: (role: BuilderRole) => void };
  alignmentGroups: PickerGroup[];
  alignmentInfo: string;
  backgroundGroups: PickerGroup[];
  background: BackgroundOption | undefined;
}) {
  const uiText = useInlineText();
  const { locale } = useI18n();
  return (
    <div className="space-y-4">
      {!packInstalled ? (
        <p className="rounded-lg border border-stone-700/60 bg-stone-900/60 p-3 text-xs text-stone-400">
          {uiText("contentPackNotInstalledShowingSrd51")}
          <span className="font-mono"> node scripts/import-open5e.mjs</span> {uiText("onTheServerForTheFullOpen5eCatalog")}
        </p>
      ) : null}
      {pack ? (
        <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3">
          <p className="text-xs text-amber-100">
            <span className="font-medium">{pack.name}</span> · {pack.blurb}
          </p>
          <p className="mt-1 text-[11px] text-stone-400">
            {uiText("namesOnlyEveryRaceClassSpellAndItem")}
          </p>
          <UnofficialPackNotice
            rightsHolder={pack.rightsHolder}
            inspiredBy={pack.inspiredBy}
            variant="inline"
            className="mt-1"
          />
        </div>
      ) : null}

      <StepPanel title={uiText("nameYourHero")} ornate>
        <input
          value={state.name}
          onChange={(event) => state.setName(event.target.value)}
          required
          maxLength={60}
          placeholder={pack?.nameHints || uiText("thornwickAshvale")}
          className={inputClass}
          aria-label={uiText("name")}
        />
        {pack?.nameSeeds.people.length ? (
          <span className="mt-2 flex flex-wrap gap-1">
            {pack.nameSeeds.people.slice(0, 8).map((seed) => (
              <button
                key={seed}
                type="button"
                onClick={() => state.setName(seed)}
                className="rounded-md border border-stone-700/70 px-1.5 py-0.5 text-[11px] text-stone-400 transition-colors hover:border-amber-500/40 hover:text-amber-100"
              >
                {seed}
              </button>
            ))}
          </span>
        ) : null}
        {role ? (
          <div className="mt-4">
            <span className="mb-1.5 block text-xs text-stone-400">{uiText("theirPlaceAtTheTable")}</span>
            <SegmentedControl
              label={uiText("role")}
              value={role.value}
              onChange={role.onChange}
              options={[
                { value: "pc", label: uiText("characterIPlay") },
                { value: "companion", label: uiText("allyDmPlays") },
              ]}
              className="w-full"
            />
            <p className="mt-1.5 text-xs text-stone-500">
              {role.value === "companion"
                ? uiText("companionsAreOfferedWhenAPartyAddsOne")
                : uiText("joinsACampaignAsYoursToControl")}
            </p>
          </div>
        ) : null}
      </StepPanel>

      <StepPanel title={uiText("details")}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={uiText("gender")}>
            <select
              value={state.gender}
              onChange={(event) => state.setGender(event.target.value)}
              className={inputClass}
            >
              <option value="">{uiText("unspecified")}</option>
              {GENDERS.map((value) => (
                <option key={value} value={value}>{typeof value === "string" ? characterDisplay(value, locale) : value}</option>
              ))}
            </select>
          </Field>
          <Field label={uiText("level")}>
            {fixedLevel ? (
              <span className="block rounded-lg border border-stone-700/70 bg-stone-950/60 px-3 py-2 text-sm text-stone-400">
                {fixedLevel} {uiText("campaigncbd40a")}
              </span>
            ) : (
              <select
                value={state.level}
                onChange={(event) => state.changeLevel(Number(event.target.value))}
                className={inputClass}
              >
                {Array.from({ length: 20 }, (_, index) => index + 1).map((value) => (
                  <option key={value} value={value}>{typeof value === "string" ? characterDisplay(value, locale) : value}</option>
                ))}
              </select>
            )}
          </Field>
          <Field label={uiText("background")}>
            <OptionPicker
              value={background?.id ?? ""}
              groups={backgroundGroups}
              className={inputClass}
              onChange={state.changeBackground}
            />
            {background ? (
              <span className="mt-1 flex items-start gap-1 text-xs text-stone-500">
                <span className="grow">
                  {background.skills.length ? uiText("grants") : null}
                  {background.skills.length
                    ? background.skills.map((skillId, index) => {
                        const name =
                          characterDisplay(skillId, locale);
                        return (
                          <span key={skillId} className="whitespace-nowrap">
                            {index ? ", " : null}
                            {name}
                            {/* Each granted skill says what it is, so
                                "Grants Deception, Sleight of Hand" is a
                                sentence a new player can read. */}
                            <InfoButton label={name} text={describeSkill(skillId, locale)} />
                          </span>
                        );
                      })
                    : uiText("whatYourCharacterDidBeforeAdventuring")}
                  {background.feature ? (
                    <span className="whitespace-nowrap">
                      {background.skills.length ? " · " : " "}
                      {uiText("featurebee317")} {helpText(background.feature, locale)}
                      <InfoButton
                        label={helpText(background.feature, locale)}
                        text={background.featureDesc ? helpText(background.featureDesc, locale) : undefined}
                        reference={
                          background.featureDesc ? undefined : { kind: "backgrounds", slug: background.id }
                        }
                      />
                    </span>
                  ) : null}
                </span>
                <InfoButton
                  label={background.name}
                  text={backgroundInfoText(background, uiText("feature"), locale)}
                  reference={{ kind: "backgrounds", slug: background.id }}
                />
              </span>
            ) : null}
            {background?.skillChoice ? (
              <BackgroundSkillChoice state={state} background={background} choice={background.skillChoice} />
            ) : null}
          </Field>
          <Field
            label={
              <span className="flex items-center gap-1">
                {uiText("alignment")}
                <InfoButton label={uiText("alignment")} text={alignmentInfo} />
              </span>
            }
          >
            <OptionPicker
              value={state.alignment}
              groups={alignmentGroups}
              className={inputClass}
              onChange={state.setAlignment}
            />
          </Field>
        </div>
      </StepPanel>
    </div>
  );
}

function skillName(skillId: string, locale: "ru" | "en") {
  return characterDisplay(skillId, locale);
}

// The skills a content-pack background leaves to the player ("Persuasion,
// and either Insight or History"), one select per pick, the way the race's
// skill choices are asked on the ancestry step.
function BackgroundSkillChoice({
  state,
  background,
  choice,
}: {
  state: BuilderState;
  background: BackgroundOption;
  choice: NonNullable<BackgroundOption["skillChoice"]>;
}) {
  const uiText = useInlineText();
  const { locale } = useI18n();
  const picks = state.backgroundSkills;
  const taken = new Set([...background.skills, ...state.chosenSkills, ...state.racialSkills]);
  return (
    <div className="mt-2">
      <span className="mb-1 flex flex-wrap items-center gap-1 text-xs text-stone-400">
        <GameTerm id="skill">{uiText("skillProficiencies")}</GameTerm>{" "}
        {uiText("countOfYourChoice", { count: choice.count })}
      </span>
      <div className="grid grid-cols-1 gap-2">
        {Array.from({ length: choice.count }, (_, index) => (
          <span key={index} className="flex items-center gap-1">
            <select
              value={picks[index] ?? ""}
              onChange={(event) => {
                const next = event.target.value;
                state.setBackgroundSkills((current) => {
                  const updated = [...current];
                  updated[index] = next;
                  return updated;
                });
              }}
              className={inputClass}
              aria-label={uiText("backgroundSkillIndex", { index: index + 1 })}
            >
              <option value="">{uiText("chooseASkill")}</option>
              {choice.from
                .filter((skill) => picks[index] === skill || (!picks.includes(skill) && !taken.has(skill)))
                .map((skill) => (
                  <option key={skill} value={skill}>
                    {skillName(skill, locale)}
                  </option>
                ))}
            </select>
            {picks[index] ? (
              <InfoButton label={skillName(picks[index], locale)} text={describeSkill(picks[index], locale)} />
            ) : null}
          </span>
        ))}
      </div>
    </div>
  );
}
