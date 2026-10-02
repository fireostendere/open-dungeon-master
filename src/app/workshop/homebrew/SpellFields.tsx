"use client";

import { useInlineText } from "@/lib/i18n/inline-text";
import { CONDITIONS } from "@/lib/bestiary/kit";
import { normalizeSpellMech } from "@/lib/homebrew/gear";
import {
  baseDamageDice,
  baseHealingDice,
  damageTypeFor,
  halfOnSaveFor,
  saveAbilityFor,
} from "@/lib/srd/spell-scaling";
import {
  CheckField,
  NumberField,
  SelectField,
  TextField,
  ToggleChips,
} from "@/app/workshop/homebrew/fields";
import { CLASS_IDS, DAMAGE_TYPES, SPELL_SCHOOLS } from "@/app/workshop/homebrew/types";
import {
  CASTING_TIMES,
  SPELL_COMPONENTS,
  SPELL_DURATIONS,
  SPELL_RANGES,
} from "@/lib/workshop/pickers";
import { CONDITION_BLURBS, SPELL_SCHOOL_BLURBS, glossaryFor } from "@/lib/help/terms";
import type { Data } from "@/app/workshop/homebrew/draft";
import { useI18n } from "@/lib/i18n/context";
import { localeText } from "@/lib/i18n/locale-text";
import { characterDisplay } from "@/lib/i18n/character-display";

// The spell form. The description is the part the engine reads its damage
// out of, the same way it reads the SRD's, so the form shows what it found
// there rather than asking for the dice a second time. The block underneath
// is the part prose cannot state: how the spell resolves, which save, what
// condition or buff it applies.

type Mech = Record<string, unknown>;

export function SpellFields({ data, onChange }: { data: Data; onChange: (next: Data) => void }) {
  const uiText = useInlineText();
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: { level: "Level", cantrip: "0 is a cantrip.", school: "School", schools: "Schools of magic", casting: "Casting time", castingHint: "How long it takes to cast. Most spells take one action.", range: "Range", rangeHint: "How far away the target can be. Self means the caster only.", components: "Components", componentsHint: "V spoken words, S a free hand, M a material (name it after M in brackets).", duration: "Duration", durationHint: "How long the effect lasts. Concentration spells end when the caster loses focus.", concentration: "Concentration", ritual: "Ritual", classes: "Classes that can learn it", higher: "At higher levels", higherPlaceholder: "The damage increases by 1d6 for each slot level above 1st.", higherHint: "The engine scales the dice from this sentence when a spell is upcast.", reads: "From the description the engine reads: ", damage: "damage", heals: "heals", noDice: "no dice", save: "save", half: "half on a success", write: " Write it as \"takes 3d6 fire damage\" and it will.", resolves: "How it resolves", resolvesHint: "Set this and the cast tools trust it over the prose.", prose: "Let the engine read the prose", attack: "Spell attack roll", targetSaves: "Target saves", auto: "Hits without a roll", heal: "Restores hit points", buff: "Grants a condition to allies", summon: "Conjures creatures", utility: "Utility, narrated", none: "none", halfSuccess: "Half on a success", damageType: "Damage type", fromProse: "from the prose", condition: "Condition on a hit or failed save", rounds: "For rounds", roundsHint: "10 rounds is a minute.", granted: "Condition granted", on: "On", caster: "the caster", ally: "one ally", allies: "several allies", note: "Note for the DM", notePlaceholder: "Up to three targets." },
    ru: { level: "Уровень", cantrip: "0 — заговор.", school: "Школа", schools: "Школы магии", casting: "Время накладывания", castingHint: "Сколько длится накладывание. Большинство заклинаний требует действия.", range: "Дистанция", rangeHint: "Как далеко может находиться цель. «На себя» означает только заклинателя.", components: "Компоненты", componentsHint: "В — произносимые слова, С — свободная рука, М — материальный компонент (укажите его после М в скобках).", duration: "Длительность", durationHint: "Как долго действует эффект. Концентрация заканчивается, если заклинатель теряет фокус.", concentration: "Концентрация", ritual: "Ритуал", classes: "Классы, способные изучить", higher: "На более высоких уровнях", higherPlaceholder: "Урон увеличивается на 1d6 за каждый уровень ячейки выше 1-го.", higherHint: "При накладывании более высокой ячейкой движок берёт масштабирование кубов из этого предложения.", reads: "Из описания движок читает: ", damage: "урона", heals: "восстанавливает", noDice: "кубы не найдены", save: "спасбросок", half: "половина при успехе", write: " Напишите «получает 3d6 огненного урона», и он это распознает.", resolves: "Как разрешается", resolvesHint: "Укажите это, и инструменты накладывания доверятся значению больше, чем описанию.", prose: "Пусть движок читает описание", attack: "Бросок атаки заклинанием", targetSaves: "Цель делает спасбросок", auto: "Попадает без броска", heal: "Восстанавливает хиты", buff: "Даёт союзникам состояние", summon: "Призывает существ", utility: "Утилитарное, с описанием", none: "нет", halfSuccess: "Половина при успехе", damageType: "Тип урона", fromProse: "из описания", condition: "Состояние при попадании или провале", rounds: "Раундов", roundsHint: "10 раундов — минута.", granted: "Данное состояние", on: "Кому", caster: "заклинателю", ally: "одному союзнику", allies: "нескольким союзникам", note: "Заметка для ведущего", notePlaceholder: "До трёх целей." },
  });
  const resolutions = [
    { value: "", label: copy.prose }, { value: "attack", label: copy.attack }, { value: "save", label: copy.targetSaves }, { value: "auto", label: copy.auto }, { value: "heal", label: copy.heal }, { value: "buff", label: copy.buff }, { value: "summon", label: copy.summon }, { value: "utility", label: copy.utility },
  ] as const;
  const abilityOptions = [{ value: "", label: copy.none }, ...(["str", "dex", "con", "int", "wis", "cha"] as const).map((value) => ({ value, label: characterDisplay(value, locale) }))];
  const set = (patch: Data) => onChange({ ...data, ...patch });
  const mech = (data.mech ?? {}) as Mech;
  const setMech = (patch: Mech) => {
    const next = { ...mech, ...patch };
    set({ mech: next.resolution ? next : undefined });
  };
  const desc = String(data.desc ?? "");
  const read = {
    dice: baseDamageDice(desc),
    heal: baseHealingDice(desc),
    save: saveAbilityFor(desc),
    half: halfOnSaveFor(desc),
    type: damageTypeFor(desc),
  };
  const block = normalizeSpellMech(mech);
  const condition = (mech.condition ?? {}) as Mech;
  const buff = (mech.buff ?? {}) as Mech;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <NumberField
          label={copy.level}
          value={typeof data.level === "number" ? data.level : 1}
          min={0}
          max={9}
          onChange={(level) => set({ level: level === "" ? 0 : level })}
          hint={copy.cantrip}
        />
        <SelectField
          label={copy.school}
          value={String(data.school ?? "evocation")}
          options={SPELL_SCHOOLS.map((value) => ({ value, label: characterDisplay(value, locale) }))}
          onChange={(school) => set({ school })}
          glossary={{ title: copy.schools, entries: glossaryFor(SPELL_SCHOOLS, SPELL_SCHOOL_BLURBS) }}
        />
        <TextField
          label={copy.casting}
          value={String(data.casting_time ?? "")}
          onChange={(casting_time) => set({ casting_time })}
          maxLength={60}
          suggestions={CASTING_TIMES}
          hint={copy.castingHint}
        />
        <TextField
          label={copy.range}
          value={String(data.range ?? "")}
          onChange={(range) => set({ range })}
          maxLength={60}
          suggestions={SPELL_RANGES}
          hint={copy.rangeHint}
        />
        <TextField
          label={copy.components}
          value={String(data.components ?? "")}
          onChange={(components) => set({ components })}
          maxLength={120}
          suggestions={SPELL_COMPONENTS}
          hint={copy.componentsHint}
        />
        <TextField
          label={copy.duration}
          value={String(data.duration ?? "")}
          onChange={(duration) => set({ duration })}
          maxLength={60}
          suggestions={SPELL_DURATIONS}
          hint={copy.durationHint}
        />
        <div className="col-span-2 flex flex-wrap items-end gap-3">
          <CheckField label={copy.concentration} checked={data.concentration === true} onChange={(concentration) => set({ concentration })} />
          <CheckField label={copy.ritual} checked={data.ritual === true} onChange={(ritual) => set({ ritual })} />
        </div>
      </div>

      <div className="space-y-1">
        <span className="text-[10px] uppercase tracking-wide text-stone-500">{copy.classes}</span>
        <ToggleChips
          options={CLASS_IDS}
          selected={Array.isArray(data.classes) ? (data.classes as string[]) : []}
          onChange={(classes) => set({ classes })}
        />
      </div>

      <TextField
        label={copy.higher}
        value={String(data.higher_level ?? "")}
        onChange={(higher_level) => set({ higher_level })}
        placeholder={copy.higherPlaceholder}
        maxLength={2000}
        hint={copy.higherHint}
      />

      <p className="rounded-md border border-stone-800 bg-stone-950/60 px-2 py-1.5 text-[11px] text-stone-400">
        <span className="uppercase tracking-wide text-stone-500">{copy.reads}</span>
        {read.dice ? `${read.dice}${read.type ? ` ${read.type}` : ""} ${copy.damage}` : read.heal ? `${copy.heals} ${read.heal}` : copy.noDice}
        {read.save ? `, ${read.save.toUpperCase()} ${copy.save}${read.half ? `, ${copy.half}` : ""}` : ""}.
        {!read.dice && !read.heal ? copy.write : ""}
      </p>

      <div className="space-y-2 rounded-md border border-stone-800 p-2">
        <SelectField
          label={copy.resolves}
          value={String(mech.resolution ?? "")}
          options={resolutions}
          onChange={(resolution) => setMech({ resolution: resolution || undefined })}
          hint={copy.resolvesHint}
        />
        {block ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {block.resolution === "save" ? (
              <>
                <SelectField
                  label={copy.save}
                  value={String(mech.save ?? "")}
                  options={abilityOptions}
                  onChange={(save) => setMech({ save: save || undefined })}
                />
                <div className="flex items-end pb-1">
                  <CheckField label={copy.halfSuccess} checked={mech.halfOnSave === true} onChange={(halfOnSave) => setMech({ halfOnSave })} />
                </div>
              </>
            ) : null}
            {["attack", "save", "auto"].includes(block.resolution) ? (
              <SelectField
                label={copy.damageType}
                value={String(mech.damageType ?? "")}
                options={[{ value: "", label: copy.fromProse }, ...DAMAGE_TYPES.map((value) => ({ value, label: characterDisplay(value, locale) }))]}
                onChange={(damageType) => setMech({ damageType: damageType || undefined })}
              />
            ) : null}
            {["attack", "save", "auto"].includes(block.resolution) ? (
              <>
                <TextField
                  label={copy.condition}
                  value={String(condition.name ?? "")}
                  onChange={(name) => setMech({ condition: name ? { ...condition, name } : undefined })}
                  placeholder={uiText("frightened")}
                  maxLength={40}
                  suggestions={CONDITIONS}
                  glossary={{ title: uiText("conditions"), entries: glossaryFor(CONDITIONS, CONDITION_BLURBS) }}
                />
                {condition.name ? (
                  <NumberField
                    label={copy.rounds}
                    value={typeof condition.rounds === "number" ? condition.rounds : 10}
                    min={1}
                    max={6000}
                    onChange={(rounds) => setMech({ condition: { ...condition, rounds: rounds === "" ? 10 : rounds } })}
                    hint={copy.roundsHint}
                  />
                ) : null}
              </>
            ) : null}
            {block.resolution === "buff" ? (
              <>
                <TextField
                  label={copy.granted}
                  value={String(buff.condition ?? "")}
                  onChange={(name) => setMech({ buff: { ...buff, condition: name } })}
                  placeholder={uiText("blessed")}
                  maxLength={40}
                  suggestions={["blessed", "hasted", "shielded", "invisible", "inspired", ...CONDITIONS]}
                />
                <SelectField
                  label={copy.on}
                  value={String(buff.target ?? "self")}
                  options={[
                    { value: "self", label: copy.caster }, { value: "ally", label: copy.ally }, { value: "allies", label: copy.allies },
                  ]}
                  onChange={(target) => setMech({ buff: { ...buff, target } })}
                />
                <NumberField
                label={copy.rounds}
                  value={typeof buff.rounds === "number" ? buff.rounds : 10}
                  min={1}
                  max={6000}
                  onChange={(rounds) => setMech({ buff: { ...buff, rounds: rounds === "" ? 10 : rounds } })}
                />
              </>
            ) : null}
            <TextField
              label={copy.note}
              value={String(mech.note ?? "")}
              onChange={(note) => setMech({ note: note || undefined })}
              placeholder={copy.notePlaceholder}
              maxLength={200}
              className="col-span-2"
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
