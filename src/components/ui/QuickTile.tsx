import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { GameIcon } from "@/components/ui/GameIcon";
import { cn } from "@/lib/cn";
import { IconChip, ui } from "@/lib/ui";

// Square-ish quick-action tile: gold icon chip over a Cinzel label, lifts on
// hover. Renders a Link when given an href, otherwise a button.
//
//   <QuickTile icon={Plus} label="New campaign" href="/campaigns/new" />
//   <QuickTile icon={Dice5} label="Roll" onClick={roll} />
export function QuickTile({
  icon,
  label,
  href,
  onClick,
  disabled = false,
  className,
  glyph,
}: {
  icon: LucideIcon;
  // A painted glyph (public/assets/icons/glyph) that stands over the line
  // icon; the line icon stays underneath as the fallback.
  glyph?: string;
  label: string;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const classes = cn(
    ui.tile,
    ui.tileHover,
    "h-full min-h-36 w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40",
    disabled && "pointer-events-none opacity-50",
    className,
  );
  const body = (
    <>
      {glyph ? (
        <span className="relative flex size-14 items-center justify-center">
          <IconChip icon={icon} size="size-10" iconSize="size-5" className="absolute" />
          <GameIcon icon={{ kind: "glyph", key: glyph }} size="size-14" className="relative" />
        </span>
      ) : (
        <IconChip icon={icon} size="size-10" iconSize="size-5" />
      )}
      <span className="max-w-full text-balance break-words px-1 text-center font-display text-[12px] font-semibold uppercase leading-tight tracking-[0.06em] text-stone-200">
        {label}
      </span>
    </>
  );
  if (href && !disabled) {
    return (
      <Link href={href} onClick={onClick} className={classes}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={classes}>
      {body}
    </button>
  );
}
