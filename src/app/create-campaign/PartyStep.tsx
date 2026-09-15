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
  pl: {
    partyHelp: "Drużyna powstaje z członków kampanii i przypisanych do nich postaci.",
    players: "Gracze",
    startLevel: "Poziom początkowy",
    difficulty: "Poziom trudności",
    difficultyInfoIntro:
      "Poziom trudności jest wskazówką dla Mistrza Gry, a nie mnożnikiem obrażeń: wszystkie zasady pozostają 5e. Wpływa na trudność projektowanych starć i na to, jak dotkliwe mogą być skutki pechowego rzutu.",
    difficultyInfoOutro: "Lider drużyny może później zmienić go w ustawieniach stołu.",
    difficultyLabels: { easy: "Łatwy", normal: "Normalny", hard: "Trudny", deadly: "Śmiertelny" },
    difficultyHints: {
      easy: "Walki są raczej łatwe, a historia wybacza błędy. Dobry wybór na pierwszą sesję.",
      normal: "Starcia są budowane zgodnie z podręcznikiem. Nieostrożna drużyna nadal może kogoś stracić.",
      hard: "Większe starcia, mniej drugich szans i zasoby, które naprawdę się kończą.",
      deadly: "Zakłada, że utrata postaci jest częścią gry. Planuj odwroty i przygotuj zapasowych bohaterów.",
    },
    campaignLength: "Długość kampanii",
    lengthInfo:
      "Jak daleko Mistrz Gry planuje z wyprzedzeniem tajną fabułę: ile aktów obejmuje wątek oraz ilu przeciwników i pobocznych tematów zostaje zasianych na początku.\n\n**Krótka**: trzy akty, jedna skupiona przygoda. Kilka sesji.\n\n**Standardowa**: cztery lub pięć aktów. Domyślna forma kampanii.\n\n**Epicka**: sześć do ośmiu aktów i kilka równoległych wątków.\n\nŻadna długość nie kończy gry na siłę. Po finale kolejna saga podejmuje historię w miejscu, w którym skończyła się poprzednia.",
    lengthLabels: {
      short: "Krótka (3 akty, skupiona przygoda)",
      standard: "Standardowa (4–5 aktów)",
      epic: "Epicka (6–8 aktów, rozbudowana saga)",
    },
    lengthHelp:
      "Określa, jak daleko Mistrz Gry planuje fabułę z wyprzedzeniem. Po finale kampania trwa dalej: kolejna saga podejmuje historię od poprzedniego zakończenia.",
    dice: "Kości",
    digitalOnly: "Tylko cyfrowe",
    digitalHint: "Wszystkie rzuty wykonuje serwer",
    realDice: "Zezwól na prawdziwe kości",
    realSoloHint: "Rzucaj kośćmi przy biurku i wpisuj wyniki",
    realPartyHint: "Gracze mogą zdecydować się na rzuty fizycznymi kośćmi",
  },
} as const;

// Step 3: how many, how strong, how hard, how long, and whose dice. A solo
// table has no player count (maxPlayers is pinned to 1 in the payload), and
// only an AI narrator plans a story arc, so length hides with it.
export function PartyStep({ draft, patch, gates }: StepProps) {
  const { locale } = useI18n();
  const copy = COPY[locale];
  const { solo, aiNarrates } = gates;
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

      {aiNarrates ? (
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
      ) : null}

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
