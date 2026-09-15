"use client";

import { Loader2, Pin, Save, Scale } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { Tooltip } from "@/components/ui/Tooltip";
import type { GameSettings } from "@/lib/schemas/game-settings";

type RuleChunkView = {
  id: string;
  heading: string;
  text: string;
  enabled: boolean;
  pinned: boolean;
};

export const VARIANT_TOGGLES: Array<{
  key: Exclude<keyof GameSettings["variantRules"], "restVariant"> & string;
  label: string;
  tip: string;
}> = [
  {
    key: "flanking",
    label: "Flanking",
    tip: "Two allies on opposite sides of a creature give each other advantage on melee attacks against it.",
  },
  {
    key: "criticalFumbles",
    label: "Critical fumbles",
    tip: "A natural 1 on an attack roll causes a minor narrated mishap.",
  },
  {
    key: "encumbrance",
    label: "Encumbrance",
    tip: "Carrying more than 5 times Strength in pounds slows a character by 10 feet.",
  },
  {
    key: "lingeringInjuries",
    label: "Lingering injuries",
    tip: "A critical hit or dropping to 0 HP can leave a lasting injury the DM tracks.",
  },
  {
    key: "powerfulCritical",
    label: "Powerful critical",
    tip: "On a critical hit the extra weapon dice are dealt as their maximum instead of being rolled.",
  },
  {
    key: "criticalDamageMods",
    label: "Crit damage mods",
    tip: "On a critical hit the flat damage modifiers double along with the dice.",
  },
  {
    key: "ammunition",
    label: "Ammunition",
    tip: "Arrows, bolts and bullets are spent when they are fired and half are recovered after the fight.",
  },
];

export const REST_LABELS: Record<GameSettings["variantRules"]["restVariant"], string> = {
  standard: "Standard rests (1h short, 8h long)",
  gritty: "Gritty realism (8h short, 7-day long)",
  heroic: "Heroic (5min short, 1h long)",
};

const COPY = {
  en: {
    variantRules: "Variant rules",
    toggles: {
      flanking: { label: "Flanking", tip: "Two allies on opposite sides of a creature give each other advantage on melee attacks against it." },
      criticalFumbles: { label: "Critical fumbles", tip: "A natural 1 on an attack roll causes a minor narrated mishap." },
      encumbrance: { label: "Encumbrance", tip: "Carrying more than 5 times Strength in pounds slows a character by 10 feet." },
      lingeringInjuries: { label: "Lingering injuries", tip: "A critical hit or dropping to 0 HP can leave a lasting injury the DM tracks." },
      powerfulCritical: { label: "Powerful critical", tip: "On a critical hit the extra weapon dice are dealt as their maximum instead of being rolled." },
      criticalDamageMods: { label: "Crit damage mods", tip: "On a critical hit the flat damage modifiers double along with the dice." },
      ammunition: { label: "Ammunition", tip: "Arrows, bolts and bullets are spent when they are fired and half are recovered after the fight." },
    },
    rests: {
      standard: "Standard rests (1h short, 8h long)",
      gritty: "Gritty realism (8h short, 7-day long)",
      heroic: "Heroic (5min short, 1h long)",
    },
    restsTip: "How long short and long rests take at this table. The DM's rest tool follows it.",
    on: "on",
    off: "off",
    noVariant: "No variant rules in effect.",
    houseRules: "House rules",
    loading: "Loading...",
    housePlaceholder:
      "Write your table's house rules. Use headings to group them, e.g.\n\nDrinking potions:\nDrinking a potion is a bonus action at this table.\n\nThe DM retrieves only the relevant rules each turn.",
    saveRules: "Save rules",
    unsaved: "Unsaved changes",
    noHouseRules: "No house rules set.",
    ruleSections: "Rule sections",
    sectionsHelp:
      "The DM sees only the sections relevant to each turn. Pin one to include it every turn; switch one off to silence it without deleting the text.",
    switchOff: "Switch this section off",
    switchOn: "Switch this section on",
    unpin: "Unpin: retrieved only when relevant",
    pin: "Pin: included in every DM turn",
  },
  ru: {
    variantRules: "Вариантные правила",
    toggles: {
      flanking: { label: "Флангирование", tip: "Два союзника по разные стороны существа дают друг другу преимущество на атаки ближнего боя по нему." },
      criticalFumbles: { label: "Критические промахи", tip: "Натуральная 1 на броске атаки вызывает небольшую описательную неудачу." },
      encumbrance: { label: "Перегрузка", tip: "Если вес переносимого снаряжения превышает Силу × 5 в фунтах, скорость персонажа уменьшается на 10 футов." },
      lingeringInjuries: { label: "Долгие травмы", tip: "Критический удар или падение до 0 HP может оставить длительную травму, которую отслеживает Мастер." },
      powerfulCritical: { label: "Мощный крит", tip: "При критическом попадании дополнительные кости оружия дают максимальное значение вместо броска." },
      criticalDamageMods: { label: "Модификаторы крита", tip: "При критическом попадании постоянные модификаторы урона удваиваются вместе с костями." },
      ammunition: { label: "Боеприпасы", tip: "Стрелы, болты и пули расходуются при выстреле; половина использованных боеприпасов восстанавливается после боя." },
    },
    rests: {
      standard: "Стандартный отдых (короткий 1 ч., долгий 8 ч.)",
      gritty: "Суровый реализм (короткий 8 ч., долгий 7 дней)",
      heroic: "Героический (короткий 5 мин., долгий 1 ч.)",
    },
    restsTip: "Определяет длительность короткого и долгого отдыха. Инструмент отдыха Мастера следует этому правилу.",
    on: "вкл.",
    off: "выкл.",
    noVariant: "Вариантные правила не включены.",
    houseRules: "Домашние правила",
    loading: "Загрузка...",
    housePlaceholder:
      "Запишите домашние правила вашего стола и сгруппируйте их заголовками, например:\n\nЗелья:\nВыпить зелье можно бонусным действием.\n\nКаждый ход Мастер получает только подходящие к ситуации правила.",
    saveRules: "Сохранить правила",
    unsaved: "Есть несохранённые изменения",
    noHouseRules: "Домашние правила не заданы.",
    ruleSections: "Разделы правил",
    sectionsHelp:
      "Мастер видит только разделы, относящиеся к текущему ходу. Закрепите раздел, чтобы отправлять его каждый ход, или выключите, чтобы временно скрыть без удаления текста.",
    switchOff: "Выключить этот раздел",
    switchOn: "Включить этот раздел",
    unpin: "Открепить: показывать только когда раздел уместен",
    pin: "Закрепить: включать в каждый ход Мастера",
  },
  pl: {
    variantRules: "Zasady wariantowe",
    toggles: {
      flanking: { label: "Oskrzydlanie", tip: "Dwaj sojusznicy po przeciwnych stronach stworzenia dają sobie przewagę w atakach wręcz przeciw niemu." },
      criticalFumbles: { label: "Krytyczne pudła", tip: "Naturalna 1 w rzucie ataku powoduje drobną opisaną w narracji wpadkę." },
      encumbrance: { label: "Obciążenie", tip: "Noszenie więcej niż 5 × Siła funtów zmniejsza szybkość postaci o 10 stóp." },
      lingeringInjuries: { label: "Trwałe obrażenia", tip: "Trafienie krytyczne lub spadek do 0 PW może pozostawić trwały uraz śledzony przez Mistrza Gry." },
      powerfulCritical: { label: "Potężny krytyk", tip: "Przy trafieniu krytycznym dodatkowe kości broni zadają maksymalną wartość zamiast być rzucane." },
      criticalDamageMods: { label: "Modyfikatory krytyka", tip: "Przy trafieniu krytycznym stałe modyfikatory obrażeń podwajają się razem z kośćmi." },
      ammunition: { label: "Amunicja", tip: "Strzały, bełty i pociski zużywają się przy strzale, a połowę można odzyskać po walce." },
    },
    rests: {
      standard: "Standardowy odpoczynek (krótki 1 godz., długi 8 godz.)",
      gritty: "Surowy realizm (krótki 8 godz., długi 7 dni)",
      heroic: "Heroiczny (krótki 5 min, długi 1 godz.)",
    },
    restsTip: "Określa długość krótkiego i długiego odpoczynku. Narzędzie odpoczynku Mistrza Gry stosuje to ustawienie.",
    on: "wł.",
    off: "wył.",
    noVariant: "Brak aktywnych zasad wariantowych.",
    houseRules: "Zasady domowe",
    loading: "Ładowanie...",
    housePlaceholder:
      "Zapisz zasady domowe waszego stołu i pogrupuj je nagłówkami, np.\n\nMikstury:\nWypicie mikstury jest akcją dodatkową.\n\nMistrz Gry pobiera w każdej turze tylko zasady pasujące do sytuacji.",
    saveRules: "Zapisz zasady",
    unsaved: "Niezapisane zmiany",
    noHouseRules: "Nie ustawiono zasad domowych.",
    ruleSections: "Sekcje zasad",
    sectionsHelp:
      "Mistrz Gry widzi tylko sekcje pasujące do danej tury. Przypnij sekcję, aby była dołączana zawsze, albo wyłącz ją, aby ją uciszyć bez usuwania tekstu.",
    switchOff: "Wyłącz tę sekcję",
    switchOn: "Włącz tę sekcję",
    unpin: "Odepnij: pobieraj tylko wtedy, gdy jest istotna",
    pin: "Przypnij: dołączaj do każdej tury Mistrza Gry",
  },
} as const;

// The variant-rule controls on their own, so the campaign-creation dialog can
// offer the same choices this panel does without the lead having to open the
// lobby afterwards to find them.
export function VariantRulesFields({
  value,
  onChange,
}: {
  value: GameSettings["variantRules"];
  onChange: (next: GameSettings["variantRules"]) => void;
}) {
  const { locale } = useI18n();
  const copy = COPY[locale];
  return (
    <div>
      <span className="mb-1.5 block text-stone-400">{copy.variantRules}</span>
      <div className="flex flex-wrap gap-1.5">
        {VARIANT_TOGGLES.map((toggle) => {
          const localized = copy.toggles[toggle.key];
          return (
            <Tooltip key={toggle.key} content={localized.tip}>
              <button
                type="button"
                onClick={() => onChange({ ...value, [toggle.key]: !value[toggle.key] })}
                className={cn(
                  "rounded-md border px-2 py-1 text-xs transition-colors",
                  value[toggle.key]
                    ? "border-amber-200/40 bg-amber-200/10 text-amber-100"
                    : "border-stone-800 text-stone-400 hover:border-stone-600",
                )}
              >
                {localized.label}
              </button>
            </Tooltip>
          );
        })}
      </div>
      <select
        value={value.restVariant}
        onChange={(event) =>
          onChange({
            ...value,
            restVariant: event.target.value as GameSettings["variantRules"]["restVariant"],
          })
        }
        className="mt-2 w-full rounded-lg border border-stone-800 bg-stone-950/60 px-2 py-1.5 text-xs text-stone-300"
      >
        {(Object.keys(copy.rests) as Array<GameSettings["variantRules"]["restVariant"]>).map(
          (variant) => (
            <option key={variant} value={variant}>
              {copy.rests[variant]}
            </option>
          ),
        )}
      </select>
    </div>
  );
}

// Rules manager: 5e variant toggles plus lead-authored house rules. The
// house-rules text is chunked server-side; each chunk can be silenced or
// pinned into every DM prompt, and the rest are retrieved per turn by
// relevance.
export function RulesPanel({
  campaignId,
  settings,
  steersStory,
}: {
  campaignId: string;
  settings: GameSettings;
  steersStory: boolean;
}) {
  const { locale } = useI18n();
  const copy = COPY[locale];
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [savedText, setSavedText] = useState("");
  const [chunks, setChunks] = useState<RuleChunkView[]>([]);
  const [saving, setSaving] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/campaigns/${campaignId}/rules`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data) {
          setText(String(data.text ?? ""));
          setSavedText(String(data.text ?? ""));
          setChunks(Array.isArray(data.chunks) ? data.chunks : []);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  async function saveText() {
    setSaving(true);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/rules`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (response.ok) {
        const data = await response.json();
        setSavedText(String(data.text ?? text));
        setChunks(Array.isArray(data.chunks) ? data.chunks : []);
      }
    } finally {
      setSaving(false);
    }
  }

  async function patchChunk(chunkId: string, flags: { enabled?: boolean; pinned?: boolean }) {
    const response = await fetch(`/api/campaigns/${campaignId}/rules`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chunkId, ...flags }),
    });
    if (response.ok) {
      const data = await response.json();
      setChunks((current) =>
        current.map((chunk) => (chunk.id === chunkId ? { ...chunk, ...data.chunk } : chunk)),
      );
    }
  }

  async function patchVariant(update: Partial<GameSettings["variantRules"]>) {
    setSettingsBusy(true);
    try {
      await fetch(`/api/campaigns/${campaignId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variantRules: { ...settings.variantRules, ...update } }),
      });
    } finally {
      setSettingsBusy(false);
    }
  }

  const variant = settings.variantRules;

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-stone-800 bg-stone-950/40 p-2.5" data-tour="rules-variants">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-stone-300">
          <Scale className="size-3.5 text-amber-600" /> {copy.variantRules}
        </p>
        {steersStory ? (
          <div className={cn("flex flex-wrap items-center gap-1.5", settingsBusy && "opacity-70")}>
            {VARIANT_TOGGLES.map((toggle) => {
              const localized = copy.toggles[toggle.key];
              return (
                <Tooltip key={toggle.key} content={localized.tip}>
                  <button
                    type="button"
                    onClick={() => patchVariant({ [toggle.key]: !variant[toggle.key] })}
                    className={cn(
                      "rounded-md border px-2 py-1 text-[11px]",
                      variant[toggle.key]
                        ? "border-amber-700 bg-amber-950/50 text-amber-200"
                        : "border-stone-700 text-stone-400",
                    )}
                  >
                    {localized.label} {variant[toggle.key] ? copy.on : copy.off}
                  </button>
                </Tooltip>
              );
            })}
            <Tooltip content={copy.restsTip}>
              <select
                value={variant.restVariant}
                onChange={(event) =>
                  patchVariant({
                    restVariant: event.target.value as GameSettings["variantRules"]["restVariant"],
                  })
                }
                className="rounded-md border border-stone-700 bg-stone-900 px-2 py-1 text-[11px] outline-none focus:border-amber-600"
              >
                {(Object.keys(copy.rests) as Array<keyof typeof copy.rests>).map((value) => (
                  <option key={value} value={value}>
                    {copy.rests[value]}
                  </option>
                ))}
              </select>
            </Tooltip>
          </div>
        ) : (
          <p className="text-[11px] leading-4 text-stone-400">
            {[
              ...VARIANT_TOGGLES.filter((toggle) => variant[toggle.key]).map(
                (toggle) => copy.toggles[toggle.key].label,
              ),
              ...(variant.restVariant !== "standard" ? [copy.rests[variant.restVariant]] : []),
            ].join(" · ") || copy.noVariant}
          </p>
        )}
      </div>

      <div className="rounded-lg border border-stone-800 bg-stone-950/40 p-2.5" data-tour="rules-house">
        <p className="mb-2 text-xs font-medium text-stone-300">{copy.houseRules}</p>
        {loading ? (
          <p className="flex items-center gap-1 text-[11px] text-stone-500">
            <Loader2 className="size-3 animate-spin" /> {copy.loading}
          </p>
        ) : steersStory ? (
          <>
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={8}
              maxLength={20_000}
              placeholder={copy.housePlaceholder}
              className="w-full rounded border border-stone-700 bg-stone-900 px-2 py-1.5 text-[11px] leading-4 outline-none focus:border-amber-600"
            />
            <div className="mt-1.5 flex items-center gap-2">
              <button
                type="button"
                onClick={saveText}
                disabled={saving || text === savedText}
                className="flex items-center gap-1 rounded border border-stone-700 px-2 py-0.5 text-[11px] text-stone-300 hover:bg-stone-900 disabled:opacity-50"
              >
                {saving ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
                {copy.saveRules}
              </button>
              {text !== savedText ? (
                <span className="text-[11px] text-amber-300/80">{copy.unsaved}</span>
              ) : null}
            </div>
          </>
        ) : savedText ? (
          <p className="whitespace-pre-wrap text-[11px] leading-4 text-stone-400">{savedText}</p>
        ) : (
          <p className="text-[11px] italic text-stone-600">{copy.noHouseRules}</p>
        )}
      </div>

      {steersStory && chunks.length ? (
        <div className="rounded-lg border border-stone-800 bg-stone-950/40 p-2.5">
          <p className="mb-1 text-xs font-medium text-stone-300">{copy.ruleSections}</p>
          <p className="mb-2 text-[11px] leading-4 text-stone-500">{copy.sectionsHelp}</p>
          <ul className="space-y-1.5">
            {chunks.map((chunk) => (
              <li
                key={chunk.id}
                className="flex items-start gap-2 rounded border border-stone-800/70 bg-stone-950/40 p-1.5"
              >
                <button
                  type="button"
                  onClick={() => patchChunk(chunk.id, { enabled: !chunk.enabled })}
                  title={chunk.enabled ? copy.switchOff : copy.switchOn}
                  className={cn(
                    "mt-0.5 shrink-0 rounded border px-1.5 py-0.5 text-[10px]",
                    chunk.enabled
                      ? "border-amber-700 bg-amber-950/50 text-amber-200"
                      : "border-stone-700 text-stone-500",
                  )}
                >
                  {chunk.enabled ? copy.on : copy.off}
                </button>
                <button
                  type="button"
                  onClick={() => patchChunk(chunk.id, { pinned: !chunk.pinned })}
                  title={chunk.pinned ? copy.unpin : copy.pin}
                  className={cn(
                    "mt-0.5 shrink-0 rounded border px-1 py-0.5",
                    chunk.pinned
                      ? "border-amber-700 bg-amber-950/50 text-amber-200"
                      : "border-stone-700 text-stone-500",
                  )}
                >
                  <Pin className="size-3" />
                </button>
                <span className="min-w-0 text-[11px] leading-4 text-stone-400">
                  {chunk.heading ? (
                    <span className="font-medium text-stone-300">{chunk.heading}: </span>
                  ) : null}
                  {chunk.text.length > 160 ? `${chunk.text.slice(0, 160)}...` : chunk.text}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
