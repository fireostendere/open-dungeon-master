"use client";

import { Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { AvatarCropDialog } from "@/app/settings/AvatarCropDialog";
import { Wizard, type WizardStep } from "@/components/ui/Wizard";
import { cn } from "@/lib/cn";
import type { Genre } from "@/lib/schemas/game-settings";
import type { CreateSheetInput } from "@/lib/schemas/sheet";
import { offersImages, useCapabilities } from "@/lib/use-capabilities";
import { applyClassReskins, applyIdReskins } from "@/lib/worlds/reskin-logic";
import { AbilitiesStep } from "./steps/AbilitiesStep";
import { AncestryStep } from "./steps/AncestryStep";
import { CallingStep } from "./steps/CallingStep";
import { FinishStep } from "./steps/FinishStep";
import { IdentityStep, type BuilderRole } from "./steps/IdentityStep";
import { StepBlocker } from "./steps/shared";
import { SpellsGearStep } from "./steps/SpellsGearStep";
import {
  abilitiesBlocker,
  ancestryBlocker,
  buildBuilderResult,
  callingBlocker,
  identityBlocker,
  spellsBlocker,
  validateBuilder,
  type BuilderResult,
} from "./submit";
import { builderActions, useBuilderDerived } from "./useBuilderDerived";
import { useArchetypes, useBuilderOptions, useWorldPack } from "./useBuilderOptions";
import { findRace, useBuilderState } from "./useBuilderState";
import { usePickerGroups } from "./usePickerGroups";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";
import { useInlineText } from "@/lib/i18n/inline-text";

export type { BuilderResult } from "./submit";

// Full character creation flow as a six-step wizard: identity, ancestry,
// calling, abilities, spells and gear, finishing touches. Open5e
// races/classes/subclasses/backgrounds (SRD fallback), three ability-score
// methods, spell/equipment/feat pickers, live derived stats. Used by
// /characters/new, the campaign join/edit/replace page and the companion
// dialog. The fields, validation and submitted sheet are unchanged from the
// single-page form this replaced; only the pacing is new.
export default function CharacterBuilder({
  fixedLevel,
  initialLevel,
  genre,
  worldPackId,
  initial,
  submitLabel,
  onSubmit,
  busy,
  error,
  role,
  className,
}: {
  fixedLevel?: number;
  initialLevel?: number;
  // Campaign genre: floats setting-appropriate classes to the top of the
  // class picker. Absent in the library builder (default ordering).
  genre?: Genre;
  // Campaign world pack: renames races, classes and backgrounds to the
  // world's own words and floats the ones that belong in it. Display only,
  // so every id submitted on the sheet stays canonical.
  worldPackId?: string;
  // Edit mode: prefill every field from an existing stored sheet (the
  // library copy, which owns builder-only fields like ASI picks).
  initial?: CreateSheetInput;
  submitLabel: string;
  onSubmit: (result: BuilderResult) => void;
  busy: boolean;
  error: string;
  // Player character or DM-played ally; only the library page asks, since a
  // campaign already knows which door the character comes through.
  role?: { value: BuilderRole; onChange: (role: BuilderRole) => void };
  className?: string;
}) {
  const uiText = useInlineText();
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: { newCharacter: "New character", identity: "Who is this?", ancestry: "Ancestry", ancestryBlurb: "Where are they from, and what does that grant?", calling: "Calling", callingBlurb: "The class decides how this character plays.", abilities: "Ability scores", abilitiesBlurb: "How do you roll?", spellsGear: "Spells and gear", gear: "Gear", spellsGearBlurb: "Pick what they can cast, then arm your hero.", gearBlurb: "Arm your hero.", finish: "Finishing touches", finishBlurb: "Who have you made?", yourCharacter: "your character" },
    ru: { newCharacter: "Новый персонаж", identity: "Кто это?", ancestry: "Происхождение", ancestryBlurb: "Откуда он и что это даёт?", calling: "Класс", callingBlurb: "Класс определяет стиль игры персонажем.", abilities: "Характеристики", abilitiesBlurb: "Как вы распределите значения?", spellsGear: "Заклинания и снаряжение", gear: "Снаряжение", spellsGearBlurb: "Выберите заклинания, затем вооружите героя.", gearBlurb: "Вооружите героя.", finish: "Последние штрихи", finishBlurb: "Кого вы создали?", yourCharacter: "вашего персонажа" },
  });
  const {
    races: rawRaces,
    classes: rawClasses,
    backgrounds: rawBackgrounds,
    packInstalled,
  } = useBuilderOptions();
  const pack = useWorldPack(worldPackId);
  // Display overlay only. applyIdReskins rewrites `name`, never `id`, so
  // race.asi, classFeaturesFor(klass.id), spellClassFor(klass.id) and the
  // submitted sheet all keep seeing canonical values.
  const races = useMemo(() => applyIdReskins(rawRaces, pack?.races ?? []), [rawRaces, pack]);
  const classes = useMemo(() => applyClassReskins(rawClasses, pack), [rawClasses, pack]);
  const backgrounds = useMemo(
    () => applyIdReskins(rawBackgrounds, pack?.backgrounds ?? []),
    [rawBackgrounds, pack],
  );

  const state = useBuilderState({ initial, initialLevel, fixedLevel, races, classes, backgrounds });
  const race = findRace(races, state.raceId) ?? races[0];
  const klass = classes.find((entry) => entry.id === state.classId) ?? classes[0];
  const background =
    backgrounds.find((entry) => entry.id === state.backgroundId) ?? backgrounds[0];
  const archetypes = useArchetypes(klass?.id ?? "");

  const derived = useBuilderDerived({ state, race, klass, background, fixedLevel });
  const actions = builderActions(state, klass, race, background);
  const pickers = usePickerGroups({
    races,
    rawRaces,
    classes,
    rawClasses,
    backgrounds,
    pack,
    genre,
    klass,
    subclass: state.subclass,
    effectiveLevel: derived.effectiveLevel,
    archetypes,
  });

  const paintsPortraits = offersImages(useCapabilities());
  const [cropping, setCropping] = useState(false);

  function submit() {
    const input = { state, derived, race, klass, background, locale };
    const problem = validateBuilder(input);
    if (problem) {
      if (problem.kind === "spellWarning") {
        state.setSpellWarningAck(true);
      }
      state.setLocalError(problem.message);
      return;
    }
    state.setLocalError("");
    onSubmit(buildBuilderResult(input));
  }

  if (!races.length || !classes.length || !backgrounds.length) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-5 animate-spin text-stone-500" />
      </div>
    );
  }

  // Each gate mirrors a rule the final check enforces, so a player learns
  // about a missing pick on the step where they can fix it.
  const blockers = {
    identity: identityBlocker(state),
    ancestry: ancestryBlocker(state, race, background),
    calling: callingBlocker(klass, state, derived),
    abilities: abilitiesBlocker(derived),
    spells: spellsBlocker(state, derived, klass, locale),
  };
  const casts = derived.casts;

  const steps: WizardStep[] = [
    {
      key: "identity",
       title: copy.identity,
      canContinue: !blockers.identity,
      content: (
        <>
          <IdentityStep
            state={state}
            pack={pack}
            packInstalled={packInstalled}
            fixedLevel={fixedLevel}
            role={role}
            alignmentGroups={pickers.alignmentGroups}
            alignmentInfo={pickers.alignmentInfo}
            backgroundGroups={pickers.backgroundGroups}
            background={background}
          />
          <StepBlocker message={blockers.identity} />
        </>
      ),
    },
    {
      key: "ancestry",
       title: copy.ancestry,
       blurb: copy.ancestryBlurb,
      canContinue: !blockers.ancestry,
      content: (
        <>
          <AncestryStep
            state={state}
            race={race}
            background={background}
            raceGroups={pickers.raceGroups}
          />
          <StepBlocker message={blockers.ancestry} />
        </>
      ),
    },
    {
      key: "calling",
       title: copy.calling,
       blurb: copy.callingBlurb,
      canContinue: !blockers.calling,
      content: (
        <>
          <CallingStep
            state={state}
            derived={derived}
            actions={actions}
            klass={klass}
            background={background}
            pack={pack}
            classGroups={pickers.classGroups}
            subclassGroups={pickers.subclassGroups}
            offersSubclass={pickers.offersSubclass}
            chosenArchetype={pickers.chosenArchetype}
          />
          <StepBlocker message={blockers.calling} />
        </>
      ),
    },
    {
      key: "abilities",
       title: copy.abilities,
       blurb: copy.abilitiesBlurb,
      canContinue: !blockers.abilities,
      content: (
        <>
          <AbilitiesStep state={state} derived={derived} race={race} />
          <StepBlocker message={blockers.abilities} />
        </>
      ),
    },
    {
      key: "spells-gear",
       title: casts ? copy.spellsGear : copy.gear,
       blurb: casts ? copy.spellsGearBlurb : copy.gearBlurb,
      canContinue: !blockers.spells,
      content: (
        <>
          <SpellsGearStep
            state={state}
            derived={derived}
            actions={actions}
            klass={klass}
            pack={pack}
          />
          <StepBlocker message={blockers.spells} />
        </>
      ),
    },
    {
      key: "finish",
       title: copy.finish,
       blurb: copy.finishBlurb,
      canContinue: !busy,
      content: (
        <FinishStep
          state={state}
          derived={derived}
          race={race}
          initial={initial}
          paintsPortraits={paintsPortraits}
          onUploadPortrait={() => setCropping(true)}
          error={state.localError || error}
        />
      ),
    },
  ];

  return (
    // A bounded height so each step scrolls on its own and the Continue
    // button stays put; the fallback keeps a usable pane on a short phone.
    <div className={cn("flex h-[max(30rem,calc(100dvh-14rem))] flex-col text-sm", className)}>
      <Wizard
         title={state.name.trim() || copy.newCharacter}
        steps={steps}
        onDone={submit}
        doneLabel={
          busy ? (
            <>
              <Loader2 className="size-4 animate-spin" /> {submitLabel}
            </>
          ) : (
            submitLabel
          )
        }
      />
      {cropping ? (
        <AvatarCropDialog
          title={uiText("Portrait for {name}", { name: state.name.trim() || copy.yourCharacter })}
          onUploaded={(image) => {
            setCropping(false);
            state.setPortrait({ id: image.id, name: image.name, type: image.type, url: image.url });
          }}
          onClose={() => setCropping(false)}
        />
      ) : null}
    </div>
  );
}
