"use client";

import { InfoButton } from "@/components/ui/InfoDialog";
import { STANDARD_LANGUAGES } from "@/lib/content/mechanics";
import { describeRace } from "@/lib/help";
import OptionPicker, { type PickerGroup } from "../OptionPicker";
import { RacialChoicesSection } from "../RacialChoicesSection";
import type { BackgroundOption, RaceOption } from "../useBuilderOptions";
import type { BuilderState } from "../useBuilderState";
import { bonusLanguageCount } from "../submit";
import { Field, StepPanel, inputClass } from "./shared";
import { useI18n } from "@/lib/i18n/context";
import { localeText } from "@/lib/i18n/locale-text";

function languageHelp(race: RaceOption, background: BackgroundOption | undefined, copy: { speaks: string; and: string; plus: string; choice: string; more: string; fromBackground: string }): string {
  const parts = [`${race.name} ${copy.speaks} ${race.languages.join(` ${copy.and} `)}`];
  if (race.bonusLanguages > 0) {
    parts.push(`${copy.plus} ${race.bonusLanguages} ${copy.choice}`);
  }
  if (background?.languages) {
    parts.push(
      `${race.bonusLanguages > 0 ? copy.and : copy.plus} ${background.languages} ${copy.more} ${copy.fromBackground} ${background.name}`,
    );
  }
  return `${parts.join(" ")}.`;
}

// Step 2: where they are from. The race picker, then every choice the race
// leaves to the player: bonus languages, ability bumps, skills, tool, cantrip.
export function AncestryStep({
  state,
  race,
  background,
  raceGroups,
}: {
  state: BuilderState;
  race: RaceOption | undefined;
  background: BackgroundOption | undefined;
  raceGroups: PickerGroup[];
}) {
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: { title: "Where are they from?", race: "Race", bonus: "Bonus", language: "language", languages: "languages", languageInfo: "A language you know is one you can speak, read and write. It decides who your character can talk to without help, and it comes up more than new players expect: half the trouble in a dungeon is written on a wall.\n\nCommon is the trade tongue everyone shares. The rest are the tongues of particular peoples: Dwarvish, Elvish, Orc, Draconic and so on. Pick whatever fits where your character grew up, or whoever you expect to be negotiating with.", aria: "Bonus language", choose: "Choose a language...", speaks: "speaks", and: "and", plus: "plus", choice: "of your choice", more: "more from your", fromBackground: "background" },
    ru: { title: "Откуда он родом?", race: "Раса", bonus: "Дополнительный", language: "язык", languages: "языки", languageInfo: "Известный язык — это язык, на котором персонаж говорит, читает и пишет. Он определяет, с кем можно общаться без помощи, и встречается чаще, чем ожидают новички: половина неприятностей в подземелье написана на стене.\n\nВсеобщий — общий торговый язык. Остальные принадлежат определённым народам: дворфийский, эльфийский, орочий, драконий и другие. Выберите то, что подходит месту, где вырос персонаж, или тем, с кем он будет вести переговоры.", aria: "Дополнительный язык", choose: "Выберите язык...", speaks: "знает", and: "и", plus: "плюс", choice: "на выбор", more: "дополнительно от происхождения", fromBackground: "" },
    pl: { title: "Skąd pochodzi?", race: "Rasa", bonus: "Dodatkowy", language: "język", languages: "języki", languageInfo: "Znany język to taki, którym postać mówi, czyta i pisze. Określa, z kim może rozmawiać bez pomocy, i pojawia się częściej, niż oczekują nowi gracze: połowa problemów w podziemiu jest napisana na ścianie.\n\nWspólny to język handlowy znany wszystkim. Pozostałe są językami konkretnych ludów: krasnoludzkim, elfickim, orczym, smoczym i tak dalej. Wybierz taki, który pasuje do miejsca dorastania postaci lub osób, z którymi będzie negocjować.", aria: "Dodatkowy język", choose: "Wybierz język...", speaks: "zna", and: "i", plus: "plus", choice: "do wyboru", more: "więcej z tła", fromBackground: "" },
  });
  // The race's bonus languages plus the background's (an acolyte or a sage
  // learns two more), which used to be loaded and never asked for.
  const languageCount = bonusLanguageCount(race, background);
  return (
    <div className="space-y-4">
       <StepPanel title={copy.title} ornate>
         <Field label={copy.race}>
          <OptionPicker
            value={race?.id ?? ""}
            groups={raceGroups}
            className={inputClass}
            onChange={state.changeRace}
          />
          {race?.note ? (
            <span className="mt-1 flex items-start gap-1 text-xs text-stone-500">
              <span className="line-clamp-2 grow">{race.note}</span>
              <InfoButton
                label={race.name}
                text={describeRace(race.id) ?? race.note}
                reference={{ kind: "races", slug: race.id }}
              />
            </span>
          ) : null}
        </Field>
      </StepPanel>

      {race && languageCount > 0 ? (
        <StepPanel
          title={
            <span className="flex items-center gap-1">
               {copy.bonus} {languageCount === 1 ? copy.language : copy.languages}
              <InfoButton
                 label={copy.languages}
                 text={copy.languageInfo}
              />
            </span>
          }
           help={languageHelp(race, background, copy)}
        >
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {Array.from({ length: languageCount }, (_, index) => (
              <select
                key={index}
                value={state.bonusLanguages[index] ?? ""}
                onChange={(event) =>
                  state.setBonusLanguages((current) => {
                    const next = [...current];
                    next[index] = event.target.value;
                    return next;
                  })
                }
                className={inputClass}
                 aria-label={`${copy.aria} ${index + 1}`}
              >
                 <option value="">{copy.choose}</option>
                {STANDARD_LANGUAGES.filter(
                  (language) =>
                    !race.languages.includes(language) &&
                    (state.bonusLanguages[index] === language ||
                      !state.bonusLanguages.includes(language)),
                ).map((language) => (
                  <option key={language} value={language}>{language}</option>
                ))}
              </select>
            ))}
          </div>
        </StepPanel>
      ) : null}

      {race ? (
        <RacialChoicesSection
          race={race}
          grantedSkills={[
            ...state.chosenSkills,
            ...(background?.skills ?? []),
            ...(race.skills ?? []),
          ]}
          asi={state.racialAsi}
          onAsiChange={(index, ability) =>
            state.setRacialAsi((current) => {
              const next = [...current];
              next[index] = ability;
              return next;
            })
          }
          skills={state.racialSkills}
          onSkillsChange={(index, skill) =>
            state.setRacialSkills((current) => {
              const next = [...current];
              next[index] = skill;
              return next;
            })
          }
          cantrip={state.racialCantrip}
          onCantripChange={state.setRacialCantrip}
          tool={state.racialTool}
          onToolChange={state.setRacialTool}
          inputClass={inputClass}
        />
      ) : null}
    </div>
  );
}
