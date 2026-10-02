"use client";

import { characterDisplay } from "@/lib/i18n/character-display";
import { helpText } from "@/lib/i18n/help-copy";
import { optionCopy } from "@/lib/i18n/option-copy";
import { useInlineText } from "@/lib/i18n/inline-text";
import { useI18n } from "@/lib/i18n";
import { optionKindLabel } from "@/lib/i18n/option-kind";
import { GameTerm } from "@/components/ui/GameTerm";
import { InfoButton } from "@/components/ui/InfoDialog";
import { cn } from "@/lib/cn";
import { describeSkill } from "@/lib/help";
import { SRD_SKILLS } from "@/lib/srd";
import { expertiseSlotsFor } from "@/lib/srd/features";
import { FIGHTING_STYLES } from "@/lib/srd/feature-effects";
import type { ClassOption } from "../useBuilderOptions";
import type { BuilderActions, BuilderDerived } from "../useBuilderDerived";
import type { BuilderState } from "../useBuilderState";
import { PickPill, StepPanel } from "./shared";

const optionCard = (selected: boolean) =>
  cn(
    "rounded-lg border px-3 py-2 text-left transition-colors duration-150",
    selected
      ? "border-amber-500/60 bg-amber-400/10 text-amber-100"
      : "border-stone-600/60 text-stone-300 hover:border-amber-500/40 hover:bg-stone-900/70",
  );

// The class-specific pick lists that only appear when the class and level
// earn them: expertise, fighting styles, and the option slots (invocations,
// maneuvers, metamagic, pact boons, infusions, runes, disciplines).
export function ClassChoices({
  state,
  derived,
  actions,
  klass,
}: {
  state: BuilderState;
  derived: BuilderDerived;
  actions: BuilderActions;
  klass: ClassOption | undefined;
}) {
  const uiText = useInlineText();
  const { locale } = useI18n();
  const { effectiveLevel, preview, styleSlots, optionSlots } = derived;
  const expertiseSlots = klass ? expertiseSlotsFor(klass.id, effectiveLevel) : 0;
  return (
    <>
      {klass && expertiseSlots > 0 && preview ? (
        <StepPanel
          title={uiText("expertisePickCount", { count: expertiseSlots })}
          help={
            <>
              {expertiseSlots - state.expertisePicks.length > 0 ? (
                <span className="text-amber-300">
                  {expertiseSlots - state.expertisePicks.length} {uiText("stillToChoose")}{" "}
                </span>
              ) : null}
              <GameTerm id="expertise">{uiText("expertise")}</GameTerm> {uiText("doublesYour")}{" "}
              <GameTerm id="proficiency_bonus">{uiText("proficiencyBonus")}</GameTerm> {uiText("onTheChosenSkills")}
            </>
          }
        >
          <div className="flex flex-wrap gap-2">
            {preview.proficiencies.skills.map((skillId) => {
              const skill = SRD_SKILLS.find((entry) => entry.id === skillId);
              const selected = state.expertisePicks.includes(skillId);
              return (
                <PickPill
                  key={skillId}
                  label={skill?.name ?? skillId}
                  selected={selected}
                  info={{ text: describeSkill(skillId, locale) }}
                  onClick={() =>
                    state.setExpertisePicks((current) =>
                      selected
                        ? current.filter((entry) => entry !== skillId)
                        : current.length < expertiseSlots
                          ? [...current, skillId]
                          : current,
                    )
                  }
                >
                  {skill?.name ?? skillId}
                </PickPill>
              );
            })}
          </div>
        </StepPanel>
      ) : null}

      {styleSlots > 0 ? (
        <StepPanel
          title={uiText("fightingStylePickCount", { count: styleSlots })}
          help={
            styleSlots - state.stylePicks.length > 0 ? (
              <span className="text-amber-300">
                {styleSlots - state.stylePicks.length} {uiText("stillToChooseAFightingStyleIsA")}
              </span>
            ) : undefined
          }
        >
          <div className="grid gap-1.5 sm:grid-cols-2">
            {FIGHTING_STYLES.map((style) => {
              const selected = state.stylePicks.includes(style.id);
              return (
                <button
                  key={style.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() =>
                    state.setStylePicks((current) =>
                      selected
                        ? current.filter((entry) => entry !== style.id)
                        : current.length < styleSlots
                          ? [...current, style.id]
                          : current,
                    )
                  }
                  className={optionCard(selected)}
                >
                  <span className="block text-xs">{characterDisplay(style.name, locale)}</span>
                  <span className="block text-[11px] text-stone-500">{helpText(style.description, locale)}</span>
                </button>
              );
            })}
          </div>
        </StepPanel>
      ) : null}

      {optionSlots.map((slot) => (
        <StepPanel
          key={slot.kind}
          title={uiText("chooseCountKind", { count: slot.total, kind: optionKindLabel(slot.kind, locale) })}
          help={
            <>
              {slot.remaining > 0 ? (
                <span className="text-amber-300">{slot.remaining} {uiText("stillToChoose")} </span>
              ) : null}
              {uiText("theseAreRealAbilitiesYourCharacterGetsTap")}
            </>
          }
        >
          <div className="grid gap-1.5 sm:grid-cols-2">
            {slot.options.map((option) => {
              const translated = optionCopy(option, locale);
              const selected = slot.chosen.some(
                (chosenName) => chosenName.toLowerCase() === option.n.toLowerCase(),
              );
              return (
                <div key={option.n} className={cn(optionCard(selected), "flex items-start gap-1")}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => actions.toggleOption(slot, option.n)}
                    className="grow text-left"
                  >
                    <span className="block text-xs">{translated.title}</span>
                    <span className="block text-[11px] text-stone-500">
                      {option.req ? `${uiText("requiresRequirement", { requirement: translated.requirement ?? "" })} ` : ""}
                      {translated.text}
                    </span>
                  </button>
                  <InfoButton
                    label={translated.title}
                    meta={option.req ? uiText("requiresRequirementf07904", { requirement: translated.requirement ?? "" }) : undefined}
                    text={translated.text}
                  />
                </div>
              );
            })}
          </div>
        </StepPanel>
      ))}
    </>
  );
}
