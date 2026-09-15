"use client";

import { Swords } from "lucide-react";
import { CampaignCover } from "@/components/CampaignCover";
import { HeroCard } from "@/components/ui/HeroCard";
import { miscPlaceholder } from "@/lib/placeholders";
import { ui } from "@/lib/ui";
import { holdsDmSeat, type HomeCampaign } from "@/app/home/types";
import { useI18n } from "@/lib/i18n";

const COPY = {
  en: {
    continue: "Continue",
    lobby: "Lobby",
    playingAs: "Playing as {name} · {party}",
    running: "Running the table · {party}",
    noCharacter: "No character yet · {party}",
    solo: "solo",
    party: "{seats} party",
    enter: "Enter world",
    emptyTitle: "Every campaign starts with an empty table.",
    emptyBody: "Create one and invite your friends, or join theirs with a room code below.",
  },
  ru: {
    continue: "Продолжить",
    lobby: "Лобби",
    playingAs: "Вы играете за {name} · {party}",
    running: "Вы ведёте стол · {party}",
    noCharacter: "Персонаж ещё не выбран · {party}",
    solo: "соло",
    party: "партия {seats}",
    enter: "Войти в мир",
    emptyTitle: "Каждая кампания начинается с пустого стола.",
    emptyBody: "Создайте кампанию и пригласите друзей или присоединитесь к их столу по коду комнаты ниже.",
  },
  pl: {
    continue: "Kontynuuj",
    lobby: "Lobby",
    playingAs: "Grasz jako {name} · {party}",
    running: "Prowadzisz stół · {party}",
    noCharacter: "Nie wybrano jeszcze postaci · {party}",
    solo: "solo",
    party: "drużyna {seats}",
    enter: "Wejdź do świata",
    emptyTitle: "Każda kampania zaczyna się od pustego stołu.",
    emptyBody: "Utwórz kampanię i zaproś znajomych albo dołącz do ich stołu kodem pokoju poniżej.",
  },
} as const;

export function ContinueHero({ campaign, userId }: { campaign: HomeCampaign; userId: string }) {
  const { locale } = useI18n();
  const copy = COPY[locale];
  const seats = `${campaign.playerCount}/${campaign.maxPlayers}`;
  const party = campaign.maxPlayers === 1 ? copy.solo : copy.party.replace("{seats}", seats);
  const line =
    campaign.status === "lobby"
      ? `${copy.lobby} · ${seats}`
      : campaign.playingAs
        ? copy.playingAs.replace("{name}", campaign.playingAs).replace("{party}", party)
        : holdsDmSeat(campaign, userId)
          ? copy.running.replace("{party}", party)
          : copy.noCharacter.replace("{party}", party);
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
  const copy = COPY[locale];
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-stone-800 bg-stone-950/40 px-6 py-10 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={miscPlaceholder("empty")}
        alt=""
        className="aspect-video w-full max-w-xs rounded-lg border border-amber-400/20 object-cover shadow-glow-gold"
      />
      <div className="max-w-sm">
        <p className="text-balance font-serif text-2xl text-stone-200">{copy.emptyTitle}</p>
        <p className="mt-2 text-pretty text-sm text-stone-500">{copy.emptyBody}</p>
      </div>
    </div>
  );
}
