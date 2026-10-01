"use client";

import { useInlineText } from "@/lib/i18n/inline-text";
import { Check, Loader2, Undo2 } from "lucide-react";
import { GameIcon } from "@/components/ui/GameIcon";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";

type Report = {
  id: string;
  campaignId: string;
  campaignName: string;
  reporterUsername: string;
  messageId: string | null;
  reportedUserId: string | null;
  reportedUsername: string | null;
  authorType: "player" | "dm" | "system";
  reason: string;
  details: string;
  excerpt: string;
  status: "open" | "resolved";
  createdAt: string;
  resolvedAt: string | null;
};

const REASON_LABEL: Record<string, string> = {
  harassment: "Harassment",
  sexual: "Sexual content",
  hate: "Hate",
  violence: "Violence or threats",
  spam: "Spam",
  other: "Other",
};

// The moderation queue: what players flagged, with the text as it read
// when they flagged it. Acting on a report happens elsewhere (the Users
// tab deletes accounts, the party lead mutes); this is where it is read
// and closed.
export function AdminReportsPanel() {
  const uiText = useInlineText();
  const [reports, setReports] = useState<Report[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    fetch(`/api/admin/reports${showAll ? "?status=all" : ""}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setReports(data?.reports ?? null));
  }, [showAll]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function setStatus(report: Report, status: "open" | "resolved") {
    setBusyId(report.id);
    setError("");
    try {
      const response = await fetch(`/api/admin/reports/${report.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setError(data?.error || "That didn't work.");
        return;
      }
      refresh();
    } finally {
      setBusyId(null);
    }
  }

  if (!reports) {
    return <Loader2 className="size-5 animate-spin text-stone-500" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-stone-400">
          {uiText("Players flag Dungeon Master passages, messages and other players from the table. Reports come to this server only; there is no central moderation behind the app.")}
        </p>
        <label className="flex items-center gap-2 text-xs text-stone-400">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(event) => setShowAll(event.target.checked)}
            className="accent-amber-400"
          />
          {uiText("Show resolved")}
        </label>
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      {reports.length === 0 ? (
        <p className="text-sm text-stone-500">
          {showAll ? uiText("No reports yet.") : uiText("Nothing waiting. Open reports show up here.")}
        </p>
      ) : (
        <section className={cn(ui.card, "texture-noise")}>
          <ul className="divide-y divide-stone-800/70">
            {reports.map((report) => (
              <li key={report.id} className="space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-2 text-sm text-stone-100">
                  <GameIcon icon={{ kind: "glyph", key: report.status === "open" ? "quest-active" : "quest-done" }} size="size-6" />
                  <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-300">
                    {REASON_LABEL[report.reason] ?? report.reason}
                  </span>
                  <span>
                    {report.authorType === "dm"
                      ? uiText("Dungeon Master passage")
                      : report.reportedUsername
                        ? `${uiText("Player")} ${report.reportedUsername}`
                        : uiText("Player (account deleted)")}
                  </span>
                  <span className="text-xs text-stone-500">
                    {uiText("Campaign:")} {" "}
                    <Link
                      href={`/campaigns/${report.campaignId}`}
                      className="text-amber-200 hover:text-amber-100"
                    >
                      {report.campaignName}
                    </Link>
                    {" "}{uiText("· reported by")} {report.reporterUsername} ·{" "}
                    {new Date(report.createdAt).toLocaleString()}
                  </span>
                </div>
                {report.excerpt ? (
                  <blockquote className="whitespace-pre-wrap rounded-md border border-stone-800 bg-stone-950/60 px-3 py-2 text-sm text-stone-300">
                    {report.excerpt}
                  </blockquote>
                ) : null}
                {report.details ? (
                  <p className="text-sm text-stone-400">
                    <span className="text-stone-500">{uiText("Reporter says:")}</span> {report.details}
                  </p>
                ) : null}
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  {report.status === "open" ? (
                    <button
                      type="button"
                      disabled={busyId === report.id}
                      onClick={() => setStatus(report, "resolved")}
                      className={ui.btnSmall}
                    >
                      <Check className="size-3.5" /> {uiText("Mark resolved")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busyId === report.id}
                      onClick={() => setStatus(report, "open")}
                      className={ui.btnSmall}
                    >
                      <Undo2 className="size-3.5" /> {uiText("Reopen")}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
