"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import { use } from "react";
import { Lobby } from "@/app/campaigns/[campaignId]/Lobby";
import { SessionView } from "@/app/campaigns/[campaignId]/SessionView";
import { useCampaignStream } from "@/app/campaigns/[campaignId]/useCampaignStream";
import { AppHomeLogo } from "@/components/AccountMenu";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";

export default function CampaignPage({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: { missing: "Campaign not found.", answered: "Answered by {name}", back: "Back to campaigns" },
    ru: { missing: "Кампания не найдена.", answered: "Ответил: {name}", back: "К кампаниям" },
  });
  const { campaignId } = use(params);
  const {
    state,
    refresh,
    loadOlderMessages,
    refreshNotes,
    refreshSideChat,
    refreshWhispers,
    refreshAsks,
    refreshFacts,
    refreshBattleMap,
  } = useCampaignStream(campaignId);

  if (state.loading) {
    return (
      <main className="relative flex flex-1 items-center justify-center">
        <AppHomeLogo className="absolute left-4 top-4" />
        <Loader2 className="size-6 animate-spin text-stone-500" />
      </main>
    );
  }

  if (state.error || !state.campaign || !state.me) {
    return (
      <main className="relative flex flex-1 flex-col items-center justify-center gap-3 p-6">
        <AppHomeLogo className="absolute left-4 top-4" />
        <p className="text-stone-400">{state.error || copy.missing}</p>
        {state.answeredBy ? (
          <p className="text-xs text-stone-500">{copy.answered.replace("{name}", state.answeredBy)}</p>
        ) : null}
        <Link href="/" className="text-sm text-amber-200 hover:underline">
          {copy.back}
        </Link>
      </main>
    );
  }

  return state.campaign.status === "lobby" ? (
    <Lobby state={state} refresh={refresh} />
  ) : (
    <SessionView
      state={state}
      refreshCampaign={refresh}
      loadOlderMessages={loadOlderMessages}
      refreshNotes={refreshNotes}
      refreshFacts={refreshFacts}
      refreshSideChat={refreshSideChat}
      refreshWhispers={refreshWhispers}
      refreshAsks={refreshAsks}
      refreshBattleMap={refreshBattleMap}
    />
  );
}
