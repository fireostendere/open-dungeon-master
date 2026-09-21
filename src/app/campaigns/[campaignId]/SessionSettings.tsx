"use client";

import { Pencil } from "lucide-react";
import { useState } from "react";
import type { CampaignDifficulty } from "@/lib/campaign-types";
import type { GameSettings } from "@/lib/schemas/game-settings";
import { EditCampaignDialog } from "@/app/campaigns/[campaignId]/EditCampaignDialog";
import { GameSettingsPanel } from "@/app/campaigns/[campaignId]/GameSettingsPanel";
import { RulesPanel } from "@/app/campaigns/[campaignId]/RulesPanel";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";

// Setup tab of the session side panel. Two authorities meet here: campaign
// details belong to the lead (the PATCH /api/campaigns/[id] gate), while game
// settings and house rules follow story authority, which a human DM takes
// over from the lead. Everyone else sees a read-only summary.
export function SessionSettings({
  campaign,
  isLead,
  steersStory,
}: {
  campaign: {
    id: string;
    title: string;
    description: string;
    theme: string;
    maxPlayers: number;
    startingLevel: number;
    difficulty: CampaignDifficulty;
    gameSettings?: GameSettings;
  };
  isLead: boolean;
  steersStory: boolean;
}) {
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: { campaign: "Campaign", edit: "Edit details", editTitle: "Edit title, premise, setting, difficulty, and player slots", difficulty: "Difficulty {difficulty} · Level {level} start · Up to {players} players", setting: "Setting: {theme}" },
    ru: { campaign: "Кампания", edit: "Изменить данные", editTitle: "Изменить название, завязку, сеттинг, сложность и число игроков", difficulty: "Сложность: {difficulty} · старт с {level}-го уровня · до {players} игроков", setting: "Сеттинг: {theme}" },
    pl: { campaign: "Kampania", edit: "Edytuj szczegóły", editTitle: "Edytuj tytuł, założenie, świat, poziom trudności i liczbę graczy", difficulty: "Trudność: {difficulty} · start na poziomie {level} · do {players} graczy", setting: "Świat: {theme}" },
  });
  const [editing, setEditing] = useState(false);

  return (
    <div className="text-sm">
      <div className="mb-3 rounded-lg border border-stone-800 bg-stone-950/40 p-3">
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-xs font-medium text-stone-400">{copy.campaign}</p>
          {isLead ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              title={copy.editTitle}
              className="flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-900"
            >
              <Pencil className="size-3" /> {copy.edit}
            </button>
          ) : null}
        </div>
        <p className="truncate text-stone-200">{campaign.title}</p>
        <p className="mt-1 text-xs text-stone-500">
          {copy.difficulty.replace("{difficulty}", campaign.difficulty).replace("{level}", String(campaign.startingLevel)).replace("{players}", String(campaign.maxPlayers))}
        </p>
        {campaign.theme ? (
          <p className="mt-1 line-clamp-2 text-xs text-stone-500">{copy.setting.replace("{theme}", campaign.theme)}</p>
        ) : null}
      </div>

      {campaign.gameSettings ? (
        <GameSettingsPanel
          campaignId={campaign.id}
          settings={campaign.gameSettings}
          steersStory={steersStory}
        />
      ) : null}

      {campaign.settings ? (
        <StoryAiPanel
          campaignId={campaign.id}
          settings={campaign.settings}
          steersStory={steersStory}
        />
      ) : null}

      {campaign.gameSettings ? (
        <div className="mt-3">
          <RulesPanel
            campaignId={campaign.id}
            settings={campaign.gameSettings}
            steersStory={steersStory}
          />
        </div>
      ) : null}

      {editing ? <EditCampaignDialog campaign={campaign} onClose={() => setEditing(false)} /> : null}
    </div>
  );
}
