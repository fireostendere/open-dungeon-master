"use client";

import { VariantRulesFields } from "@/app/campaigns/[campaignId]/RulesPanel";
import { WorldSetupFields } from "@/app/WorldSetupFields";
import { ContentImportPicker } from "@/app/workshop/ContentImportPicker";
import { FieldLabel, ToggleCard } from "@/app/create-campaign/fields";
import { VoiceChatFields } from "@/app/create-campaign/VoiceChatFields";
import type { StepProps } from "@/app/create-campaign/draft";
import { useI18n } from "@/lib/i18n";

const COPY = {
  en: {
    bringPrep: "Bring in prep",
    units: "Measurement units",
    unitsMetric: "Metric (m, kg)",
    unitsMetricHint: "Meters and kilograms (default for all campaigns)",
    unitsImperial: "Imperial (ft, lb)",
    unitsImperialHint: "Feet and pounds",
    combat: "Combat mode",
    combatClassical: "Classical",
    combatClassicalHint: "Position, range, cover, and opportunity attacks apply.",
    combatJrpg: "JRPG",
    combatJrpgHint: "All targets in one encounter are in range; a campaign house rule.",
  },
  ru: {
    bringPrep: "Импортировать подготовку",
    units: "Единицы измерения",
    unitsMetric: "Метрические (м, кг)",
    unitsMetricHint: "Метры и килограммы (по умолчанию для всех кампаний)",
    unitsImperial: "Имперские (фт, фнт)",
    unitsImperialHint: "Футы и фунты",
    combat: "Режим боя",
    combatClassical: "Классический",
    combatClassicalHint: "Действуют позиция, дальность, укрытие и провоцированные атаки.",
    combatJrpg: "JRPG",
    combatJrpgHint: "Все цели одной встречи в зоне действия; правило кампании.",
  },
} as const;

// Step 5: the decisions a first-timer can skip. Variant rules, house rules
// and starting lore, prep from a workshop, and live voice. Every one of
// them is editable again from the lobby.
export function AdvancedStep({ draft, patch, gates }: StepProps) {
  const { locale } = useI18n();
  const copy = COPY[locale];
  return (
    <div className="space-y-4 text-sm">
      <div>
        <FieldLabel className="mb-1.5">{copy.units}</FieldLabel>
        <div className="flex gap-2">
          <ToggleCard
            active={draft.unitSystem === "metric"}
            onClick={() => patch({ unitSystem: "metric" })}
            label={copy.unitsMetric}
            hint={copy.unitsMetricHint}
          />
          <ToggleCard
            active={draft.unitSystem === "imperial"}
            onClick={() => patch({ unitSystem: "imperial" })}
            label={copy.unitsImperial}
            hint={copy.unitsImperialHint}
          />
        </div>
      </div>

      <div>
        <FieldLabel className="mb-1.5">{copy.combat}</FieldLabel>
        <div className="flex gap-2">
          <ToggleCard active={draft.combatMode === "classical"} onClick={() => patch({ combatMode: "classical" })} label={copy.combatClassical} hint={copy.combatClassicalHint} />
          <ToggleCard active={draft.combatMode === "jrpg"} onClick={() => patch({ combatMode: "jrpg" })} label={copy.combatJrpg} hint={copy.combatJrpgHint} />
        </div>
      </div>

      <VariantRulesFields
        value={draft.variantRules}
        onChange={(variantRules) => patch({ variantRules })}
      />

      <WorldSetupFields
        houseRules={draft.houseRules}
        setHouseRules={(houseRules) => patch({ houseRules })}
        loreDrafts={draft.loreDrafts}
        setLoreDrafts={(loreDrafts) => patch({ loreDrafts })}
      />

      <div className="rounded-lg border border-stone-800 bg-stone-950/40 p-3">
        <FieldLabel className="mb-1.5">{copy.bringPrep}</FieldLabel>
        <ContentImportPicker
          selection={draft.contentImport}
          onChange={(contentImport) => patch({ contentImport })}
        />
      </div>

      {!gates.solo ? (
        <VoiceChatFields value={draft.voiceChat} onChange={(voiceChat) => patch({ voiceChat })} />
      ) : null}
    </div>
  );
}
