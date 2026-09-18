"use client";

import type { ReactNode } from "react";
import { useI18n } from "@/lib/i18n";
import type { WorldPackSummary } from "@/lib/worlds/types";
import { featuresOn } from "@/app/create-campaign/FeelStep";
import type { StepProps } from "@/app/create-campaign/draft";

const COPY = {
  en: {
    dmModes: {
      ai: "AI Dungeon Master",
      human: "I run the game",
      assisted: "I run the game, with AI help",
    },
    genres: {
      high_fantasy: "High fantasy",
      dark_fantasy: "Dark fantasy",
      mystery: "Mystery",
      horror: "Horror",
      cyberpunk: "Cyberpunk",
      steampunk: "Steampunk",
      post_apocalyptic: "Post-apocalyptic",
      custom: "Custom",
    },
    difficulties: { easy: "Easy", normal: "Normal", hard: "Hard", deadly: "Deadly" },
    soloParty: (level: number) => `Solo · level ${level}`,
    party: (players: number, level: number) => `${players} players · level ${level}`,
    digitalOnly: "Digital only",
    realDice: "Real dice allowed",
    runsGame: "Runs the game",
    setting: "Setting",
    partyLabel: "Party",
    difficulty: "Difficulty",
    dmDifficulty: "DM strictness",
    dice: "Dice",
    units: "Units",
    unitsMetric: "Metric (m, kg)",
    unitsImperial: "Imperial (ft, lb)",
    features: "Table features",
    featuresOn: (count: number) => `${count} on`,
    soloNext: "You'll drop into the lobby next to ready up.",
    partyNext: "You'll drop into the lobby next to share an invite code and ready up.",
    soloNoAi:
      "A solo adventure needs the AI storyteller, and this server does not have one. Ask the server owner to set up an AI backend first.",
  },
  ru: {
    dmModes: {
      ai: "ИИ-Мастер",
      human: "Игру веду я",
      assisted: "Игру веду я, с помощью ИИ",
    },
    genres: {
      high_fantasy: "Высокое фэнтези",
      dark_fantasy: "Тёмное фэнтези",
      mystery: "Детектив",
      horror: "Хоррор",
      cyberpunk: "Киберпанк",
      steampunk: "Стимпанк",
      post_apocalyptic: "Постапокалипсис",
      custom: "Свой мир",
    },
    difficulties: { easy: "Лёгкая", normal: "Обычная", hard: "Высокая", deadly: "Смертельная" },
    soloParty: (level: number) => `Соло · уровень ${level}`,
    party: (players: number, level: number) => `${players} игроков · уровень ${level}`,
    digitalOnly: "Только цифровые",
    realDice: "Разрешены реальные кости",
    runsGame: "Кто ведёт игру",
    setting: "Сеттинг",
    partyLabel: "Группа",
    difficulty: "Сложность",
    dmDifficulty: "Жёсткость Мастера",
    dice: "Кости",
    units: "Единицы измерения",
    unitsMetric: "Метрические (м, кг)",
    unitsImperial: "Имперские (фт, фнт)",
    features: "Функции стола",
    featuresOn: (count: number) => `включено: ${count}`,
    soloNext: "После создания вы попадёте в лобби, где останется отметить готовность.",
    partyNext: "После создания вы попадёте в лобби, где сможете отправить приглашение и отметить готовность.",
    soloNoAi:
      "Для одиночного приключения нужен ИИ-рассказчик, а на этом сервере он не настроен. Сначала попросите владельца сервера подключить ИИ-бэкенд.",
  },
  pl: {
    dmModes: {
      ai: "Mistrz Gry AI",
      human: "Ja prowadzę grę",
      assisted: "Ja prowadzę grę, z pomocą AI",
    },
    genres: {
      high_fantasy: "High fantasy",
      dark_fantasy: "Dark fantasy",
      mystery: "Tajemnica",
      horror: "Horror",
      cyberpunk: "Cyberpunk",
      steampunk: "Steampunk",
      post_apocalyptic: "Postapokalipsa",
      custom: "Własny",
    },
    difficulties: { easy: "Łatwy", normal: "Normalny", hard: "Trudny", deadly: "Śmiertelny" },
    soloParty: (level: number) => `Solo · poziom ${level}`,
    party: (players: number, level: number) => `${players} graczy · poziom ${level}`,
    digitalOnly: "Tylko cyfrowe",
    realDice: "Prawdziwe kości dozwolone",
    runsGame: "Prowadzący",
    setting: "Setting",
    partyLabel: "Drużyna",
    difficulty: "Poziom trudności",
    dmDifficulty: "Surowość Mistrza Gry",
    dice: "Kości",
    units: "Jednostki",
    unitsMetric: "Metryczne (m, kg)",
    unitsImperial: "Imperialne (ft, lb)",
    features: "Funkcje stołu",
    featuresOn: (count: number) => `włączone: ${count}`,
    soloNext: "Po utworzeniu trafisz do lobby, gdzie pozostanie oznaczyć gotowość.",
    partyNext: "Po utworzeniu trafisz do lobby, gdzie możesz udostępnić kod zaproszenia i oznaczyć gotowość.",
    soloNoAi:
      "Przygoda solo wymaga narratora AI, a ten serwer go nie ma. Najpierw poproś właściciela serwera o skonfigurowanie backendu AI.",
  },
} as const;

// Step 6: the choices that shape the table, read back before the row is
// made. The warnings that block creation live here too, next to the button
// that they block.
export function ReviewStep({
  draft,
  gates,
  selectedPack,
  error,
}: StepProps & {
  selectedPack: WorldPackSummary | null;
  error: string;
}) {
  const { locale } = useI18n();
  const copy = COPY[locale];
  const { solo, storyKnownMissing } = gates;
  const genreName = copy.genres[draft.genre];
  const setting = selectedPack ? `${selectedPack.name} (${genreName})` : genreName;
  const party = solo
    ? copy.soloParty(draft.startingLevel)
    : copy.party(draft.maxPlayers, draft.startingLevel);
  const dice = draft.dicePolicy === "digital_only" ? copy.digitalOnly : copy.realDice;
  const difficulty = copy.difficulties[draft.difficulty];

  return (
    <div className="space-y-4 text-sm">
      <dl className="divide-y divide-stone-800/80 rounded-lg border border-stone-800 bg-stone-950/40">
        <Row label={copy.runsGame}>{copy.dmModes[draft.dmMode]}</Row>
        <Row label={copy.setting}>{setting}</Row>
        <Row label={copy.partyLabel}>{party}</Row>
        <Row label={copy.difficulty}>{difficulty}</Row>
        <Row label={copy.dmDifficulty}>{draft.dmDifficulty}/10</Row>
        <Row label={copy.dice}>{dice}</Row>
        <Row label={copy.units}>{draft.unitSystem === "imperial" ? copy.unitsImperial : copy.unitsMetric}</Row>
        <Row label={copy.features}>{copy.featuresOn(featuresOn(draft, gates))}</Row>
      </dl>
      <p className="text-stone-400">{solo ? copy.soloNext : copy.partyNext}</p>
      {solo && storyKnownMissing ? (
        <p className="rounded-lg border border-amber-900/50 bg-amber-950/30 p-3 text-amber-200">
          {copy.soloNoAi}
        </p>
      ) : null}
      {error ? <p className="text-red-400">{error}</p> : null}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-3 py-2">
      <dt className="shrink-0 text-xs uppercase tracking-wide text-stone-500">{label}</dt>
      <dd className="min-w-0 truncate text-right text-stone-200">{children}</dd>
    </div>
  );
}
