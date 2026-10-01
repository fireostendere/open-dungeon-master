"use client";

import { Check, Loader2, X } from "lucide-react";
import { GameIcon } from "@/components/ui/GameIcon";
import { useState } from "react";
import { cn } from "@/lib/cn";
import type { ItemProposal } from "@/app/campaigns/[campaignId]/useCampaignStream";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { useI18n } from "@/lib/i18n/context";
import { localeText } from "@/lib/i18n/locale-text";

// Pending DM item/gold offers (inventoryApprovals): the owning player gets
// Accept/Decline, everyone else sees a passive chip, the lead may withdraw.
// Driven by item_proposal_added/item_proposal_resolved on the stream.
export function ItemProposalBar({
  campaignId,
  proposals,
  sheets,
  meUserId,
  steersStory,
}: {
  campaignId: string;
  proposals: ItemProposal[];
  sheets: CharacterSheet[];
  meUserId: string;
  steersStory: boolean;
}) {
  const { locale } = useI18n();
  const copy = localeText(locale, { en: { failed: "That did not work.", character: "a character", accept: "Accept", decline: "Decline", withdraw: "Withdraw", waiting: "waiting on" }, ru: { failed: "Не получилось.", character: "персонажа", accept: "Принять", decline: "Отклонить", withdraw: "Отозвать", waiting: "ждём" } });
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  if (!proposals.length) {
    return null;
  }

  async function resolve(proposalId: string, action: "approve" | "decline" | "cancel") {
    setBusyId(proposalId);
    setError("");
    try {
      const response = await fetch(
        `/api/campaigns/${campaignId}/item-proposals/${proposalId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        },
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
         setError(String(data.error ?? copy.failed));
      }
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="mx-3 mb-2 space-y-1.5">
      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
      {proposals.map((proposal) => {
        const mine = proposal.userId === meUserId;
        const characterName =
           sheets.find((sheet) => sheet.id === proposal.characterId)?.name ?? copy.character;
        const busy = busyId === proposal.id;
        return (
          <div
            key={proposal.id}
            className={cn(
              "flex flex-wrap items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs",
              mine
                ? "border-amber-700/70 bg-amber-950/40 text-amber-100"
                : "border-stone-800 bg-stone-950/60 text-stone-400",
            )}
          >
            <GameIcon icon={{ kind: "glyph", key: "tab-loot" }} size="size-6" />
            <span className="min-w-0 flex-1">
              {proposal.summary}
              {proposal.reason ? (
                <span className="text-stone-500"> ({proposal.reason})</span>
              ) : null}
            </span>
            {mine || steersStory ? (
              <span className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => resolve(proposal.id, "approve")}
                  disabled={busy}
                  className="flex items-center gap-1 rounded border border-emerald-800 px-2 py-0.5 text-[11px] text-emerald-300 hover:bg-emerald-950/50 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                   {copy.accept}
                </button>
                <button
                  type="button"
                  onClick={() => resolve(proposal.id, mine ? "decline" : "cancel")}
                  disabled={busy}
                  className="flex items-center gap-1 rounded border border-stone-700 px-2 py-0.5 text-[11px] text-stone-400 hover:bg-stone-900 disabled:opacity-50"
                >
                   <X className="size-3" /> {mine ? copy.decline : copy.withdraw}
                </button>
              </span>
            ) : (
              <span className="shrink-0 text-[11px] text-stone-600">
                 {copy.waiting} {characterName}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
