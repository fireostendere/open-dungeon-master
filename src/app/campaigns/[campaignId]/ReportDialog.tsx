"use client";

import { useInlineText } from "@/lib/i18n/inline-text";
import { Flag, Loader2, ShieldBan } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { Dialog } from "@/components/ui/Dialog";

export type ReportTarget = {
  // The message being flagged, or nothing when a player is reported as such.
  messageId?: string;
  // The author, when there is one to block. DM passages have no user.
  userId?: string;
  authorType: "player" | "dm";
  // What the dialog calls the thing: a character name, or "the Dungeon Master".
  label: string;
  // Open straight on the block confirmation, no report.
  mode?: "report" | "block";
};

const REASONS: Array<{ value: string; label: string }> = [
  { value: "harassment", label: "Harassment or bullying" },
  { value: "sexual", label: "Sexual content" },
  { value: "hate", label: "Hate or discrimination" },
  { value: "violence", label: "Graphic violence or threats" },
  { value: "spam", label: "Spam or off topic" },
  { value: "other", label: "Something else" },
];

// Flags a passage, a message or a player to this server's admins, with the
// option to block the player at the same time. There is no central service,
// so the operator of the server the player chose is who reads the report.
export function ReportDialog({
  campaignId,
  target,
  onClose,
  onBlocked,
}: {
  campaignId: string;
  target: ReportTarget | null;
  onClose: () => void;
  // The block landed; the caller hides that player's messages at once.
  onBlocked?: (userId: string) => void;
}) {
  const uiText = useInlineText();
  const [reason, setReason] = useState("harassment");
  const [details, setDetails] = useState("");
  const [block, setBlock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const blockOnly = target?.mode === "block";

  function close() {
    setReason("harassment");
    setDetails("");
    setBlock(false);
    setError("");
    setDone("");
    onClose();
  }

  async function blockUser(userId: string): Promise<boolean> {
    const response = await fetch("/api/profile/blocks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error || "Could not block that player.");
      return false;
    }
    onBlocked?.(userId);
    return true;
  }

  async function submit() {
    if (!target) return;
    setBusy(true);
    setError("");
    try {
      if (blockOnly) {
        if (target.userId && (await blockUser(target.userId))) {
          setDone(`${target.label} is blocked. Their messages are hidden from you, and neither of you can message or friend the other.`);
        }
        return;
      }
      const response = await fetch(`/api/campaigns/${campaignId}/reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messageId: target.messageId,
          userId: target.userId,
          reason,
          details,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "Could not send the report.");
        return;
      }
      if (block && target.userId && !(await blockUser(target.userId))) {
        return;
      }
      setDone(
        block && target.userId
          ? `Reported, and ${target.label} is blocked. The admins of this server will review it.`
          : "Reported. The admins of this server will review it.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={Boolean(target)}
      onOpenChange={(open) => !open && close()}
      title={blockOnly ? uiText("blockName", { name: target?.label ?? "" }) : uiText("reportName", { name: target?.label ?? "" })}
      icon={blockOnly ? <ShieldBan className="size-4 text-red-300" /> : <Flag className="size-4 text-amber-300" />}
    >
      {done ? (
        <div className="space-y-4">
          <p className="text-sm text-stone-300">{done}</p>
          <div className="flex justify-end">
            <button type="button" onClick={close} className={ui.btnPrimary}>
              {uiText("done")}
            </button>
          </div>
        </div>
      ) : blockOnly ? (
        <div className="space-y-4">
          <p className="text-sm leading-6 text-stone-400">
            {uiText("blockingPreventsYouFromSeeingTargetAposS", {
              target: target?.label ?? "",
            })}
          </p>
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={close} className={ui.btnSmall} disabled={busy}>
              {uiText("cancel")}
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className={cn(ui.btnPrimary, "from-red-200 via-red-300 to-red-500 text-red-950")}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldBan className="size-4" />}
              {uiText("block")}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm leading-6 text-stone-400">
            {target?.authorType === "dm"
              ? uiText("thisFlagsThePassageToTheAdminsOf")
              : uiText("thisFlagsTheMessageToTheAdminsOf")}
          </p>
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-xs uppercase tracking-wide text-stone-500">{uiText("reason")}</legend>
            {REASONS.map((entry) => (
              <label
                key={entry.value}
                className="flex cursor-pointer items-center gap-2 text-sm text-stone-300"
              >
                <input
                  type="radio"
                  name="report-reason"
                  value={entry.value}
                  checked={reason === entry.value}
                  onChange={() => setReason(entry.value)}
                  className="accent-amber-400"
                />
                {entry.label}
              </label>
            ))}
          </fieldset>
          <label className="block text-xs text-stone-400">
            {uiText("anythingTheAdminsShouldKnowOptional")}
            <textarea
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              rows={3}
              maxLength={2000}
              className={cn(ui.input, "mt-1 resize-y")}
            />
          </label>
          {target?.userId ? (
            <label className="flex cursor-pointer items-center gap-2 text-sm text-stone-300">
              <input
                type="checkbox"
                checked={block}
                onChange={(event) => setBlock(event.target.checked)}
                className="accent-amber-400"
              />
              {uiText("alsoBlock")} {target.label}
            </label>
          ) : null}
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={close} className={ui.btnSmall} disabled={busy}>
              {uiText("cancel")}
            </button>
            <button type="button" onClick={submit} disabled={busy} className={ui.btnPrimary}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Flag className="size-4" />}
              {uiText("sendReport")}
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
