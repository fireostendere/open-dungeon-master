"use client";

import { GameIcon } from "@/components/ui/GameIcon";
import {
  coverActive,
  describeCover,
  type DmCover,
} from "@/lib/dm/delegation";

// A persisted cover record can survive an upgrade. Continue rendering the
// table-visible notice until that legacy record is cleared; no new hosted
// cover sessions can be created by this component.
export function DmCoverNotice({ cover }: { cover: DmCover | null }) {
  if (!coverActive(cover)) return null;
  return (
    <p className="mb-2 flex items-center gap-2 rounded-md border border-amber-900/60 bg-amber-950/30 px-2.5 py-1.5 text-xs text-amber-200/90">
      <GameIcon icon={{ kind: "glyph", key: "tab-dm" }} size="size-5" />
      {describeCover(cover)}
    </p>
  );
}
