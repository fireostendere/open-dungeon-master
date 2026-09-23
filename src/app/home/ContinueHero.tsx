"use client";

import { Swords } from "lucide-react";
import { CampaignCover } from "@/components/CampaignCover";
import { HeroCard } from "@/components/ui/HeroCard";
import { miscPlaceholder } from "@/lib/placeholders";
import { ui } from "@/lib/ui";
import { holdsDmSeat, type HomeCampaign } from "@/app/home/types";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";

export function ContinueHero({ campaign, userId }: { campaign: HomeCampaign; userId: string }) {
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: {
      continue: "Continue",
      lobby: "Lobby",
      playingAs: "Playing as",
      running: "Running the table",
      noCharacter: "No character yet",
      party: "party",
      solo: "solo",
      enter: "Enter world",
    },
    ru: {
      continue: "Продолжить",
      lobby: "Лобби",
      playingAs: "Персонаж",
      running: "Вы ведёте игру",
      noCharacter: "Персонаж ещё не выбран",
      party: "партия",
      solo: "соло",
      enter: "Войти в мир",
    },
  });
  const seats = `${campaign.playerCount}/${campaign.maxPlayers}`;
  const party = campaign.maxPlayers === 1 ? copy.solo : `${seats} ${copy.party}`;
  const line =
    campaign.status === "lobby"
      ? `${copy.lobby} · ${seats}`
      : campaign.playingAs
        ? `${copy.playingAs} ${campaign.playingAs} · ${party}`
        : holdsDmSeat(campaign, userId)
          ? `${copy.running} · ${party}`
          : `${copy.noCharacter} · ${party}`;
  return (
    <HeroCard
      eyebrow={copy.continue}
      title={campaign.title}
      line={line}
      art={
        <CampaignCover
          cover={campaign.cover}
          title={campaign.title}
          genre={campaign.genre}
          seed={campaign.id}
          className="h-full rounded-none border-0 shadow-none aspect-auto"
        />
      }
      action={
        <a href={`/campaigns/${campaign.id}`} className={ui.btnPrimary}>
          <Swords className="size-4" /> {copy.enter}
        </a>
      }
    />
  );
}

export function EmptyHero() {
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: {
      title: "Every campaign starts with an empty table.",
      body: "Create one and invite your friends, or join theirs with a room code below.",
    },
    ru: {
      title: "Каждая кампания начинается с пустого стола.",
      body: "Создайте свою и пригласите друзей или присоединитесь к их игре по коду комнаты ниже.",
    },
  });
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-stone-800 bg-stone-950/40 px-6 py-10 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={miscPlaceholder("empty")}
        alt=""
        className="aspect-video w-full max-w-xs rounded-lg border border-amber-400/20 object-cover shadow-glow-gold"
      />
      <div className="max-w-sm">
        <p className="text-balance font-serif text-2xl text-stone-200">{copy.title}</p>
        <p className="mt-2 text-pretty text-sm text-stone-500">{copy.body}</p>
      </div>
    </div>
  );
}
