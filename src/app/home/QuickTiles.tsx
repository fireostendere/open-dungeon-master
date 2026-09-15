"use client";

import { BookOpen, Hammer, KeyRound, Plus, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { QuickTile } from "@/components/ui/QuickTile";
import { useI18n } from "@/lib/i18n";

const COPY = {
  en: { newCampaign: "New campaign", solo: "Solo adventure", join: "Join with a code" },
  ru: { newCampaign: "Новая кампания", solo: "Одиночное приключение", join: "Войти по коду" },
  pl: { newCampaign: "Nowa kampania", solo: "Przygoda solo", join: "Dołącz kodem" },
} as const;

export function QuickTiles({
  onNewCampaign,
  onSolo,
  showSolo,
  onJoin,
}: {
  onNewCampaign: () => void;
  onSolo: () => void;
  showSolo: boolean;
  onJoin: () => void;
}) {
  const { t, locale } = useI18n();
  const copy = COPY[locale];
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-3 sm:grid-cols-3",
        showSolo ? "md:grid-cols-5" : "md:grid-cols-4",
      )}
    >
      <QuickTile icon={Plus} label={copy.newCampaign} onClick={onNewCampaign} />
      {showSolo ? <QuickTile icon={BookOpen} label={copy.solo} onClick={onSolo} /> : null}
      <QuickTile icon={Users} label={t("nav.characters")} href="/characters" />
      <QuickTile icon={Hammer} label={t("nav.workshop")} href="/workshop" />
      <QuickTile icon={KeyRound} label={copy.join} onClick={onJoin} />
    </div>
  );
}
