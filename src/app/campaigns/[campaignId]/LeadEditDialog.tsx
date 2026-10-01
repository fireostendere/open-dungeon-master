"use client";

import { useInlineText } from "@/lib/i18n/inline-text";
import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, Trash2, X } from "lucide-react";
import { GameIcon } from "@/components/ui/GameIcon";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { spellClassFor } from "@/lib/classes";
import { spellSlotsFor } from "@/lib/srd";
import MultiContentPicker from "@/app/characters/builder/MultiContentPicker";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";

// The highest spell level this character has a slot for, so the pickers
// below offer what they could actually cast rather than the whole list up
// to Wish. Cantrips (level 0) always pass.
function highestSlotLevel(classId: string, level: number): number {
  return Object.keys(spellSlotsFor(classId, level)).reduce(
    (top, slotLevel) => Math.max(top, Number(slotLevel)),
    0,
  );
}
import type { CharacterSheet, EquipmentItem } from "@/lib/schemas/sheet";

type ItemRow = { name: string; qty: string; slug?: string };

// Removable name chips backing the spell and feat lists; adding goes
// through the searchable multi-select pickers below each list.
function ChipList({ values, onRemove }: { values: string[]; onRemove: (value: string) => void }) {
  const uiText = useInlineText();
  if (!values.length) {
    return null;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((value) => (
        <span
          key={value}
          className="flex items-center gap-1 rounded-full bg-stone-800 px-2 py-0.5 text-xs text-stone-200"
        >
          {value}
          <button
            type="button"
            onClick={() => onRemove(value)}
            aria-label={uiText("Remove {value}", { value })}
            className="text-stone-500 hover:text-red-400"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
    </div>
  );
}

// Party lead correction of any character's numbers, items, and spells, for
// when the AI DM gets something wrong. Server clamps values and writes an
// audit entry.
export function LeadEditDialog({
  campaignId,
  sheet,
  onClose,
}: {
  campaignId: string;
  sheet: CharacterSheet;
  onClose: () => void;
}) {
  const uiText = useInlineText();
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: {
      adjust: "Adjust {name}",
      subtitle: "Correction of stats, items, and spells. Changes are logged to the session event log.",
      hp: "HP",
      tempHp: "Temp HP",
      maxHp: "Max HP",
      ac: "AC",
      gold: "Gold",
      xp: "XP",
      abilities: "Abilities",
      conditions: "Conditions (comma separated)",
      items: "Items",
      itemName: "Item name",
      spells: "Spells",
      known: "Known",
      prepared: "Prepared",
      searchKnown: "Search spells to add as known",
      searchPrepared: "Search spells to add as prepared",
      searchItems: "Search items to add",
      searchFeats: "Search feats to add",
      cantrip: "cantrip",
      levelSpell: "level {level}",
      slotUsedMax: "L{level} used/max",
      feats: "Feats",
      reason: "Reason (shown in the log)",
      reasonPlaceholder: "Stat adjustment",
      cancel: "Cancel",
      save: "Save",
      failed: "Could not save the correction.",
      offline: "Could not reach the server.",
    },
    ru: {
      adjust: "Изменить {name}",
      subtitle: "Редактирование характеристик, предметов и заклинаний. Изменения записываются в журнал сессии.",
      hp: "Хиты",
      tempHp: "Врем. хиты",
      maxHp: "Макс. хиты",
      ac: "КД",
      gold: "Золото",
      xp: "Опыт",
      abilities: "Характеристики",
      conditions: "Состояния (через запятую)",
      items: "Снаряжение",
      itemName: "Название предмета",
      spells: "Заклинания",
      known: "Известные",
      prepared: "Подготовленные",
      searchKnown: "Найти заклинания (известные)",
      searchPrepared: "Найти заклинания (подготовленные)",
      searchItems: "Найти предметы для добавления",
      searchFeats: "Найти черты для добавления",
      cantrip: "заговор",
      levelSpell: "{level} круг",
      slotUsedMax: "{level} кр: потрач/макс",
      feats: "Черты",
      reason: "Причина (для журнала)",
      reasonPlaceholder: "Изменение характеристик",
      cancel: "Отмена",
      save: "Сохранить",
      failed: "Не удалось сохранить изменения.",
      offline: "Не удалось связаться с сервером.",
    },
  });

  const [currentHp, setCurrentHp] = useState(String(sheet.currentHp));
  const [tempHp, setTempHp] = useState(String(sheet.tempHp));
  const [maxHp, setMaxHp] = useState(String(sheet.maxHp));
  const [ac, setAc] = useState(String(sheet.ac));
  const [gold, setGold] = useState(String(sheet.gold));
  const [xp, setXp] = useState(String(sheet.xp));
  const [abilities, setAbilities] = useState<Record<string, string>>(() => ({
    str: String(sheet.abilities?.str ?? 10),
    dex: String(sheet.abilities?.dex ?? 10),
    con: String(sheet.abilities?.con ?? 10),
    int: String(sheet.abilities?.int ?? 10),
    wis: String(sheet.abilities?.wis ?? 10),
    cha: String(sheet.abilities?.cha ?? 10),
  }));
  const [conditions, setConditions] = useState(sheet.conditions.join(", "));
  const [items, setItems] = useState<ItemRow[]>(
    sheet.equipment.map((item) => ({ name: item.name, qty: String(item.qty), slug: item.slug })),
  );
  const [prepared, setPrepared] = useState<string[]>(sheet.spellcasting?.prepared ?? []);
  const [known, setKnown] = useState<string[]>(sheet.spellcasting?.known ?? []);
  const [slots, setSlots] = useState<Record<string, { max: string; used: string }>>(() =>
    Object.fromEntries(
      Object.entries(sheet.spellcasting?.slots ?? {}).map(([level, slot]) => [
        level,
        { max: String(slot.max), used: String(slot.used) },
      ]),
    ),
  );
  const [feats, setFeats] = useState<string[]>(sheet.feats);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function setItem(index: number, patch: Partial<ItemRow>) {
    setItems((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function splitList(raw: string): string[] {
    return raw
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  function save() {
    setBusy(true);
    setError("");
    const patch: Record<string, unknown> = { reason };
    const numbers: Array<[string, string, number]> = [
      ["currentHp", currentHp, sheet.currentHp],
      ["tempHp", tempHp, sheet.tempHp],
      ["maxHp", maxHp, sheet.maxHp],
      ["ac", ac, sheet.ac],
      ["gold", gold, sheet.gold],
      ["xp", xp, sheet.xp],
    ];
    for (const [key, raw, previous] of numbers) {
      const value = Number(raw);
      if (Number.isFinite(value) && value !== previous) {
        patch[key] = value;
      }
    }
    const nextAbilities = {
      str: Math.max(1, Math.min(30, Math.round(Number(abilities.str)) || 10)),
      dex: Math.max(1, Math.min(30, Math.round(Number(abilities.dex)) || 10)),
      con: Math.max(1, Math.min(30, Math.round(Number(abilities.con)) || 10)),
      int: Math.max(1, Math.min(30, Math.round(Number(abilities.int)) || 10)),
      wis: Math.max(1, Math.min(30, Math.round(Number(abilities.wis)) || 10)),
      cha: Math.max(1, Math.min(30, Math.round(Number(abilities.cha)) || 10)),
    };
    if (
      !sheet.abilities ||
      nextAbilities.str !== sheet.abilities.str ||
      nextAbilities.dex !== sheet.abilities.dex ||
      nextAbilities.con !== sheet.abilities.con ||
      nextAbilities.int !== sheet.abilities.int ||
      nextAbilities.wis !== sheet.abilities.wis ||
      nextAbilities.cha !== sheet.abilities.cha
    ) {
      patch.abilities = nextAbilities;
    }
    const nextConditions = splitList(conditions);
    if (nextConditions.join("|") !== sheet.conditions.join("|")) {
      patch.conditions = nextConditions;
    }
    const nextEquipment: EquipmentItem[] = items
      .map((row) => ({
        name: row.name.trim(),
        qty: Math.min(999, Math.max(1, Math.round(Number(row.qty)) || 1)),
        ...(row.slug ? { slug: row.slug } : {}),
      }))
      .filter((item) => item.name);
    if (JSON.stringify(nextEquipment) !== JSON.stringify(sheet.equipment)) {
      patch.equipment = nextEquipment;
    }
    if (sheet.spellcasting) {
      const nextSpellcasting = {
        ability: sheet.spellcasting.ability,
        slots: Object.fromEntries(
          Object.entries(sheet.spellcasting.slots).map(([level, slot]) => {
            const edited = slots[level];
            const max = Math.max(0, Math.round(Number(edited?.max)) || slot.max);
            const used = Math.min(max, Math.max(0, Math.round(Number(edited?.used ?? "0")) || 0));
            return [level, { max, used }];
          }),
        ),
        prepared,
        known,
      };
      if (JSON.stringify(nextSpellcasting) !== JSON.stringify(sheet.spellcasting)) {
        patch.spellcasting = nextSpellcasting;
      }
    }
    if (feats.join("|") !== sheet.feats.join("|")) {
      patch.feats = feats;
    }
    void (async () => {
      try {
        const response = await fetch(`/api/campaigns/${campaignId}/sheets/${sheet.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          setError(data.error || copy.failed);
          return;
        }
        onClose();
      } catch {
        setError(copy.offline);
      } finally {
        setBusy(false);
      }
    })();
  }

  const field =
    "w-full rounded-md border border-stone-700 bg-stone-900 px-2 py-1 text-sm outline-none focus:border-amber-600";

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content
          className={cn(
            ui.dialog,
            "fixed left-1/2 top-1/2 z-50 max-h-[85dvh] w-[min(28rem,92vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto",
          )}
        >
          <div className="mb-3 flex items-center justify-between">
            <Dialog.Title className="flex items-center gap-2 font-display text-lg tracking-wide text-amber-50">
              <GameIcon icon={{ kind: "glyph", key: "tab-lead" }} size="size-7" /> {copy.adjust.replace("{name}", sheet.name)}
            </Dialog.Title>
            <Dialog.Close className="text-stone-500 hover:text-stone-300">
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <p className="mb-3 text-xs text-stone-500">
            {copy.subtitle}
          </p>
          <div className="grid grid-cols-3 gap-2 text-xs">
            {(
              [
                [copy.hp, currentHp, setCurrentHp, "rest-hp"],
                [copy.tempHp, tempHp, setTempHp, "rest-temp-hp"],
                [copy.maxHp, maxHp, setMaxHp, "rest-hp"],
                [copy.ac, ac, setAc, "rest-ac"],
                [copy.gold, gold, setGold, "coin-gp"],
                [copy.xp, xp, setXp, "rest-xp"],
              ] as Array<[string, string, (value: string) => void, string]>
            ).map(([label, value, setter, glyph]) => (
              <label key={label} className="space-y-1">
                <span className="flex items-center gap-1 text-stone-500">
                  <GameIcon icon={{ kind: "glyph", key: glyph }} size="size-4" /> {label}
                </span>
                <input
                  type="number"
                  value={value}
                  onChange={(event) => setter(event.target.value)}
                  className={field}
                />
              </label>
            ))}
          </div>

          <div className="mt-2 space-y-1 text-xs">
            <span className="text-stone-500">{copy.abilities}</span>
            <div className="grid grid-cols-6 gap-1.5 text-center">
              {(["str", "dex", "con", "int", "wis", "cha"] as const).map((key) => (
                <label key={key} className="space-y-0.5">
                  <span className="text-[10px] uppercase text-stone-500">{key}</span>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={abilities[key]}
                    onChange={(event) =>
                      setAbilities((prev) => ({ ...prev, [key]: event.target.value }))
                    }
                    className={cn(field, "px-1 text-center")}
                  />
                </label>
              ))}
            </div>
          </div>

          <label className="mt-2 block space-y-1 text-xs">
            <span className="text-stone-500">{copy.conditions}</span>
            <input
              value={conditions}
              onChange={(event) => setConditions(event.target.value)}
              placeholder={uiText("poisoned, prone")}
              className={field}
            />
          </label>

          <div className="mt-3 space-y-1 text-xs">
            <span className="text-stone-500">{copy.items}</span>
            {items.map((row, index) => (
              <div key={index} className="flex items-center gap-2">
                <GameIcon icon={{ kind: "item", key: row.name, family: "item-gear" }} size="size-6" />
                {row.slug ? (
                  <span className={cn(field, "truncate")}>{row.name}</span>
                ) : (
                  <input
                    value={row.name}
                    onChange={(event) => setItem(index, { name: event.target.value })}
                    placeholder={copy.itemName}
                    className={field}
                  />
                )}
                <input
                  type="number"
                  min={1}
                  value={row.qty}
                  onChange={(event) => setItem(index, { qty: event.target.value })}
                  className={cn(field, "w-16 shrink-0")}
                />
                <button
                  type="button"
                  onClick={() => setItems((rows) => rows.filter((_, i) => i !== index))}
                  className="shrink-0 text-stone-500 hover:text-red-400"
                  aria-label={uiText("Remove item")}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
            <div className="mt-1">
              <MultiContentPicker
                kind="items"
                placeholder={copy.searchItems}
                selectedNames={items.map((row) => row.name)}
                onAdd={(entries) =>
                  setItems((rows) => [
                    ...rows,
                    ...entries.map((entry) => ({
                      name: entry.name,
                      qty: "1",
                      ...(entry.slug ? { slug: entry.slug } : {}),
                    })),
                  ])
                }
                renderMeta={(entry) =>
                  [entry.kind, entry.rarity ?? entry.cost].filter(Boolean).join(" · ")
                }
              />
            </div>
          </div>

          {sheet.spellcasting ? (
            <div className="mt-3 space-y-2 text-xs">
              <span className="text-stone-500">{copy.spells}</span>
              <div className="space-y-1">
                <span className="text-stone-600">{copy.known}</span>
                <ChipList
                  values={known}
                  onRemove={(value) => setKnown((list) => list.filter((entry) => entry !== value))}
                />
                <MultiContentPicker
                  kind="spells"
                  extraParams={{
                    class: spellClassFor(sheet.class),
                    level: String(highestSlotLevel(sheet.class, sheet.level)),
                  }}
                  placeholder={copy.searchKnown}
                  selectedNames={known}
                  onAdd={(entries) =>
                    setKnown((list) => [...list, ...entries.map((entry) => entry.name)])
                  }
                  renderMeta={(entry) =>
                    entry.level !== undefined
                      ? entry.level === 0
                        ? copy.cantrip
                        : copy.levelSpell.replace("{level}", String(entry.level))
                      : ""
                  }
                />
              </div>
              <div className="space-y-1">
                <span className="text-stone-600">{copy.prepared}</span>
                <ChipList
                  values={prepared}
                  onRemove={(value) =>
                    setPrepared((list) => list.filter((entry) => entry !== value))
                  }
                />
                <MultiContentPicker
                  kind="spells"
                  extraParams={{
                    class: spellClassFor(sheet.class),
                    level: String(highestSlotLevel(sheet.class, sheet.level)),
                  }}
                  placeholder={copy.searchPrepared}
                  selectedNames={prepared}
                  onAdd={(entries) =>
                    setPrepared((list) => [...list, ...entries.map((entry) => entry.name)])
                  }
                  renderMeta={(entry) =>
                    entry.level !== undefined
                      ? entry.level === 0
                        ? copy.cantrip
                        : copy.levelSpell.replace("{level}", String(entry.level))
                      : ""
                  }
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(sheet.spellcasting.slots).map(([level]) => (
                  <label key={level} className="space-y-1">
                    <span className="text-stone-600">{copy.slotUsedMax.replace("{level}", level)}</span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        value={slots[level]?.used ?? "0"}
                        onChange={(event) =>
                          setSlots((prev) => ({
                            ...prev,
                            [level]: { max: prev[level]?.max ?? "0", used: event.target.value },
                          }))
                        }
                        className={cn(field, "w-14")}
                      />
                      <span className="text-stone-600">/</span>
                      <input
                        type="number"
                        min={0}
                        value={slots[level]?.max ?? "0"}
                        onChange={(event) =>
                          setSlots((prev) => ({
                            ...prev,
                            [level]: { used: prev[level]?.used ?? "0", max: event.target.value },
                          }))
                        }
                        className={cn(field, "w-14")}
                      />
                    </div>
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-3 space-y-1 text-xs">
            <span className="text-stone-500">{copy.feats}</span>
            <ChipList
              values={feats}
              onRemove={(value) => setFeats((list) => list.filter((entry) => entry !== value))}
            />
            <MultiContentPicker
              kind="feats"
              placeholder={copy.searchFeats}
              selectedNames={feats}
              onAdd={(entries) =>
                setFeats((list) => [...list, ...entries.map((entry) => entry.name)])
              }
            />
          </div>
          <label className="mt-2 block space-y-1 text-xs">
            <span className="text-stone-500">{copy.reason}</span>
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={300}
              placeholder={copy.reasonPlaceholder}
              className={field}
            />
          </label>
          {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={onClose} className={ui.btnSmall}>
              {copy.cancel}
            </button>
            <button type="button" onClick={save} disabled={busy} className={ui.btnPrimary}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null} {copy.save}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
