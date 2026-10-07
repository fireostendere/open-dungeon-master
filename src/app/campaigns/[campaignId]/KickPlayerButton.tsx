"use client";

import { UserMinus } from "lucide-react";
import { useState } from "react";
import type { CampaignMember } from "@/lib/campaign-types";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";

export function KickPlayerButton({ campaignId, member }: { campaignId: string; member: CampaignMember }) {
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: { label: "Kick player", confirm: `Kick ${member.username} from this campaign? They will lose access. Their character and history will be kept.`, failed: "Could not kick the player.", server: "Could not reach the server." },
    ru: { label: "Кикнуть игрока", confirm: `Кикнуть ${member.username} из кампании? Игрок потеряет доступ. Персонаж и история сохранятся.`, failed: "Не удалось кикнуть игрока.", server: "Не удалось связаться с сервером." },
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function kick() {
    if (!window.confirm(copy.confirm)) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/members/${member.userId}`, { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || copy.failed);
      }
    } catch {
      setError(copy.server);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-w-0">
      <button type="button" disabled={busy} onClick={() => void kick()}
        className="inline-flex items-center gap-1 rounded-md border border-red-900/70 px-2 py-1 text-[11px] text-red-400 hover:bg-red-950/40 disabled:opacity-40">
        <UserMinus className="size-3 shrink-0" /> {copy.label}
      </button>
      {error ? <p role="alert" className="mt-1 text-xs text-red-400">{error}</p> : null}
    </div>
  );
}
