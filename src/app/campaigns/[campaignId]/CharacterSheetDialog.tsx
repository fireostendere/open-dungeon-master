"use client";

import { useInlineText } from "@/lib/i18n/inline-text";
import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { FileDown, Minus, Plus, PawPrint, Pencil, Wrench, X } from "lucide-react";
import { GameIcon } from "@/components/ui/GameIcon";
import { conditionIconKey } from "@/lib/icons";
import { cn } from "@/lib/cn";
import { CharacterPortrait, ui } from "@/lib/ui";
import { downloadCharacterSheetPdf } from "@/lib/pdf/download";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { ABILITIES } from "@/lib/schemas/sheet";
import {
  acBreakdownFor,
  computeSheetDerived,
  formatModifier,
  powerfulBuildForRace,
  speedFor,
  SRD_SKILLS,
  sizeForRace,
  type DerivedPart,
} from "@/lib/srd";
import { ATTUNEMENT_SLOTS, matchArmor } from "@/lib/srd/armor";
import { encumbranceFor } from "@/lib/srd/encumbrance";
import { matchMagicItem, magicItemRiders } from "@/lib/srd/magic-items";
import { RESOURCE_DEFS } from "@/lib/srd/class-resources";
import { GameTerm } from "@/components/ui/GameTerm";
import { InfoButton, InfoChipList } from "@/components/ui/InfoDialog";
import {
  contentSlug,
  describeFeature,
  describeRaceTrait,
  localizedContentName,
  localizedFeatureName,
  localizedRaceName,
  localizedRaceTraitName,
} from "@/lib/help";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";
import { describeConditionDuration } from "@/lib/dm/condition-logic";
import { characterDisplay } from "@/lib/i18n/character-display";
import { SheetSpells } from "@/components/sheet/SheetSpells";

function titleCase(value: string) {
  return value.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const RESOURCE_NAMES = new Map(RESOURCE_DEFS.map((def) => [def.id, def.displayName]));
// Every resource already carries a line explaining what spending it does; it
// was written for the DM model and reads just as well for the player.
const RESOURCE_HELP = new Map(RESOURCE_DEFS.map((def) => [def.id, def.guidance]));

const stepButton =
  "flex items-center justify-center rounded border border-stone-700 p-0.5 text-stone-300 hover:bg-stone-800 disabled:opacity-40";

// Full character sheet, opened by selecting any party member. Read-only,
// except the owner may adjust the spent side of counters their class
// actually has (spell slots, hit dice, resource pools) and which gear they
// wear or are attuned to, via /sheet/usage. Notes stay private to the
// sheet's owner.
// Every derived number's working, the way AC has always shown its own.
// computeSheetDerived returns the parts it summed, so a hover can say where a
// +7 came from without this file knowing a single rule.
function explainParts(parts: DerivedPart[]): string {
  return parts.map((part) => `${formatModifier(part.value)} ${part.label}`).join(", ");
}

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"];

// One spell slot level: a mark per slot, filled while it is still there.
function SlotRow({
  label,
  left,
  max,
  editable,
  busy,
  inCombat,
  onSpend,
  onRecover,
}: {
  label: string;
  left: number;
  max: number;
  editable: boolean;
  busy: boolean;
  inCombat: boolean;
  onSpend?: () => void;
  onRecover?: () => void;
}) {
  const uiText = useInlineText();
  const leftOf = uiText("{left} of {max} left", { left, max });
  return (
    <span
      className="flex items-center gap-1.5 rounded-lg border border-stone-800 px-2 py-1"
      title={`${label}: ${leftOf}`}
    >
      <span className="font-display text-[11px] tracking-wide text-stone-400">{label}</span>
      <span className="flex gap-0.5" aria-label={leftOf}>
        {Array.from({ length: max }, (_, index) => (
          <span
            key={index}
            className={cn(
              "size-2.5 rounded-full border",
              index < left
                ? "border-amber-400 bg-amber-400/80 shadow-[0_0_6px_rgba(212,171,58,0.5)]"
                : "border-stone-600",
            )}
          />
        ))}
      </span>
      {editable ? (
        <>
          <button
            type="button"
            className={stepButton}
            disabled={busy || left <= 0}
            title={uiText("Spend a slot")}
            aria-label={`${uiText("Spend a slot")}: ${label}`}
            onClick={onSpend}
          >
            <Minus className="size-3" />
          </button>
          <button
            type="button"
            className={stepButton}
            disabled={busy || inCombat || left >= max}
            title={inCombat ? uiText("Slots recover at rests, not mid-combat") : uiText("Recover a slot")}
            aria-label={`${uiText("Recover a slot")}: ${label}`}
            onClick={onRecover}
          >
            <Plus className="size-3" />
          </button>
        </>
      ) : null}
    </span>
  );
}

export function CharacterSheetDialog({
  sheet,
  mine,
  steersStory,
  encumbranceRule = false,
  inCombat = false,
  portraitFallback,
  onAdjust,
  onEditBackstory,
  onClose,
}: {
  sheet: CharacterSheet;
  mine: boolean;
  steersStory: boolean;
  // The world pack's picture for this character's class or race, drawn
  // before the generic plate when nobody has painted a portrait.
  portraitFallback?: string | null;
  // The table's optional encumbrance rule.
  encumbranceRule?: boolean;
  // 5e timing: resources only come back at rests, so during an active
  // encounter the recover steppers lock (the server refuses too); spending
  // stays available for bookkeeping.
  inCombat?: boolean;
  onAdjust?: () => void;
  onEditBackstory?: () => void;
  onClose: () => void;
}) {
  const uiText = useInlineText();
  const derived = computeSheetDerived(sheet);
  const armor = acBreakdownFor(sheet);
  const attunedCount = sheet.equipment.filter((item) => item.attuned).length;
  // Only gear worth a toggle: armor and shields can be worn, and anything
  // whose name declares a magic bonus can be attuned.
  const wearable = sheet.equipment.filter(
    (item) =>
      matchArmor(item.name) !== null ||
      /\+[123]\b/.test(item.name) ||
      matchMagicItem(item.name) !== null,
  );
  const magic = magicItemRiders(sheet.equipment);
  // Carried weight is always worth showing once the pack has weights on it;
  // the thresholds and their penalties only mean something when the table
  // turned the variant rule on.
  // The speed the server will actually let them move: armor gates the class
  // bonuses, heavy armor below its Strength minimum costs 10 feet, and a
  // heavy pack costs more when the table plays with encumbrance.
  const { t, formatSpeed, formatWeight, locale } = useI18n();
  const copy = localeText(locale, {
    en: {
      baseSpeed: "Base",
      walkingSpeed: "Their walking speed.",
      reducedByGear: "reduced by what they wear",
      andCarry: " and carry",
      initiative: "Init",
      passivePerception: "PP",
      proficiencyBonus: "PB",
      gold: "gp",
      level: "Level",
      xpHitDice: "XP · Hit dice", wildShape: "Wild Shaped", beastHp: "Beast HP", ownHp: "own HP", savingThrows: "Saving throws", skills: "Skills", slots: "Slots", spendSlot: "Spend a slot", hitDice: "Hit dice", spendHitDie: "Spend a hit die", spendUse: "Spend a use", equipment: "Equipment", attuned: "attuned", attune: "attune", features: "Features & Traits", story: "(story)", feats: "Feats", backstory: "Backstory", notes: "Notes (only you see these)", downloadTitle: "Download this character sheet as a fillable PDF", preparing: "Preparing...", download: "Download PDF", adjustTitle: "Adjust this character's stats, items, and spells", adjust: "Adjust",
      editBackstory: "Edit backstory",
      noBackstory: "No backstory written yet.",
    },
    ru: {
      baseSpeed: "Базовая",
      walkingSpeed: "Базовая скорость передвижения.",
      reducedByGear: "снижена снаряжением",
      andCarry: " и грузом",
      initiative: "Иниц.",
      passivePerception: "Пасс. Вним.",
      proficiencyBonus: "БМ",
      gold: "зм",
      level: "Уровень",
      xpHitDice: "Опыт · Кости хитов", wildShape: "Дикая форма", beastHp: "Хиты зверя", ownHp: "собственные хиты", savingThrows: "Спасброски", skills: "Навыки", slots: "Ячейки", spendSlot: "Потратить ячейку", hitDice: "Кости хитов", spendHitDie: "Потратить кость хитов", spendUse: "Потратить применение", equipment: "Снаряжение", attuned: "настроен", attune: "настроить", features: "Умения и свойства", story: "(сюжет)", feats: "Черты", backstory: "Предыстория", notes: "Заметки (видны только вам)", downloadTitle: "Скачать этот лист персонажа как заполняемый PDF", preparing: "Подготовка...", download: "Скачать PDF", adjustTitle: "Редактировать характеристики, предметы и заклинания персонажа", adjust: "Редактировать",
      editBackstory: "Изменить предысторию",
      noBackstory: "Предыстория ещё не написана.",
    },
  });
  const speed = speedFor(sheet, { encumbrance: encumbranceRule });
  const load = encumbranceFor({
    strength: sheet.abilities.str,
    equipment: sheet.equipment,
    coins: sheet.gold,
    size: sizeForRace(sheet.race),
    powerfulBuild: powerfulBuildForRace(sheet.race),
  });
  const anyEquipped = sheet.equipment.some((item) => item.equipped);
  const speedNote =
    speed === sheet.speed
      ? copy.walkingSpeed
      : `${copy.baseSpeed} ${formatSpeed(sheet.speed)}, ${copy.reducedByGear}${encumbranceRule && load.speedPenalty ? copy.andCarry : ""}.`;
  const [busy, setBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  async function handleDownloadPdf() {
    setPdfBusy(true);
    try {
      await downloadCharacterSheetPdf(sheet);
    } finally {
      setPdfBusy(false);
    }
  }

  // Fire-and-forget: the sheet_updated SSE event refreshes the sheet prop,
  // so the new counts render without local reconciliation.
  async function adjustUsage(body: Record<string, unknown>) {
    setBusy(true);
    try {
      await fetch(`/api/campaigns/${sheet.campaignId}/sheet/usage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content
          className={cn(
            ui.dialog,
            "fixed left-1/2 top-1/2 z-50 max-h-[85dvh] w-[min(34rem,92vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto",
          )}
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              {sheet.portrait ? (
                <ImageLightbox
                  src={sheet.portrait.url}
                  alt={sheet.name}
                  caption={sheet.name}
                  className="size-14 rounded-lg border border-stone-700 object-cover"
                />
              ) : (
                <CharacterPortrait
                  fallback={portraitFallback}
                  look={{ race: sheet.race, class: sheet.class, gender: sheet.gender }}
                  alt={sheet.name}
                  size="size-14"
                />
              )}
              <div>
                <Dialog.Title className="font-display text-xl tracking-wide text-amber-50">
                  {sheet.name}
                </Dialog.Title>
                <p className="text-xs text-stone-400">
                    {copy.level} {sheet.level} {localizedRaceName(sheet.race, sheet.race, locale)}{" "}
                  {(sheet.classes?.length ?? 0) > 1
                    ? (sheet.classes ?? [])
                         .map((entry) => `${characterDisplay(entry.id, locale)} ${entry.level}`)
                        .join(" / ")
                     : `${characterDisplay(sheet.class, locale)}${sheet.subclass ? ` (${characterDisplay(sheet.subclass, locale)})` : ""}`}
                   {sheet.background ? ` · ${characterDisplay(sheet.background, locale)}` : ""}
                  {sheet.alignment ? ` · ${sheet.alignment}` : ""}
                </p>
              </div>
            </div>
            <Dialog.Close className="text-stone-500 hover:text-stone-300">
              <X className="size-4" />
            </Dialog.Close>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-stone-300">
            <span className="flex items-center gap-1">
              <GameIcon icon={{ kind: "glyph", key: "rest-hp" }} size="size-5" />
              {sheet.currentHp}
              {sheet.tempHp ? `+${sheet.tempHp}` : ""}/{sheet.maxHp} HP
            </span>
            <span
              className="flex items-center gap-1"
              title={
                sheet.acOverride
                  ? uiText("Set by hand; armor does not change it.")
                  : armor.parts.join(" + ")
              }
            >
              <GameIcon icon={{ kind: "glyph", key: "rest-ac" }} size="size-5" />
              <GameTerm id="armor_class">AC</GameTerm> {sheet.ac}
            </span>
            <span className="flex items-center gap-1" title={speedNote}>
              <GameIcon icon={{ kind: "glyph", key: "rest-speed" }} size="size-5" />
              {t("sheet.speed")} {formatSpeed(speed)}
            </span>
            <span
              className={cn(
                encumbranceRule && load.tier !== "unencumbered" && "text-amber-300",
              )}
              title={
                encumbranceRule
                  ? `${load.note ?? uiText("Not encumbered")}. ${t("sheet.carryingCapacity")} ${formatWeight(load.capacityLb)}.${load.unweighed ? ` ${uiText("Items without recorded weight: {count}", { count: load.unweighed })}` : ""}`
                  : `${t("sheet.carryingCapacity")} ${formatWeight(load.capacityLb)}.${load.unweighed ? ` ${uiText("Items without recorded weight: {count}", { count: load.unweighed })}` : ""}`
              }
            >
              {formatWeight(load.carriedLb)}
              {load.unweighed ? "+" : ""}/{formatWeight(load.capacityLb)}
            </span>
            <span className="flex items-center gap-1" title={explainParts(derived.parts.initiative)}>
              <GameIcon icon={{ kind: "glyph", key: "rest-initiative" }} size="size-5" />
              <GameTerm id="initiative">{copy.initiative}</GameTerm> {formatModifier(derived.initiative)}
            </span>
            <span className="flex items-center gap-1" title={explainParts(derived.parts.passivePerception)}>
              <GameIcon icon={{ kind: "glyph", key: "sense-passive-perception" }} size="size-5" />
              <GameTerm id="passive_perception">{copy.passivePerception}</GameTerm> {derived.passivePerception}
            </span>
            <span className="flex items-center gap-1">
              <GameIcon icon={{ kind: "glyph", key: "rest-proficiency" }} size="size-5" />
              {copy.proficiencyBonus} {formatModifier(derived.proficiencyBonus)}
            </span>
            <span className="flex items-center gap-1">
              <GameIcon icon={{ kind: "glyph", key: "coin-gp" }} size="size-5" />
              {sheet.gold} {copy.gold}
            </span>
            <span className="flex items-center gap-1">
              <GameIcon icon={{ kind: "glyph", key: "rest-xp" }} size="size-5" />
              {sheet.xp} {copy.xpHitDice} {sheet.hitDice.total - sheet.hitDice.spent}/
              {sheet.hitDice.total}
              {sheet.hitDice.die}
            </span>
          </div>

          {sheet.wildShape ? (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-lime-800/60 bg-lime-950/40 px-3 py-2 text-sm text-lime-200">
              <span className="flex items-center gap-1.5 font-medium capitalize">
                <PawPrint className="size-4" /> {copy.wildShape}: {sheet.wildShape.form}
              </span>
              <span className="font-mono text-xs">
                {sheet.wildShape.beastHp}/{sheet.wildShape.beastMaxHp} {uiText("beast HP")}
              </span>
              <span className="font-mono text-xs">{uiText("AC")} {sheet.wildShape.beastAc}</span>
              <span className="w-full text-xs text-lime-400/80">
                {uiText("Damage hits the beast&apos;s hit points first. The {current}/{max} HP above is what {name} returns to when the form breaks.", {
                  current: sheet.currentHp,
                  max: sheet.maxHp,
                  name: sheet.name,
                })}
              </span>
            </div>
          ) : null}

          {sheet.conditions.length ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {sheet.conditions.map((condition) => (
                <span
                  key={condition}
                  className="inline-flex items-center gap-1 rounded-full bg-red-950 py-0.5 pl-1 pr-2 text-xs text-red-300"
                >
                  <GameIcon icon={{ kind: "condition", key: conditionIconKey(condition) }} size="size-5" className="border-red-800/60" />
                  {characterDisplay(condition, locale)}
                  {sheet.conditionMeta?.[condition]?.rounds
                    ? ` (${describeConditionDuration(sheet.conditionMeta[condition].rounds, locale)})`
                    : ""}
                </span>
              ))}
            </div>
          ) : null}

          <div className="mt-4 grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
            {ABILITIES.map((ability) => (
              <div key={ability} className="rounded-lg border border-stone-800 p-2">
                <p className="flex items-center justify-center gap-1 text-xs uppercase font-bold text-amber-300/80">
                  <GameIcon icon={{ kind: "glyph", key: `ability-${ability}` }} size="size-5" />
                  {t(`sheet.abilities.${ability}`)}
                </p>
                <p className="text-lg text-stone-100">{sheet.abilities[ability]}</p>
                <p className="text-xs text-stone-400">
                  {formatModifier(derived.abilityMods[ability])}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <section>
              <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">
                <GameTerm id="saving_throw">{copy.savingThrows}</GameTerm>
              </h3>
              <div className="grid grid-cols-3 gap-x-2 gap-y-1 text-xs text-stone-300">
                {ABILITIES.map((ability) => (
                  <span
                    key={ability}
                    title={explainParts(derived.parts.saves[ability])}
                    className={cn(
                      sheet.proficiencies.saves.includes(ability) && "text-amber-200",
                    )}
                  >
                    {ability.toUpperCase()} {formatModifier(derived.saves[ability])}
                  </span>
                ))}
              </div>
            </section>
            <section>
              <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">
                <GameTerm id="skill">{copy.skills}</GameTerm>
              </h3>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs text-stone-300">
                {SRD_SKILLS.map((skill) => (
                  <span
                    key={skill.id}
                    title={explainParts(derived.parts.skills[skill.id])}
                    className={cn(
                      sheet.proficiencies.skills.includes(skill.id) && "text-amber-200",
                    )}
                  >
                    {skill.name} {formatModifier(derived.skills[skill.id])}
                  </span>
                ))}
              </div>
            </section>
          </div>

          {sheet.spellcasting ? (
            <section className="mt-4">
              <h3
                className="mb-1.5 text-xs font-medium uppercase tracking-wide text-stone-500"
                title={
                  derived.parts.spellSaveDc.length
                    ? `${uiText("Spell save difficulty")}: ${explainParts(derived.parts.spellSaveDc)}. ${uiText("Attack bonus")}: ${explainParts(derived.parts.spellAttack)}`
                    : undefined
                }
              >
                {uiText("Spellcasting (")}{sheet.spellcasting.ability.toUpperCase()}
                {derived.spellSaveDc ? ` · ${uiText("DC")} ${derived.spellSaveDc}` : ""}
                {derived.spellAttack !== null
                  ? ` · ${formatModifier(derived.spellAttack)} ${uiText("to hit")}`
                  : ""}
                )
              </h3>
              {Object.keys(sheet.spellcasting.slots).length || sheet.spellcasting.pact ? (
                <div className="space-y-1.5 text-xs text-stone-300">
                  <p className="flex items-center gap-1 text-stone-400">
                    <GameIcon icon={{ kind: "glyph", key: "rest-spell-slot" }} size="size-5" />
                    <GameTerm id="spell_slot">{copy.slots}</GameTerm>
                    <span className="text-stone-500">: {uiText("the magic left today")}</span>
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(sheet.spellcasting.slots).map(([slotLevel, slot]) => (
                      <SlotRow
                        key={slotLevel}
                        label={uiText("Slot level {level}", { level: ROMAN[Number(slotLevel)] ?? slotLevel })}
                        left={slot.max - slot.used}
                        max={slot.max}
                        editable={mine}
                        busy={busy}
                        inCombat={inCombat}
                        onSpend={() => adjustUsage({ slots: { [slotLevel]: slot.used + 1 } })}
                        onRecover={() => adjustUsage({ slots: { [slotLevel]: slot.used - 1 } })}
                      />
                    ))}
                    {sheet.spellcasting.pact ? (
                      <SlotRow
                        label={uiText("Pact, level {level}", {
                          level: ROMAN[sheet.spellcasting.pact.level] ?? sheet.spellcasting.pact.level,
                        })}
                        left={sheet.spellcasting.pact.max - sheet.spellcasting.pact.used}
                        max={sheet.spellcasting.pact.max}
                        editable={false}
                        busy={busy}
                        inCombat={inCombat}
                      />
                    ) : null}
                  </div>
                  <p className="text-[11px] leading-snug text-stone-500">
                    {uiText("Casting a spell of level I or higher uses up one slot of that level (or a higher one, to cast it stronger); cantrips never use one. Filled marks are slots still available, empty ones are spent. They all come back after a long rest.")}
                    {sheet.class === "warlock" || sheet.spellcasting.pact
                      ? ` ${uiText("A warlock's pact slots come back after a short rest too.")}`
                      : ""}
                    {mine ? ` ${uiText("The DM marks them as you cast; the buttons are only for fixing the count.")}` : ""}
                  </p>
                </div>
              ) : null}
              <div className="mt-3">
                <SheetSpells sheet={sheet} editable={mine} />
              </div>
            </section>
          ) : null}

          {mine || Object.keys(sheet.resources).length ? (
            <section className="mt-4">
              <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">
                {uiText("Hit Dice &amp; Resources")}
              </h3>
              <div className="space-y-1.5 text-xs text-stone-300">
                <div className="flex items-center gap-2">
                  <span className="w-36 shrink-0 text-stone-400">
                    <GameTerm id="hit_dice">{copy.hitDice}</GameTerm> ({sheet.hitDice.die})
                  </span>
                  {mine ? (
                    <button
                      type="button"
                      className={stepButton}
                      disabled={busy || sheet.hitDice.spent >= sheet.hitDice.total}
                      title={copy.spendHitDie}
                      onClick={() => adjustUsage({ hitDiceSpent: sheet.hitDice.spent + 1 })}
                    >
                      <Minus className="size-3" />
                    </button>
                  ) : null}
                  <span>
                    {sheet.hitDice.total - sheet.hitDice.spent}/{sheet.hitDice.total}
                  </span>
                  {mine ? (
                    <button
                      type="button"
                      className={stepButton}
                      disabled={busy || inCombat || sheet.hitDice.spent <= 0}
                      title={
                        inCombat ? uiText("Hit dice recover at rests, not mid-combat") : uiText("Recover a hit die")
                      }
                      onClick={() => adjustUsage({ hitDiceSpent: sheet.hitDice.spent - 1 })}
                    >
                      <Plus className="size-3" />
                    </button>
                  ) : null}
                </div>
                {Object.entries(sheet.resources).map(([id, pool]) => (
                  <div key={id} className="flex items-center gap-2">
                    <span className="flex w-36 shrink-0 items-center gap-1 text-stone-400">
                      {RESOURCE_NAMES.get(id) ?? titleCase(id)}
                      <InfoButton
                        label={RESOURCE_NAMES.get(id) ?? titleCase(id)}
                        text={RESOURCE_HELP.get(id)}
                      />
                    </span>
                    {mine ? (
                      <button
                        type="button"
                        className={stepButton}
                        disabled={busy || pool.used >= pool.max}
                        title={copy.spendUse}
                        onClick={() => adjustUsage({ resources: { [id]: pool.used + 1 } })}
                      >
                        <Minus className="size-3" />
                      </button>
                    ) : null}
                    <span>
                      {pool.max - pool.used}/{pool.max}
                    </span>
                    {mine ? (
                      <button
                        type="button"
                        className={stepButton}
                        disabled={busy || inCombat || pool.used <= 0}
                        title={
                          inCombat ? uiText("Uses recover at rests, not mid-combat") : uiText("Recover a use")
                        }
                        onClick={() => adjustUsage({ resources: { [id]: pool.used - 1 } })}
                      >
                        <Plus className="size-3" />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
              {mine ? (
                <p className="mt-1.5 text-[11px] text-stone-500">
                  {uiText("Minus spends, plus recovers.")}
                  {inCombat ? ` ${uiText("Recovery is locked during combat; rests refill automatically.")}` : ""}{" "}
                  {uiText("Changes are logged to the session event log.")}
                </p>
              ) : null}
            </section>
          ) : null}

          {sheet.equipment.length ? (
            <section className="mt-4">
              <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">
                {uiText("Equipment")}
              </h3>
              <InfoChipList
                items={sheet.equipment.map((item) => ({
                  icon: { kind: "item" as const, key: item.name, family: "item-gear" },
                  name: item.qty > 1 ? `${item.name} x${item.qty}` : item.name,
                  reference: { kind: "items", slug: contentSlug(item.name), name: item.name },
                }))}
              />
              {mine && wearable.length ? (
                <div className="mt-2 space-y-1">
                  <p className="text-[11px] text-stone-500">
                    {uiText("Worn gear sets your AC (")}{sheet.acOverride ? uiText("typed by hand; armor no longer changes it") : armor.parts.join(" + ")}
                    {uiText("). Attuned")} {attunedCount}/{ATTUNEMENT_SLOTS}.
                  </p>
                  {magic.sources.length ? (
                    <p className="text-[11px] text-sky-400/80">
                      {uiText("Active magic:")}{" "}
                      {[
                        magic.acBonus ? `+${magic.acBonus} ${uiText("AC")}` : null,
                        magic.saveBonus ? `+${magic.saveBonus} ${uiText("saves")}` : null,
                        ...Object.entries(magic.abilitySet).map(
                          ([ability, score]) => `${ability.toUpperCase()} ${score}`,
                        ),
                        magic.resistances.length ? `${uiText("resist")} ${magic.resistances.join(", ")}` : null,
                      ]
                        .filter(Boolean)
                        .join(" \u00b7 ") || uiText("worn")}
                    </p>
                  ) : null}
                  {wearable.map((item) => {
                    const isArmor = matchArmor(item.name) !== null;
                    const worn = item.equipped ?? !anyEquipped;
                    return (
                      <div key={item.name} className="flex items-center gap-2 text-xs text-stone-300">
                        <GameIcon icon={{ kind: "item", key: item.name, family: "item-gear" }} size="size-5" />
                        <span className="grow truncate">{item.name}</span>
                        {isArmor ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              adjustUsage({ gear: { [item.name]: { equipped: !worn } } })
                            }
                            className={cn(
                              "rounded border px-1.5 py-0.5",
                              worn
                                ? "border-amber-700/70 bg-amber-950/40 text-amber-200"
                                : "border-stone-700 text-stone-400",
                            )}
                          >
                            {worn ? uiText("worn") : uiText("wear")}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={busy || (!item.attuned && attunedCount >= ATTUNEMENT_SLOTS)}
                          onClick={() =>
                            adjustUsage({ gear: { [item.name]: { attuned: !item.attuned } } })
                          }
                          className={cn(
                            "rounded border px-1.5 py-0.5 disabled:opacity-40",
                            item.attuned
                              ? "border-sky-800/70 bg-sky-950/40 text-sky-200"
                              : "border-stone-700 text-stone-400",
                          )}
                        >
                          {item.attuned ? copy.attuned : copy.attune}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </section>
          ) : null}

          {sheet.features.length ? (
            <section className="mt-4">
              <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">
                {copy.features}
              </h3>
              <InfoChipList
                items={sheet.features.map((feature) => ({
                  name: feature.source === "race"
                    ? localizedRaceTraitName(feature.name, locale)
                    : localizedFeatureName(sheet.class, sheet.subclass, feature.name, locale) === feature.name
                      ? characterDisplay(feature.name, locale)
                      : localizedFeatureName(sheet.class, sheet.subclass, feature.name, locale),
                  icon: {
                    kind: "feature" as const,
                    key: feature.name,
                    family: feature.source === "race" ? null : `class-${sheet.class.toLowerCase()}`,
                  },
                  note: feature.source === "story" ? copy.story : undefined,
                  meta: feature.level ? `${copy.level} ${feature.level}` : undefined,
                  text: feature.source === "race"
                    ? describeRaceTrait(sheet.race, feature.name, locale)
                    : describeFeature(sheet.class, sheet.subclass, feature.name, locale),
                }))}
              />
            </section>
          ) : null}

          {sheet.feats.length ? (
            <section className="mt-4">
              <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">
                {uiText("Feats")}
              </h3>
              <InfoChipList
                items={sheet.feats.map((feat) => ({
                  name: localizedContentName("feats", feat, locale),
                  icon: { kind: "feat" as const, key: feat },
                  text: describeFeature(sheet.class, sheet.subclass, feat, locale),
                  reference: { kind: "feats", slug: contentSlug(feat), name: feat },
                }))}
              />
            </section>
          ) : null}

          {sheet.backstory || mine ? (
            <section className="mt-4">
              <div className="mb-1.5 flex items-center justify-between">
                <h3 className="text-xs font-medium uppercase tracking-wide text-stone-500">
                  {copy.backstory}
                </h3>
                {mine && onEditBackstory ? (
                  <button
                    type="button"
                    onClick={onEditBackstory}
                    className="flex items-center gap-1 text-[11px] text-amber-300/80 hover:text-amber-200"
                  >
                    <Pencil className="size-3" /> {copy.editBackstory}
                  </button>
                ) : null}
              </div>
              {sheet.backstory ? (
                <p className="whitespace-pre-wrap text-xs text-stone-300">{sheet.backstory}</p>
              ) : (
                <p className="text-xs italic text-stone-600">{copy.noBackstory}</p>
              )}
            </section>
          ) : null}

          {mine && sheet.notes ? (
            <section className="mt-4">
              <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">
                {copy.notes}
              </h3>
              <p className="whitespace-pre-wrap text-xs text-stone-300">{sheet.notes}</p>
            </section>
          ) : null}

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={pdfBusy}
              className={ui.btnSmall}
              title={copy.downloadTitle}
            >
              <FileDown className="size-3.5" /> {pdfBusy ? copy.preparing : copy.download}
            </button>
            {steersStory && onAdjust ? (
              <button
                type="button"
                onClick={onAdjust}
                className={ui.btnSmall}
                title={copy.adjustTitle}
              >
                <Wrench className="size-3.5" /> {copy.adjust}
              </button>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
