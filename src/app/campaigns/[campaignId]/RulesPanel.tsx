"use client";

import { Loader2, Pin, Save, Scale } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { Tooltip } from "@/components/ui/Tooltip";
import type { GameSettings } from "@/lib/schemas/game-settings";
import { useI18n } from "@/lib/i18n";

type RuleChunkView = {
  id: string;
  heading: string;
  text: string;
  enabled: boolean;
  pinned: boolean;
};

export const VARIANT_TOGGLES: Array<{
  key: keyof GameSettings["variantRules"] & string;
  label: string;
  tip: string;
}> = [
  { key: "flanking", label: "Flanking", tip: "Two allies on opposite sides of a creature give each other advantage on melee attacks against it." },
  { key: "criticalFumbles", label: "Critical fumbles", tip: "A natural 1 on an attack roll causes a minor narrated mishap." },
  { key: "encumbrance", label: "Encumbrance", tip: "Carrying more than 5 times Strength in pounds slows a character by 10 feet." },
  { key: "lingeringInjuries", label: "Lingering injuries", tip: "A critical hit or dropping to 0 HP can leave a lasting injury the DM tracks." },
  { key: "powerfulCritical", label: "Powerful critical", tip: "On a critical hit the extra weapon dice are dealt as their maximum instead of being rolled." },
  { key: "criticalDamageMods", label: "Crit damage mods", tip: "On a critical hit the flat damage modifiers double along with the dice." },
  { key: "ammunition", label: "Ammunition", tip: "Arrows, bolts and bullets are spent when they are fired and half are recovered after the fight." },
];

export const REST_LABELS: Record<GameSettings["variantRules"]["restVariant"], string> = {
  standard: "Standard rests (1h short, 8h long)",
  gritty: "Gritty realism (8h short, 7-day long)",
  heroic: "Heroic (5min short, 1h long)",
};

const COPY = {
  en: {
    variantRules: "Variant rules",
    flanking: "Flanking",
    flankingTip: "Two allies on opposite sides of a creature give each other advantage on melee attacks against it.",
    criticalFumbles: "Critical fumbles",
    criticalFumblesTip: "A natural 1 on an attack roll causes a minor narrated mishap.",
    encumbrance: "Encumbrance",
    encumbranceTip: "Carrying more than 5 times Strength in pounds slows a character by 10 feet.",
    lingeringInjuries: "Lingering injuries",
    lingeringInjuriesTip: "A critical hit or dropping to 0 HP can leave a lasting injury the DM tracks.",
    powerfulCritical: "Powerful critical",
    powerfulCriticalTip: "On a critical hit the extra weapon dice deal their maximum instead of being rolled.",
    criticalDamageMods: "Crit damage mods",
    criticalDamageModsTip: "On a critical hit flat damage modifiers double along with the dice.",
    ammunition: "Ammunition",
    ammunitionTip: "Arrows, bolts and bullets are spent when fired and half are recovered after the fight.",
    restStandard: "Standard rests (1h short, 8h long)",
    restGritty: "Gritty realism (8h short, 7-day long)",
    restHeroic: "Heroic (5min short, 1h long)",
    restTip: "How long short and long rests take at this table. The DM's rest tool follows it.",
    on: "on",
    off: "off",
    noVariant: "No variant rules in effect.",
    houseRules: "House rules",
    loading: "Loading...",
    housePlaceholder:
      "Write your table's house rules. Use headings to group them, e.g.\n\nDrinking potions:\nDrinking a potion is a bonus action at this table.\n\nThe DM retrieves only the relevant rules each turn.",
    saveRules: "Save rules",
    unsaved: "Unsaved changes",
    noHouse: "No house rules set.",
    sections: "Rule sections",
    sectionsHelp:
      "The DM sees only the sections relevant to each turn. Pin one to include it every turn; switch one off to silence it without deleting the text.",
    switchOff: "Switch this section off",
    switchOn: "Switch this section on",
    unpin: "Unpin: retrieve only when relevant",
    pin: "Pin: include in every DM turn",
  },
  ru: {
    variantRules: "Вариантные правила",
    flanking: "Фланкирование",
    flankingTip: "Два союзника по разные стороны существа дают друг другу преимущество на атаки ближнего боя против него.",
    criticalFumbles: "Критические промахи",
    criticalFumblesTip: "Натуральная 1 на броске атаки вызывает небольшую сюжетную неприятность.",
    encumbrance: "Перегрузка",
    encumbranceTip: "Вес больше 5 × Сила в фунтах (≈2,27 × Сила кг) снижает скорость персонажа на 10 ft (≈3 м).",
    lingeringInjuries: "Долгие травмы",
    lingeringInjuriesTip: "Критический удар или падение до 0 HP может оставить длительную травму, которую отслеживает DM.",
    powerfulCritical: "Мощный крит",
    powerfulCriticalTip: "При критическом попадании дополнительные кости оружия наносят максимальное значение вместо броска.",
    criticalDamageMods: "Модификаторы крита",
    criticalDamageModsTip: "При критическом попадании постоянные модификаторы урона удваиваются вместе с костями.",
    ammunition: "Боеприпасы",
    ammunitionTip: "Стрелы, болты и пули расходуются при выстреле; после боя удаётся вернуть половину.",
    restStandard: "Стандартный отдых (короткий 1 ч, долгий 8 ч)",
    restGritty: "Суровый реализм (короткий 8 ч, долгий 7 дней)",
    restHeroic: "Героический (короткий 5 мин, долгий 1 ч)",
    restTip: "Определяет длительность короткого и долгого отдыха за этим столом. Инструмент отдыха DM использует эти значения.",
    on: "вкл.",
    off: "выкл.",
    noVariant: "Вариантные правила не включены.",
    houseRules: "Домашние правила",
    loading: "Загрузка...",
    housePlaceholder:
      "Запишите домашние правила стола и сгруппируйте их заголовками, например:\n\nЗелья:\nВыпить зелье можно бонусным действием.\n\nКаждый ход DM получает только подходящие к ситуации правила.",
    saveRules: "Сохранить правила",
    unsaved: "Есть несохранённые изменения",
    noHouse: "Домашние правила не заданы.",
    sections: "Разделы правил",
    sectionsHelp:
      "DM получает только разделы, относящиеся к текущему ходу. Закрепите раздел, чтобы включать его всегда, или выключите без удаления текста.",
    switchOff: "Выключить этот раздел",
    switchOn: "Включить этот раздел",
    unpin: "Открепить: получать только когда уместно",
    pin: "Закрепить: включать в каждый ход DM",
  },
  pl: {
    variantRules: "Zasady wariantowe",
    flanking: "Flankowanie",
    flankingTip: "Dwóch sojuszników po przeciwnych stronach stworzenia daje sobie przewagę w atakach wręcz przeciw niemu.",
    criticalFumbles: "Krytyczne pudła",
    criticalFumblesTip: "Naturalna 1 w rzucie ataku powoduje niewielką fabularną wpadkę.",
    encumbrance: "Przeciążenie",
    encumbranceTip: "Noszenie więcej niż 5 × Siła w funtach (≈2,27 × Siła kg) zmniejsza szybkość postaci o 10 ft (≈3 m).",
    lingeringInjuries: "Trwałe obrażenia",
    lingeringInjuriesTip: "Trafienie krytyczne lub spadek do 0 PW może pozostawić trwały uraz śledzony przez MG.",
    powerfulCritical: "Potężny krytyk",
    powerfulCriticalTip: "Przy trafieniu krytycznym dodatkowe kości broni zadają maksymalną wartość zamiast rzutu.",
    criticalDamageMods: "Modyfikatory krytyka",
    criticalDamageModsTip: "Przy trafieniu krytycznym stałe modyfikatory obrażeń podwajają się razem z kośćmi.",
    ammunition: "Amunicja",
    ammunitionTip: "Strzały, bełty i pociski zużywają się przy strzale, a po walce odzyskuje się połowę.",
    restStandard: "Standardowy odpoczynek (krótki 1 h, długi 8 h)",
    restGritty: "Surowy realizm (krótki 8 h, długi 7 dni)",
    restHeroic: "Heroiczny (krótki 5 min, długi 1 h)",
    restTip: "Określa długość krótkiego i długiego odpoczynku przy tym stole. Narzędzie odpoczynku MG korzysta z tych wartości.",
    on: "wł.",
    off: "wył.",
    noVariant: "Brak aktywnych zasad wariantowych.",
    houseRules: "Zasady domowe",
    loading: "Ładowanie...",
    housePlaceholder:
      "Zapisz zasady domowe stołu i pogrupuj je nagłówkami, np.\n\nMikstury:\nWypicie mikstury jest akcją dodatkową.\n\nMG pobiera w każdej turze tylko zasady istotne dla sytuacji.",
    saveRules: "Zapisz zasady",
    unsaved: "Niezapisane zmiany",
    noHouse: "Nie ustawiono zasad domowych.",
    sections: "Sekcje zasad",
    sectionsHelp:
      "MG widzi tylko sekcje istotne dla danej tury. Przypnij sekcję, aby dołączać ją zawsze, albo wyłącz ją bez usuwania tekstu.",
    switchOff: "Wyłącz tę sekcję",
    switchOn: "Włącz tę sekcję",
    unpin: "Odepnij: pobieraj tylko gdy istotne",
    pin: "Przypnij: dołączaj do każdej tury MG",
  },
} as const;

function localizedRules(locale: "en" | "ru" | "pl") {
  const copy = COPY[locale];
  const toggles: Record<string, { label: string; tip: string }> = {
    flanking: { label: copy.flanking, tip: copy.flankingTip },
    criticalFumbles: { label: copy.criticalFumbles, tip: copy.criticalFumblesTip },
    encumbrance: { label: copy.encumbrance, tip: copy.encumbranceTip },
    lingeringInjuries: { label: copy.lingeringInjuries, tip: copy.lingeringInjuriesTip },
    powerfulCritical: { label: copy.powerfulCritical, tip: copy.powerfulCriticalTip },
    criticalDamageMods: { label: copy.criticalDamageMods, tip: copy.criticalDamageModsTip },
    ammunition: { label: copy.ammunition, tip: copy.ammunitionTip },
  };
  const rests: Record<GameSettings["variantRules"]["restVariant"], string> = {
    standard: copy.restStandard,
    gritty: copy.restGritty,
    heroic: copy.restHeroic,
  };
  return { copy, toggles, rests };
}

export function VariantRulesFields({
  value,
  onChange,
}: {
  value: GameSettings["variantRules"];
  onChange: (next: GameSettings["variantRules"]) => void;
}) {
  const { locale } = useI18n();
  const { copy, toggles, rests } = localizedRules(locale);
  return (
    <div>
      <span className="mb-1.5 block text-stone-400">{copy.variantRules}</span>
      <div className="flex flex-wrap gap-1.5">
        {VARIANT_TOGGLES.map((toggle) => (
          <Tooltip key={toggle.key} content={toggles[toggle.key].tip}>
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
              {toggles[toggle.key].label}
            </button>
          </Tooltip>
        ))}
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
        {(Object.keys(rests) as Array<GameSettings["variantRules"]["restVariant"]>).map((variant) => (
          <option key={variant} value={variant}>{rests[variant]}</option>
        ))}
      </select>
    </div>
  );
}

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
  const { copy, toggles, rests } = localizedRules(locale);
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
        if (!cancelled) setLoading(false);
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
            {VARIANT_TOGGLES.map((toggle) => (
              <Tooltip key={toggle.key} content={toggles[toggle.key].tip}>
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
                  {toggles[toggle.key].label} {variant[toggle.key] ? copy.on : copy.off}
                </button>
              </Tooltip>
            ))}
            <Tooltip content={copy.restTip}>
              <select
                value={variant.restVariant}
                onChange={(event) =>
                  patchVariant({
                    restVariant: event.target.value as GameSettings["variantRules"]["restVariant"],
                  })
                }
                className="rounded-md border border-stone-700 bg-stone-900 px-2 py-1 text-[11px] outline-none focus:border-amber-600"
              >
                {(Object.keys(rests) as Array<keyof typeof rests>).map((value) => (
                  <option key={value} value={value}>{rests[value]}</option>
                ))}
              </select>
            </Tooltip>
          </div>
        ) : (
          <p className="text-[11px] leading-4 text-stone-400">
            {[
              ...VARIANT_TOGGLES.filter((toggle) => variant[toggle.key]).map(
                (toggle) => toggles[toggle.key].label,
              ),
              ...(variant.restVariant !== "standard" ? [rests[variant.restVariant]] : []),
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
          <p className="text-[11px] italic text-stone-600">{copy.noHouse}</p>
        )}
      </div>

      {steersStory && chunks.length ? (
        <div className="rounded-lg border border-stone-800 bg-stone-950/40 p-2.5">
          <p className="mb-1 text-xs font-medium text-stone-300">{copy.sections}</p>
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
                  aria-label={chunk.pinned ? copy.unpin : copy.pin}
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
