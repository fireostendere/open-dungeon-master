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
  fitLetters,
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
  // The longest word in the whole row, so every tile's label shares one
  // size; defaults to this label's own longest word.
  fitLetters?: number;
}) {
  const classes = cn(
    ui.tile,
    ui.tileHover,
    "@container h-full min-h-36 w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40",
    disabled && "pointer-events-none opacity-50",
    className,
  );
  // Words never break mid-letter: the label shrinks until the longest word
  // fits the tile's content box (a Cinzel capital runs ~0.84em with this
  // tracking; the label pads 0.5rem).
  const longest = fitLetters ?? longestWord(label);
  const fit = `min(12px, calc((100cqi - 0.5rem) / ${(longest * 0.84).toFixed(2)}))`;
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
      <span
        style={{ fontSize: fit }}
        className="max-w-full text-balance break-normal px-1 text-center font-display font-semibold uppercase leading-tight tracking-[0.06em] text-stone-200"
      >
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

// Letters in the longest unbreakable run; a hyphen is a fair place to wrap.
export function longestWord(text: string): number {
  return Math.max(...text.split(/[\s-]+/).map((word) => word.length));
}
