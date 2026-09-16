"use client";

import CatalogBrowser from "@/app/characters/builder/CatalogBrowser";
import ContentPicker from "@/app/characters/builder/ContentPicker";
import type { RaceOption } from "@/app/characters/builder/useBuilderOptions";
import { GameTerm } from "@/components/ui/GameTerm";
import { InfoButton } from "@/components/ui/InfoDialog";
import { ALL_SKILLS } from "@/lib/content/mechanics";
import { contentSlug, describeSkill } from "@/lib/help";
import { SRD_SKILLS } from "@/lib/srd";
import { ABILITIES, type Ability } from "@/lib/schemas/sheet";
import { useI18n } from "@/lib/i18n/context";
import { localeText } from "@/lib/i18n/locale-text";

const ABILITY_NAMES: Record<Ability, string> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma",
};

function skillName(skillId: string) {
  return SRD_SKILLS.find((skill) => skill.id === skillId)?.name ?? skillId;
}

// The picks a race offers instead of fixing: half-elf's two +1 ability
// bumps and two skills, high elf's wizard cantrip, hill dwarf's tool. Until
// these existed the grants were silently dropped, leaving those characters
// weaker than the rules allow.
export function RacialChoicesSection({
  race,
  grantedSkills,
  asi,
  onAsiChange,
  skills,
  onSkillsChange,
  cantrip,
  onCantripChange,
  tool,
  onToolChange,
  inputClass,
}: {
  race: RaceOption;
  // Skills already granted by class and background, so they are not offered
  // twice (a duplicate pick would waste the racial choice).
  grantedSkills: string[];
  asi: Array<Ability | "">;
  onAsiChange: (index: number, ability: Ability | "") => void;
  skills: string[];
  onSkillsChange: (index: number, skill: string) => void;
  cantrip: string;
  onCantripChange: (spell: string) => void;
  tool: string;
  onToolChange: (tool: string) => void;
  inputClass: string;
}) {
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: { choices: "choices", ability: "Ability", increases: "increases", abilitiesChoice: "abilities of your choice", abilityIncrease: "Ability increase", chooseAbility: "Choose an ability...", what: "what is this?", skill: "Skill", proficiencies: "proficiencies", choice: "of your choice", skillProficiency: "Skill proficiency", chooseSkill: "Choose a skill...", tool: "Tool proficiency", chooseTool: "Choose a tool...", bonus: "Bonus", one: "one", cantrip: "cantrip", cantripHelp: "A cantrip is a small spell you can cast as often as you like, forever. Pick one from the list below (tap ⓘ to read what each does), or search by name if you already have one in mind.", change: "Change", every: "Every", orSearch: "Or search by name:", searchCantrips: "Search cantrips (e.g. fire bolt)" },
    ru: { choices: "выборы", ability: "Характеристика", increases: "увеличения", abilitiesChoice: "характеристик на выбор", abilityIncrease: "Увеличение характеристики", chooseAbility: "Выберите характеристику...", what: "что это?", skill: "Навык", proficiencies: "владения", choice: "на выбор", skillProficiency: "Владение навыком", chooseSkill: "Выберите навык...", tool: "Владение инструментом", chooseTool: "Выберите инструмент...", bonus: "Дополнительный", one: "один", cantrip: "заговор", cantripHelp: "Заговор — это небольшое заклинание, которое можно накладывать сколько угодно раз. Выберите его из списка ниже (нажмите ⓘ, чтобы прочитать описание) или найдите по названию.", change: "Изменить", every: "Все", orSearch: "Или найдите по названию:", searchCantrips: "Искать заговоры (например: огненный снаряд)" },
    pl: { choices: "wybory", ability: "Cecha", increases: "zwiększenia", abilitiesChoice: "cech do wyboru", abilityIncrease: "Zwiększenie cechy", chooseAbility: "Wybierz cechę...", what: "co to jest?", skill: "Umiejętność", proficiencies: "biegłości", choice: "do wyboru", skillProficiency: "Biegłość w umiejętności", chooseSkill: "Wybierz umiejętność...", tool: "Biegłość w narzędziu", chooseTool: "Wybierz narzędzie...", bonus: "Dodatkowa", one: "jedna", cantrip: "sztuczka", cantripHelp: "Sztuczka to małe zaklęcie, które możesz rzucać dowolnie często. Wybierz jedną z listy poniżej (dotknij ⓘ, aby przeczytać opis) lub wyszukaj po nazwie.", change: "Zmień", every: "Każda", orSearch: "Albo wyszukaj po nazwie:", searchCantrips: "Szukaj sztuczek (np. ognisty pocisk)" },
  });
  const abilityNames = localeText(locale, { en: ABILITY_NAMES, ru: { str: "Сила", dex: "Ловкость", con: "Телосложение", int: "Интеллект", wis: "Мудрость", cha: "Харизма" }, pl: { str: "Siła", dex: "Zręczność", con: "Kondycja", int: "Inteligencja", wis: "Mądrość", cha: "Charyzma" } });
  const hasChoices = Boolean(
    race.asiChoice || race.skillChoice || race.cantripChoice || race.toolChoice,
  );
  if (!hasChoices) {
    return null;
  }

  // A half-elf's +1s go to abilities other than the one the race already
  // raises, per the SRD.
  const fixedAbilities = new Set(Object.keys(race.asi) as Ability[]);

  return (
    <div className="space-y-3 rounded-lg border border-amber-900/40 bg-amber-950/10 p-3">
       <p className="text-xs text-amber-200/90">{race.name}: {copy.choices}</p>

      {race.asiChoice ? (
        <div>
          <span className="mb-1 flex flex-wrap items-center gap-1 text-stone-400">
             <GameTerm id="ability_score">{copy.ability}</GameTerm> {copy.increases} (+{race.asiChoice.amount} {copy.abilitiesChoice}: {race.asiChoice.count})
          </span>
          <div className="grid grid-cols-2 gap-2">
            {Array.from({ length: race.asiChoice.count }, (_, index) => (
              <span key={index} className="flex items-center gap-1">
                <select
                  value={asi[index] ?? ""}
                  onChange={(event) => onAsiChange(index, event.target.value as Ability | "")}
                  className={inputClass}
                   aria-label={`${copy.abilityIncrease} ${index + 1}`}
                >
                   <option value="">{copy.chooseAbility}</option>
                  {ABILITIES.filter(
                    (ability) =>
                      !fixedAbilities.has(ability) &&
                      (asi[index] === ability || !asi.includes(ability)),
                  ).map((ability) => (
                    <option key={ability} value={ability}>
                       {abilityNames[ability]}
                    </option>
                  ))}
                </select>
                {asi[index] ? (
                  <GameTerm id={asi[index] as Ability} className="shrink-0 text-xs text-stone-500">
                     {copy.what}
                  </GameTerm>
                ) : null}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {race.skillChoice ? (
        <div>
          <span className="mb-1 flex flex-wrap items-center gap-1 text-stone-400">
             <GameTerm id="skill">{copy.skill}</GameTerm> {copy.proficiencies} ({race.skillChoice.count} {copy.choice})
          </span>
          <div className="grid grid-cols-2 gap-2">
            {Array.from({ length: race.skillChoice.count }, (_, index) => (
              <span key={index} className="flex items-center gap-1">
                <select
                  value={skills[index] ?? ""}
                  onChange={(event) => onSkillsChange(index, event.target.value)}
                  className={inputClass}
                   aria-label={`${copy.skillProficiency} ${index + 1}`}
                >
                   <option value="">{copy.chooseSkill}</option>
                  {ALL_SKILLS.filter(
                    (skill) =>
                      skills[index] === skill ||
                      (!skills.includes(skill) && !grantedSkills.includes(skill)),
                  ).map((skill) => (
                    <option key={skill} value={skill}>
                      {skillName(skill)}
                    </option>
                  ))}
                </select>
                {skills[index] ? (
                  <InfoButton
                    label={skillName(skills[index])}
                    text={describeSkill(skills[index])}
                  />
                ) : null}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {race.toolChoice ? (
        <label className="block">
           <span className="mb-1 block text-stone-400">{copy.tool}</span>
          <select
            value={tool}
            onChange={(event) => onToolChange(event.target.value)}
            className={inputClass}
          >
             <option value="">{copy.chooseTool}</option>
            {race.toolChoice.from.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {race.cantripChoice ? (
        <div>
          <span className="mb-1 flex flex-wrap items-center gap-1 text-stone-400">
             {copy.bonus} <GameTerm id="cantrip">{copy.cantrip}</GameTerm> ({copy.one} {race.cantripChoice.list} {copy.cantrip})
          </span>
          <p className="mb-1.5 text-xs text-stone-500">
             {copy.cantripHelp}
          </p>
          {cantrip ? (
            <div className="mb-1.5 flex items-center gap-2">
              <span className="flex items-center gap-1 rounded-full border border-amber-800 bg-amber-950/40 px-2.5 py-1 text-xs text-amber-200">
                {cantrip}
                <InfoButton
                  label={cantrip}
                  reference={{ kind: "spells", slug: contentSlug(cantrip), name: cantrip }}
                />
              </span>
              <button
                type="button"
                onClick={() => onCantripChange("")}
                className="text-xs text-stone-500 hover:text-stone-300"
              >
                 {copy.change}
              </button>
            </div>
          ) : (
            <>
              {/* Nobody can search for a cantrip they have never heard of.
                  Every one this race may take is listed from the start, each
                  with the ⓘ that says what it does; the search is second. */}
              <CatalogBrowser
                kind="spells"
                 buttonLabel={`${copy.every} ${race.cantripChoice.list} ${copy.cantrip}`}
                defaultOpen
                openSections={[`cantrips:${race.cantripChoice.list}`]}
                selectedNames={cantrip ? [cantrip] : []}
                onPick={(entry) => onCantripChange(entry.name)}
                sections={[
                  {
                    key: `cantrips:${race.cantripChoice.list}`,
                     label: `${copy.every} ${race.cantripChoice.list} ${copy.cantrip}`,
                    params: { class: race.cantripChoice.list, level: "0" },
                  },
                ]}
                metaOf={(entry) => entry.school ?? ""}
              />
               <p className="mt-2 mb-1 text-xs text-stone-500">{copy.orSearch}</p>
              <ContentPicker
                kind="spells"
                extraParams={{ class: race.cantripChoice.list, level: "0" }}
                 placeholder={copy.searchCantrips}
                onPick={(entry) => onCantripChange(entry.name)}
              />
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
