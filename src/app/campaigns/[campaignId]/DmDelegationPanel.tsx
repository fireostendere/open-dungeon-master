"use client";

import {
  coverActive,
  describeCover,
  type DmCover,
} from "@/lib/dm/delegation";

// Hosted DM delegation was removed. Keep this export temporarily so existing
// callers do not need a synchronized component migration; external narrator
// orchestration owns any model delegation now.
export function DmDelegationPanel(_props: {
  campaignId: string;
  cover: DmCover | null;
  canMonsters: boolean;
  canCover: boolean;
}) {
  return null;
}

// A persisted cover record can survive an upgrade. Continue rendering the
// table-visible notice until that legacy record is cleared; no new hosted
// cover sessions can be created by this component.
export function DmCoverNotice({ cover }: { cover: DmCover | null }) {
  if (!coverActive(cover)) return null;
  return (
    <p className="mb-2 rounded-md border border-amber-900/60 bg-amber-950/30 px-2.5 py-1.5 text-xs text-amber-200/90">
      {describeCover(cover)}
    </p>
  );
}
