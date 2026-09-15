"use client";

import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";

const COPY = {
  en: {
    title: "Unofficial community campaign",
    inline: "Unofficial community campaign. ",
    fan: "This campaign is a fan-created work and is not affiliated with, sponsored by, or endorsed by {holder}.",
    community: "This campaign is community-created content and does not ship with Open Dungeon Master.",
  },
  ru: {
    title: "Неофициальная кампания сообщества",
    inline: "Неофициальная кампания сообщества. ",
    fan: "Эта кампания создана фанатами и не связана с {holder}, не спонсируется и не одобряется правообладателем.",
    community: "Эта кампания создана сообществом и не входит в поставку Open Dungeon Master.",
  },
  pl: {
    title: "Nieoficjalna kampania społeczności",
    inline: "Nieoficjalna kampania społeczności. ",
    fan: "Ta kampania jest dziełem fanowskim i nie jest powiązana z {holder}, sponsorowana ani zatwierdzona przez właściciela praw.",
    community: "Ta kampania została utworzona przez społeczność i nie jest dostarczana z Open Dungeon Master.",
  },
} as const;

export function UnofficialPackNotice({
  rightsHolder,
  inspiredBy,
  variant = "block",
  className,
}: {
  rightsHolder: string;
  inspiredBy?: string;
  variant?: "block" | "inline";
  className?: string;
}) {
  const { locale } = useI18n();
  const copy = COPY[locale];
  const holder = rightsHolder.trim();
  const body = holder ? copy.fan.replace("{holder}", holder) : copy.community;

  if (variant === "inline") {
    return (
      <p className={cn("text-[11px] italic leading-4 text-stone-500", className)}>
        {holder ? copy.inline : ""}
        {body}
      </p>
    );
  }

  return (
    <div
      className={cn(
        "rounded-md border border-stone-800 bg-stone-950/60 px-3 py-2 text-[11px] leading-4 text-stone-400",
        className,
      )}
    >
      <p className="font-medium uppercase tracking-wide text-stone-300">{copy.title}</p>
      <p className="mt-1">{body}</p>
      {inspiredBy ? <p className="mt-1 text-stone-500">{inspiredBy}</p> : null}
    </div>
  );
}
