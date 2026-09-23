"use client";

import { useCallback, useEffect, useRef, useState, type ComponentProps } from "react";
import { VoicePanel as VoiceControls } from "@/app/campaigns/[campaignId]/VoicePanelControls";
import { useI18n } from "@/lib/i18n/context";
import { localeText } from "@/lib/i18n/locale-text";
import type { VoiceRosterEntry } from "@/lib/voice/types";
import type { VoiceScope } from "@/lib/voice/location-policy";

type Snapshot = {
  scope: VoiceScope; mode: "sfu" | "mesh"; canManageScope: boolean;
  privateScopeAvailable: boolean; assignedLocation: boolean;
  peers: VoiceRosterEntry[];
};
// Keep the existing mic, PTT, device, volume and reconnect controls. The outer
// panel owns only the leader selector and an identity-bound roster projection.
export function VoicePanel(props: ComponentProps<typeof VoiceControls>) {
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: { label: "Voice channel", global: "Global party voice", location: "Private location rooms",
      note: "Only players in your current location can see and hear each other.",
      lead: "The party lead chooses the voice mode.", unavailable: "Private rooms need enabled SFU voice and campaign location mode.",
      unassigned: "No location assigned: you cannot hear or transmit to other rooms.",
      loading: "Loading voice access…", failed: "Could not refresh voice access.", saveFailed: "Could not change voice mode." },
    ru: { label: "Голосовой канал", global: "Общий голосовой чат", location: "Приватные комнаты по локациям",
      note: "Видны и слышны только игроки в вашей текущей локации.",
      lead: "Режим голосового чата выбирает лидер группы.", unavailable: "Для приватных комнат нужны включённый SFU и режим локаций кампании.",
      unassigned: "Локация не назначена: другие комнаты вам недоступны.",
      loading: "Проверка доступа к голосовому чату…", failed: "Не удалось обновить доступ к голосовому чату.", saveFailed: "Не удалось изменить режим чата." },
  });
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [stale, setStale] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const sequence = useRef(0);
  const serialized = useRef("");
  const alive = useRef(true);
  const refresh = useCallback(async () => {
    const requestId = ++sequence.current;
    try {
      const response = await fetch(`/api/campaigns/${props.campaignId}/voice`, { cache: "no-store" });
      if (!response.ok) throw new Error("Voice access denied");
      const data = await response.json() as Snapshot;
      if (!alive.current || requestId !== sequence.current) return;
      const next = JSON.stringify(data);
      if (next !== serialized.current) {
        serialized.current = next; setSnapshot(data); setRevision(value => value + 1);
      }
      setStale(false);
    } catch {
      if (alive.current && requestId === sequence.current) setStale(true);
    }
  }, [props.campaignId]);
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await refresh();
      if (!cancelled) timer = setTimeout(poll, 1000);
    };
    void poll();
    return () => { cancelled = true; alive.current = false; sequence.current++; clearTimeout(timer); };
  }, [refresh]);
  const changeScope = async (scope: VoiceScope) => {
    setSaving(true); setError("");
    try {
      const response = await fetch(`/api/campaigns/${props.campaignId}/voice/scope`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : copy.saveFailed);
      await refresh();
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : copy.saveFailed); }
    finally { if (alive.current) setSaving(false); }
  };
  const peers = stale ? [] : snapshot?.peers ?? [];
  // Do not render a speaking identity from an old/global stream projection.
  const speaking = peers.some(peer => peer.userId === props.speaking?.userId) ? props.speaking : null;
  return <section className="space-y-2" data-testid="location-voice">
    <div className="rounded-lg border border-stone-800 bg-stone-950/60 p-3">
      <label className="flex flex-wrap items-center gap-2 text-sm text-stone-200">
        {copy.label}
        <select aria-label={copy.label} value={snapshot?.scope ?? "global"}
          disabled={!snapshot?.canManageScope || saving || stale}
          onChange={event => void changeScope(event.target.value as VoiceScope)}
          className="min-w-0 max-w-full rounded border border-stone-700 bg-stone-950 p-2 disabled:opacity-60">
          <option value="global">{copy.global}</option>
          <option value="location" disabled={!snapshot?.privateScopeAvailable}>{copy.location}</option>
        </select>
      </label>
      <p className="mt-2 text-xs text-stone-400">{snapshot?.scope === "location" ? copy.note : copy.lead}</p>
      {snapshot && !snapshot.privateScopeAvailable ? <p className="mt-1 text-xs text-amber-300">{copy.unavailable}</p> : null}
      {snapshot?.scope === "location" && !snapshot.assignedLocation ? <p className="mt-1 text-xs text-amber-300">{copy.unassigned}</p> : null}
      {error || stale ? <p role="alert" className="mt-1 text-xs text-red-300">{error || copy.failed}</p> : null}
    </div>
    {snapshot ? <VoiceControls {...props} key={`${props.campaignId}:${snapshot.mode}`}
      roster={peers} speaking={speaking} steersStory={false}
      audibilityVersion={(props.audibilityVersion ?? 0) + revision} />
      : <p className="text-xs text-stone-400">{copy.loading}</p>}
  </section>;
}
