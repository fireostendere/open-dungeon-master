"use client";

import { BookOpen, BookOpenText, Hammer, KeyRound, Plus, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { QuickTile } from "@/components/ui/QuickTile";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";

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
  const { locale, t } = useI18n();
  const copy = localeText(locale, {
    en: { newCampaign: "New campaign", solo: "Solo adventure", join: "Join with a code" },
    ru: { newCampaign: "Новая кампания", solo: "Соло-приключение", join: "Войти по коду" },
  });
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-3 sm:grid-cols-3",
        showSolo ? "lg:grid-cols-6" : "md:grid-cols-5",
      )}
    >
      <QuickTile icon={Plus} glyph="tab-campaigns" label={copy.newCampaign} onClick={onNewCampaign} />
      {showSolo ? <QuickTile icon={BookOpen} glyph="tab-story" label={copy.solo} onClick={onSolo} /> : null}
      <QuickTile icon={Users} glyph="tab-characters" label={t("nav.characters")} href="/characters" />
      <QuickTile icon={Hammer} glyph="system-homebrew" label={t("nav.workshop")} href="/workshop" />
      <QuickTile icon={BookOpenText} glyph="system-rules" label={t("nav.rulebook")} href="/rulebook" />
      <QuickTile icon={KeyRound} glyph="tab-handout" label={copy.join} onClick={onJoin} />
    </div>
  );
}
