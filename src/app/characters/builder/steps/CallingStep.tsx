"use client";

import { GameTerm } from "@/components/ui/GameTerm";
import { InfoButton } from "@/components/ui/InfoDialog";
import {
  describeFeature,
  describeSkill,
  describeSubclass,
  localizedFeatureName,
  localizedSubclassName,
} from "@/lib/help";
import { firstSentence } from "@/lib/help/rules-text";
import { SRD_SKILLS } from "@/lib/srd";
import { subclassBlurb } from "@/lib/srd/features";
import { displayName } from "@/lib/worlds/reskin-logic";
import type { WorldPack } from "@/lib/worlds/types";
import OptionPicker, { type PickerGroup } from "../OptionPicker";
import { classInfoText } from "../usePickerGroups";
import type { ArchetypeOption, BackgroundOption, ClassOption } from "../useBuilderOptions";
import type { BuilderActions, BuilderDerived } from "../useBuilderDerived";
import type { BuilderState } from "../useBuilderState";
import { ClassChoices } from "./ClassChoices";
import { Field, PickPill, StepPanel, inputClass } from "./shared";
import { useI18n } from "@/lib/i18n/context";
import { localeText } from "@/lib/i18n/locale-text";
import { characterDisplay } from "@/lib/i18n/character-display";

// Step 3: the class, its subclass once the level allows one, what the pair
// grants at this level, and the class skill picks. Expertise, fighting
// styles and option lists (invocations and the like) follow in ClassChoices.
export function CallingStep({
  state,
  derived,
  actions,
  klass,
  background,
  pack,
  classGroups,
  subclassGroups,
  offersSubclass,
  chosenArchetype,
}: {
  state: BuilderState;
  derived: BuilderDerived;
  actions: BuilderActions;
  klass: ClassOption | undefined;
  background: BackgroundOption | undefined;
  pack: WorldPack | null;
  classGroups: PickerGroup[];
  subclassGroups: PickerGroup[];
  offersSubclass: boolean;
  chosenArchetype: ArchetypeOption | null;
}) {
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: { choose: "Choose a class", class: "Class", hitDie: "hit die", saves: "saves", caster: "caster", flavored: "spells flavored as", subclass: "Subclass", none: "None yet", specialization: "A specialization within your class.", still: "Still to choose.", subclassHelp: "Your subclass is the biggest choice about how this character plays. Tap the info icon next to any option to read what it does before choosing.", gain: "What you gain at level", gainHelp: "Tap any name to read what it does. Racial traits and background perks are added on top when the character is saved.", level: "Level", skills: "Class skills", pick: "pick", stillChoose: "still to choose.", skillHelp: "A skill you are proficient in adds your proficiency bonus to rolls that use it. Tap any ⓘ to see which ability a skill leans on.", background: "(background)" },
    ru: { choose: "Выберите класс", class: "Класс", hitDie: "кость хитов", saves: "спасброски", caster: "заклинатель", flavored: "заклинания в стиле", subclass: "Подкласс", none: "Пока нет", specialization: "Специализация внутри вашего класса.", still: "Ещё нужно выбрать.", subclassHelp: "Подкласс — главный выбор, определяющий стиль игры персонажа. Нажмите значок информации возле варианта, чтобы прочитать описание перед выбором.", gain: "Что вы получаете на уровне", gainHelp: "Нажмите на название, чтобы прочитать описание. Расовые черты и преимущества предыстории добавятся при сохранении персонажа.", level: "Уровень", skills: "Навыки класса", pick: "выберите", stillChoose: "ещё нужно выбрать.", skillHelp: "Владение навыком добавляет бонус мастерства к броскам с ним. Нажмите ⓘ, чтобы узнать, от какой характеристики зависит навык.", background: "(предыстория)" },
  });
  const { subclass } = state;
  // The subclass write-up: the Russian help when there is one, else the
  // pack's full row, else the bundled line, so no subclass is a bare name.
  const subclassText =
    describeSubclass(klass?.id ?? "", subclass, locale) ??
    (chosenArchetype?.desc || subclassBlurb(klass?.id ?? "", subclass) || undefined);
  const { effectiveLevel, grantedFeatures } = derived;
  return (
    <div className="space-y-4">
       <StepPanel title={copy.choose} ornate>
         <Field label={copy.class}>
          <OptionPicker
            value={klass?.id ?? ""}
            groups={classGroups}
            className={inputClass}
            onChange={state.changeClass}
          />
          {klass ? (
            <span className="mt-1 flex flex-wrap items-center gap-x-1 text-xs text-stone-500">
               <GameTerm id="hit_dice">d{klass.hitDie} {copy.hitDie}</GameTerm> ·{" "}
               <GameTerm id="saving_throw">{copy.saves}</GameTerm>{" "}
              {klass.saves.map((save) => save.toUpperCase()).join(", ")}
              {klass.spellAbility ? (
                <>
                  {" · "}
                  <GameTerm id={klass.spellAbility}>{klass.spellAbility.toUpperCase()}</GameTerm>{" "}
                   {copy.caster}
                   {klass.castingLabel ? ` (${copy.flavored} ${klass.castingLabel})` : ""}
                </>
              ) : null}
              <InfoButton
                label={characterDisplay(klass.name, locale)}
                text={classInfoText(klass)}
                reference={{ kind: "classes", slug: klass.id }}
              />
            </span>
          ) : null}
        </Field>
        {offersSubclass ? (
           <Field label={copy.subclass} className="mt-3">
            <OptionPicker
              value={subclass}
              groups={subclassGroups}
               placeholder={copy.none}
              className={inputClass}
              onChange={state.changeSubclass}
            />
            <span className="mt-1 flex items-start gap-1 text-xs text-stone-500">
              {subclass ? (
                <>
                  <span className="grow">
                    {firstSentence(subclassText) ?? copy.specialization}
                  </span>
                  <InfoButton
                    label={localizedSubclassName(klass?.id ?? "", subclass, locale)}
                    text={subclassText}
                    reference={
                      chosenArchetype ? { kind: "archetypes", slug: chosenArchetype.id } : undefined
                    }
                  />
                </>
              ) : (
                <span className="grow">
                   <span className="text-amber-300">{copy.still} </span>
                   {copy.subclassHelp}
                </span>
              )}
            </span>
          </Field>
        ) : null}
      </StepPanel>

      {grantedFeatures.length ? (
        <StepPanel
           title={`${copy.gain} ${effectiveLevel}`}
           help={copy.gainHelp}
        >
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {grantedFeatures.map((feature) => (
              <span
                key={`${feature.name}-${feature.level ?? 0}`}
                className="flex items-center gap-1 text-xs text-stone-300"
              >
                {localizedFeatureName(klass?.id ?? "", subclass, feature.name, locale) === feature.name
                  ? characterDisplay(displayName(pack, "features", feature.name), locale)
                  : localizedFeatureName(klass?.id ?? "", subclass, feature.name, locale)}
                <InfoButton
                  label={feature.name}
                   meta={feature.level ? `${copy.level} ${feature.level}` : undefined}
                  text={klass ? describeFeature(klass.id, subclass, feature.name, locale) : null}
                />
              </span>
            ))}
          </div>
        </StepPanel>
      ) : null}

      {klass ? (
        <StepPanel
           title={`${copy.skills} (${copy.pick} ${klass.skillChoices.count})`}
          help={
            <>
              {klass.skillChoices.count - state.chosenSkills.length > 0 ? (
                <span className="text-amber-300">
                   {klass.skillChoices.count - state.chosenSkills.length} {copy.stillChoose}{" "}
                </span>
              ) : null}
               {copy.skillHelp}
            </>
          }
        >
          <div className="flex flex-wrap gap-2">
            {klass.skillChoices.from.map((skillId) => {
              const skill = SRD_SKILLS.find((entry) => entry.id === skillId);
              const fromBackground = background?.skills.includes(skillId) ?? false;
              return (
                <PickPill
                  key={skillId}
                  label={skill?.name ?? skillId}
                  selected={state.chosenSkills.includes(skillId)}
                  disabled={fromBackground}
                  onClick={() => actions.toggleSkill(skillId)}
                  info={{ text: describeSkill(skillId) }}
                >
                  {skill?.name ?? skillId}
                   {fromBackground ? ` ${copy.background}` : ""}
                </PickPill>
              );
            })}
          </div>
        </StepPanel>
      ) : null}

      <ClassChoices state={state} derived={derived} actions={actions} klass={klass} />
    </div>
  );
}
