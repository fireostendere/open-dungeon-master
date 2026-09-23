"use client";

import { InfoButton } from "@/components/ui/InfoDialog";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import {
  CAMPAIGN_DIFFICULTIES,
  type CampaignDifficulty,
} from "@/lib/campaign-types";
import {
  CAMPAIGN_LENGTHS,
  DM_DIFFICULTY_LEVELS,
  type CampaignLengthSetting,
} from "@/lib/schemas/game-settings-options";
import { FieldLabel, inputClass, ToggleCard } from "@/app/create-campaign/fields";
import type { StepProps } from "@/app/create-campaign/draft";

const COPY = {
  en: {
    partyHelp: "The party is formed directly by members and their assigned characters joining this campaign.",
    players: "Players",
    startLevel: "Start level",
    difficulty: "Difficulty",
    difficultyInfoIntro:
      "Difficulty is guidance to the Dungeon Master, not a damage multiplier: every rule underneath stays 5e. It steers how hard encounters are built and how often a bad roll is allowed to really cost you.",
    difficultyInfoOutro: "The party lead can change it later from the table's settings.",
    difficultyLabels: { easy: "Easy", normal: "Normal", hard: "Hard", deadly: "Deadly" },
    difficultyHints: {
      easy: "Fights lean easy and the story forgives mistakes. Good for a first table.",
      normal: "Encounters built to the book. A careless party can still lose someone.",
      hard: "Bigger fights, fewer second chances, resources that actually run out.",
      deadly: "Assumes you want to lose characters. Plan retreats and bring spares.",
    },
    dmDifficulty: "DM strictness",
    dmDifficultyInfo:
      "Separate from encounter difficulty. At 1 the DM is very forgiving; at 10 the DM is pedantic, adversarial, and makes mistakes cost their full price. Dice are never fudged at any level.",
    dmDifficultyHint: (value: number) => value <= 2 ? "Very forgiving" : value <= 4 ? "Fair and forgiving" : value <= 6 ? "Firm" : value <= 8 ? "Hard-nosed" : "Pedantic and adversarial",
    campaignLength: "Campaign length",
    lengthInfo:
      "How far ahead the DM plans the secret story: how many acts the arc spans, and how many villains and threads it seeds at the start.\n\n**Short**: three acts, one focused adventure. A handful of sessions.\n\n**Standard**: four or five acts. The default shape of a campaign.\n\n**Epic**: six to eight acts, several threads running at once.\n\nNo length ever cuts you off. Play past the finale and a sequel saga picks up where the last one ended.",
    lengthLabels: {
      short: "Short (3 acts, a focused adventure)",
      standard: "Standard (4-5 acts)",
      epic: "Epic (6-8 acts, a sprawling saga)",
    },
    lengthHelp:
      "How far the DM plans the story ahead. Any length keeps going if you play past the finale: a sequel saga picks up where the last one ended.",
    dice: "Dice",
    digitalOnly: "Digital only",
    digitalHint: "The server rolls everything",
    realDice: "Real dice allowed",
    realSoloHint: "Roll at your desk and enter the numbers",
    realPartyHint: "Players may opt in to rolling at the table",
  },
  ru: {
    partyHelp: "Группа формируется из участников кампании и назначенных им персонажей.",
    players: "Игроки",
    startLevel: "Начальный уровень",
    difficulty: "Сложность",
    difficultyInfoIntro:
      "Сложность — это ориентир для Мастера, а не множитель урона: все базовые правила остаются 5e. Она влияет на построение столкновений и на то, насколько серьёзными могут быть последствия неудачных бросков.",
    difficultyInfoOutro: "Позже лидер группы сможет изменить сложность в настройках стола.",
    difficultyLabels: { easy: "Лёгкая", normal: "Обычная", hard: "Высокая", deadly: "Смертельная" },
    difficultyHints: {
      easy: "Бои в основном простые, а история прощает ошибки. Хороший вариант для первой игры.",
      normal: "Столкновения строятся по стандартным рекомендациям. Неосторожная группа всё ещё может потерять персонажа.",
      hard: "Более тяжёлые бои, меньше вторых шансов и ресурсы, которые действительно заканчиваются.",
      deadly: "Режим для игры, где гибель персонажей ожидаема. Планируйте отступления и держите запасных героев.",
    },
    dmDifficulty: "Жёсткость Мастера",
    dmDifficultyInfo:
      "Это не боевая сложность. На 1 Мастер очень снисходителен; на 10 — душный, придирчивый и подъёбистый, а ошибки имеют полную цену. Кости не подкручиваются ни на одном уровне.",
    dmDifficultyHint: (value: number) => value <= 2 ? "Очень снисходительно" : value <= 4 ? "Честно и мягко" : value <= 6 ? "Строго" : value <= 8 ? "Жёстко" : "Душно и подъёбисто",
    campaignLength: "Длина кампании",
    lengthInfo:
      "Насколько далеко Мастер заранее планирует скрытую сюжетную арку: сколько в ней актов, злодеев и сюжетных нитей.\n\n**Короткая**: три акта и одно сфокусированное приключение. Несколько сессий.\n\n**Стандартная**: четыре-пять актов. Обычная форма кампании.\n\n**Эпическая**: шесть-восемь актов и несколько параллельных линий.\n\nВыбранная длина никогда не завершает игру принудительно. После финала следующая сага продолжит историю с того же места.",
    lengthLabels: {
      short: "Короткая (3 акта, сфокусированное приключение)",
      standard: "Стандартная (4–5 актов)",
      epic: "Эпическая (6–8 актов, большая сага)",
    },
    lengthHelp:
      "Определяет, насколько далеко Мастер планирует сюжет заранее. После финала кампания не обрывается: следующая сага продолжит историю.",
    dice: "Кости",
    digitalOnly: "Только цифровые",
    digitalHint: "Все броски выполняет сервер",
    realDice: "Разрешить реальные кости",
    realSoloHint: "Бросайте кости сами и вводите результаты",
    realPartyHint: "Игроки смогут выбрать реальные броски за столом",
  },
} as const;

// Step 3: how many, how strong, how hard, how long, and whose dice. A solo
// table has no player count (maxPlayers is pinned to 1 in the payload).
// Campaign length guides the human or external narrator's long-term arc.
export function PartyStep({ draft, patch, gates }: StepProps) {
  const { locale } = useI18n();
  const copy = COPY[locale];
  const { solo } = gates;
  const difficultyInfo = `${copy.difficultyInfoIntro}\n\n${CAMPAIGN_DIFFICULTIES.map(
    (value) => `**${copy.difficultyLabels[value]}**: ${copy.difficultyHints[value]}`,
  ).join("\n\n")}\n\n${copy.difficultyInfoOutro}`;

  return (
    <div className="space-y-4 text-sm">
      <p className="text-xs text-stone-400">{copy.partyHelp}</p>
      <div className={cn("grid gap-3", solo ? "grid-cols-2" : "grid-cols-3")}>
        {!solo ? (
          <label className="block">
            <FieldLabel>{copy.players}</FieldLabel>
            <input
              type="number"
              min={1}
              max={8}
              value={draft.maxPlayers}
              onChange={(event) => patch({ maxPlayers: Number(event.target.value) })}
              className={inputClass}
            />
          </label>
        ) : null}
        <label className="block">
          <FieldLabel>{copy.startLevel}</FieldLabel>
          <input
            type="number"
            min={1}
            max={20}
            value={draft.startingLevel}
            onChange={(event) => patch({ startingLevel: Number(event.target.value) })}
            className={inputClass}
          />
        </label>
        <label className="block">
          <FieldLabel>
            <span className="flex items-center gap-1">
              {copy.difficulty}
              <InfoButton label={copy.difficulty} text={difficultyInfo} />
            </span>
          </FieldLabel>
          <select
            value={draft.difficulty}
            onChange={(event) =>
              patch({ difficulty: event.target.value as CampaignDifficulty })
            }
            className={inputClass}
          >
            {CAMPAIGN_DIFFICULTIES.map((value) => (
              <option key={value} value={value}>
                {copy.difficultyLabels[value]}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-stone-500">{copy.difficultyHints[draft.difficulty]}</p>
        </label>
      </div>

      <label className="block">
        <FieldLabel>
          <span className="flex items-center gap-1">
            {copy.dmDifficulty}
            <InfoButton label={copy.dmDifficulty} text={copy.dmDifficultyInfo} />
          </span>
        </FieldLabel>
        <select
          value={draft.dmDifficulty}
          onChange={(event) => patch({ dmDifficulty: Number(event.target.value) as typeof draft.dmDifficulty })}
          className={inputClass}
        >
          {DM_DIFFICULTY_LEVELS.map((value) => (
            <option key={value} value={value}>{value}/10</option>
          ))}
        </select>
        <p className="mt-1 text-xs text-stone-500">{copy.dmDifficultyHint(draft.dmDifficulty)}</p>
      </label>

        <label className="block">
          <FieldLabel>
            <span className="flex items-center gap-1">
              {copy.campaignLength}
              <InfoButton label={copy.campaignLength} text={copy.lengthInfo} />
            </span>
          </FieldLabel>
          <select
            value={draft.campaignLength}
            onChange={(event) =>
              patch({ campaignLength: event.target.value as CampaignLengthSetting })
            }
            className={inputClass}
          >
            {CAMPAIGN_LENGTHS.map((value) => (
              <option key={value} value={value}>
                {copy.lengthLabels[value]}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-stone-500">{copy.lengthHelp}</p>
        </label>

      <div>
        <FieldLabel className="mb-1.5">{copy.dice}</FieldLabel>
        <div className="flex gap-2">
          <ToggleCard
            active={draft.dicePolicy === "digital_only"}
            onClick={() => patch({ dicePolicy: "digital_only" })}
            label={copy.digitalOnly}
            hint={copy.digitalHint}
          />
          <ToggleCard
            active={draft.dicePolicy === "real_allowed"}
            onClick={() => patch({ dicePolicy: "real_allowed" })}
            label={copy.realDice}
            hint={solo ? copy.realSoloHint : copy.realPartyHint}
          />
        </div>
      </div>
    </div>
  );
}
