"use client";

import { X } from "lucide-react";
import { InfoButton } from "@/components/ui/InfoDialog";
import { cn } from "@/lib/cn";
import { contentSlug } from "@/lib/help";
import { abilityMod, formatModifier } from "@/lib/srd";
import { ABILITY_SCORE_CAP, applyAsiChoices } from "@/lib/srd/asi";
import type { Ability, AbilityScores, AsiChoice } from "@/lib/schemas/sheet";
import { ABILITY_LABELS } from "./AbilityEditor";
import CatalogBrowser from "./CatalogBrowser";
import ContentPicker from "./ContentPicker";
import { useI18n } from "@/lib/i18n/context";
import { localeText } from "@/lib/i18n/locale-text";

const ABILITY_KEYS = Object.keys(ABILITY_LABELS) as Ability[];

// One card per earned Ability Score Improvement (levels 4/8/12/16/19).
// Choices apply in order, so each card's selects reflect the scores after
// every earlier card; abilities already at the 20 cap are disabled.
export default function AsiFeatEditor({
  level,
  slotLevels,
  baseScores,
  choices,
  onChange,
}: {
  // Character level for the builder's "Level N: X earned" heading; absent in
  // the level-up dialog, which introduces the section with its own copy.
  level?: number;
  slotLevels: number[];
  baseScores: AbilityScores | null;
  choices: Array<AsiChoice | null>;
  onChange: (choices: Array<AsiChoice | null>) => void;
}) {
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: { level: "Level", improvement: "improvement", improvements: "improvements", earned: "earned", asi: "Ability score improvements", toPick: "to pick", allPicked: "All picked", intro: "This is how higher-level characters raise their stats. Each earned level grants +2 to one ability score, +1 to two of them, or a feat. Scores cap at", assign: "Assign all six ability scores first.", plus2: "+2 one ability", plus1: "+1 two abilities", feat: "Feat", atCap: "at cap", first: "First +1", second: "Second +1", remove: "Remove", search: "Search feats (e.g. alert, tough)", browse: "Browse every feat", allFeats: "All feats", choose: "Pick +2, two +1s, or search a feat above.", to: "to" },
    ru: { level: "Уровень", improvement: "улучшение", improvements: "улучшений", earned: "получено", asi: "Улучшения характеристик", toPick: "нужно выбрать", allPicked: "Всё выбрано", intro: "Так персонажи высоких уровней повышают характеристики. Каждый полученный уровень даёт +2 к одной характеристике, +1 к двум или черту. Максимум характеристики:", assign: "Сначала назначьте все шесть характеристик.", plus2: "+2 к одной характеристике", plus1: "+1 к двум характеристикам", feat: "Черта", atCap: "предел", first: "Первые +1", second: "Вторые +1", remove: "Удалить", search: "Искать черты (например: настороженность, крепкий)", browse: "Просмотреть все черты", allFeats: "Все черты", choose: "Выберите +2, два +1 или найдите черту выше.", to: "до" },
    pl: { level: "Poziom", improvement: "ulepszenie", improvements: "ulepszeń", earned: "zdobyto", asi: "Ulepszenia cech", toPick: "do wyboru", allPicked: "Wszystko wybrane", intro: "Tak postacie wyższych poziomów podnoszą cechy. Każdy zdobyty poziom daje +2 do jednej cechy, +1 do dwóch albo atut. Limit cechy:", assign: "Najpierw przypisz wszystkie sześć cech.", plus2: "+2 do jednej cechy", plus1: "+1 do dwóch cech", feat: "Atut", atCap: "limit", first: "Pierwsze +1", second: "Drugie +1", remove: "Usuń", search: "Szukaj atutów (np. czujny, wytrzymały)", browse: "Przeglądaj każdy atut", allFeats: "Wszystkie atuty", choose: "Wybierz +2, dwa +1 albo wyszukaj atut powyżej.", to: "na" },
  });
  const abilityNames = localeText(locale, { en: ABILITY_LABELS, ru: { str: "Сила", dex: "Ловкость", con: "Телосложение", int: "Интеллект", wis: "Мудрость", cha: "Харизма" }, pl: { str: "Siła", dex: "Zręczność", con: "Kondycja", int: "Inteligencja", wis: "Mądrość", cha: "Charyzma" } });
  const modes = [["plus2", copy.plus2], ["plus1x2", copy.plus1], ["feat", copy.feat]] as const;
  const inputClass =
    "w-full rounded-lg border border-stone-800 bg-stone-950 px-3 py-2 text-sm text-stone-200 outline-none focus:border-amber-300";

  function setChoice(index: number, choice: AsiChoice | null) {
    const next = slotLevels.map((_, slot) => choices[slot] ?? null);
    next[index] = choice;
    onChange(next);
  }

  const unresolved = slotLevels.filter((_, index) => !choices[index]).length;

  return (
    <section className="panel ornate rounded-xl border-amber-500/30 p-4">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 className="eyebrow text-xs text-amber-200/90">
          {level
            ? `${copy.level} ${level}: ${slotLevels.length} ${slotLevels.length === 1 ? copy.improvement : copy.improvements} ${copy.earned}`
            : copy.asi}
        </h2>
        {unresolved > 0 ? (
          <span className="rounded-full border border-amber-700 bg-amber-950/50 px-2 py-0.5 text-[11px] text-amber-200">
             {unresolved} {copy.toPick}
          </span>
        ) : (
          <span className="rounded-full border border-stone-700 bg-stone-900 px-2 py-0.5 text-[11px] text-stone-400">
             {copy.allPicked}
          </span>
        )}
      </div>
      <p className="mb-3 text-xs text-stone-500">
         {copy.intro} {ABILITY_SCORE_CAP}.
      </p>
      {!baseScores ? (
        <p className="rounded-md border border-stone-800 bg-stone-900/60 p-3 text-xs text-stone-400">
           {copy.assign}
        </p>
      ) : (
        <div className="space-y-3">
          {slotLevels.map((slotLevel, index) => {
            const choice = choices[index] ?? null;
            // Scores as they stand entering this slot: base plus all
            // earlier choices.
            const current = applyAsiChoices(baseScores, choices.slice(0, index));
            return (
              <div
                key={slotLevel}
                className="rounded-lg border border-stone-800 bg-stone-950/60 p-3"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-stone-300">{copy.level} {slotLevel}: {copy.improvement}</span>
                  <div className="flex rounded-md border border-stone-700 p-0.5 text-xs">
                    {modes.map(([mode, label]) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => {
                          if (mode === "feat") {
                            // Clears back to the feat search; picking a feat resolves it.
                            setChoice(index, null);
                          } else if (mode === "plus2") {
                            setChoice(index, { mode: "plus2", ability: firstOpenAbility(current) });
                          } else {
                            const first = firstOpenAbility(current);
                            const second = firstOpenAbility(current, first);
                            setChoice(index, { mode: "plus1x2", abilities: [first, second] });
                          }
                        }}
                        className={cn(
                          "rounded px-2.5 py-1",
                          choice?.mode === mode
                            ? "bg-amber-900/60 text-amber-200"
                            : "text-stone-400 hover:text-stone-200",
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {choice?.mode === "plus2" ? (
                  <label className="block sm:w-64">
                    <span className="mb-1 block text-xs text-stone-500">{copy.plus2}</span>
                    <select
                      value={choice.ability}
                      onChange={(event) =>
                        setChoice(index, { mode: "plus2", ability: event.target.value as Ability })
                      }
                      className={inputClass}
                    >
                      {ABILITY_KEYS.map((ability) => (
                        <option
                          key={ability}
                          value={ability}
                          disabled={current[ability] >= ABILITY_SCORE_CAP && ability !== choice.ability}
                        >
                          {abilityNames[ability]} ({current[ability]}
                          {current[ability] >= ABILITY_SCORE_CAP ? `, ${copy.atCap}` : ""})
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {choice?.mode === "plus1x2" ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {([0, 1] as const).map((half) => (
                      <label key={half} className="block">
                        <span className="mb-1 block text-xs text-stone-500">
                          {half === 0 ? copy.first : copy.second}
                        </span>
                        <select
                          value={choice.abilities[half]}
                          onChange={(event) => {
                            const abilities = [...choice.abilities] as [Ability, Ability];
                            abilities[half] = event.target.value as Ability;
                            setChoice(index, { mode: "plus1x2", abilities });
                          }}
                          className={inputClass}
                        >
                          {ABILITY_KEYS.map((ability) => (
                            <option
                              key={ability}
                              value={ability}
                              disabled={
                                (current[ability] >= ABILITY_SCORE_CAP &&
                                  ability !== choice.abilities[half]) ||
                                ability === choice.abilities[half === 0 ? 1 : 0]
                              }
                            >
                              {abilityNames[ability]} ({current[ability]}
                              {current[ability] >= ABILITY_SCORE_CAP ? `, ${copy.atCap}` : ""})
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                ) : null}

                {choice === null || choice.mode === "feat" ? (
                  <div>
                    {choice?.mode === "feat" ? (
                      <span className="mb-2 inline-flex items-center gap-1 rounded-full border border-amber-800 bg-amber-950/40 px-2.5 py-1 text-xs text-amber-200">
                        {choice.feat}
                        <InfoButton
                          label={choice.feat}
                          reference={{
                            kind: "feats",
                            slug: contentSlug(choice.feat),
                            name: choice.feat,
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => setChoice(index, null)}
                          aria-label={`${copy.remove}: ${choice.feat}`}
                          className="text-stone-500 hover:text-red-400"
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    ) : (
                      <>
                        <ContentPicker
                          kind="feats"
                          placeholder={copy.search}
                          onPick={(entry) => setChoice(index, { mode: "feat", feat: entry.name })}
                        />
                        {/* Nobody picks a feat they cannot name; the list is
                            here, with what each one does on every row. */}
                        <CatalogBrowser
                          kind="feats"
                          buttonLabel={copy.browse}
                          selectedNames={[]}
                          onPick={(entry) => setChoice(index, { mode: "feat", feat: entry.name })}
                          sections={[{ key: "feats:all", label: copy.allFeats }]}
                        />
                      </>
                    )}
                  </div>
                ) : null}

                {choice ? (
                  <p className="mt-2 text-xs text-stone-500">
                    {choice.mode === "feat"
                      ? `${copy.feat}: ${choice.feat}`
                      : summarizeChoice(current, choice, copy.to, abilityNames)}
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-stone-500">
                    {copy.choose}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function firstOpenAbility(scores: AbilityScores, skip?: Ability): Ability {
  const open = ABILITY_KEYS.find(
    (ability) => ability !== skip && scores[ability] < ABILITY_SCORE_CAP,
  );
  return open ?? ABILITY_KEYS.find((ability) => ability !== skip) ?? "str";
}

function summarizeChoice(current: AbilityScores, choice: AsiChoice, to: string, abilityNames: Record<Ability, string>): string {
  const after = applyAsiChoices(current, [choice]);
  const touched =
    choice.mode === "plus2" ? [choice.ability] : choice.mode === "plus1x2" ? choice.abilities : [];
  return touched
    .map(
      (ability) =>
        `${abilityNames[ability]} ${current[ability]} ${to} ${after[ability]} (${formatModifier(abilityMod(after[ability]))})`,
    )
    .join(", ");
}
