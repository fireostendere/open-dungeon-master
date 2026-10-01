"use client";

import { useReducer } from "react";
import { iconCandidates, markIconFailed, type IconRef } from "@/lib/icons";
import { cn } from "@/lib/cn";

// A painted icon on its plate: a disc lit from its centre with a thin gold
// rim, the same plate for every icon so a list of them reads as one set. Many
// paintings are dark figures (a hooded rogue, a petrified statue); the lit
// centre and a hair of warm rim light keep them readable on the night theme.
// Tries the thing's own painting, then its family's, then renders nothing, so
// a homebrew spell or a Russian-named item never shows a broken image
// (src/lib/icons.ts). A load that fails is remembered for the session, so the
// rest of a list does not ask for it again. The paintings ship with a wide
// margin, so the image is scaled up inside the plate and the rim crops it.
// Decorative: the name always sits beside it, so it is hidden from readers.
export function GameIcon({ icon, size = "size-6", className }: { icon: IconRef; size?: string; className?: string }) {
  const [, retry] = useReducer((n: number) => n + 1, 0);
  const src = iconCandidates(icon)[0];
  if (!src) {
    return null;
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-amber-700/50 bg-[radial-gradient(circle_at_50%_36%,#5b4c3a,#1d1712_80%)] p-px shadow-inner",
        size,
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={src}
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        className="size-full scale-[1.7] object-contain [filter:drop-shadow(0_0_1px_rgba(255,224,160,0.75))_brightness(1.06)]"
        onError={() => {
          markIconFailed(src);
          retry();
        }}
      />
    </span>
  );
}
