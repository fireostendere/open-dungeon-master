"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { VoicePanel as VoiceControls, type VoicePanelProps } from "./VoicePanelControls";
import { useI18n } from "@/lib/i18n/context";
import { localeText } from "@/lib/i18n/locale-text";
import { voiceCopy } from "./voice-copy";
import type { VoiceAccessSnapshot } from "@/lib/voice/call-types";
import s from "./VoiceCall.module.css";

// Remount the entire identity-bound session, not just its roster, on account
// changes. The mounted dock may survive navigation/login changes.
export function VoicePanel(props: VoicePanelProps) {
  return <VoicePanelSession key={`${props.campaignId}:${props.meUserId}`} {...props} />;
}
function VoicePanelSession(props: VoicePanelProps) {
  const { locale } = useI18n(); const copy = localeText(locale, voiceCopy);
  const [snapshot, setSnapshot] = useState<VoiceAccessSnapshot | null>(null);
  const [stale, setStale] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const serial = useRef(0), serialized = useRef("");
  const alive = useRef(true), writing = useRef(false), controller = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    const sequence = ++serial.current;
    const timeout = setTimeout(() => request.abort(), 10_000);
    try {
      const response = await fetch(`/api/campaigns/${props.campaignId}/voice`, { cache: "no-store", signal: request.signal });
      if (!response.ok) throw new Error("Voice access denied");
      const data = await response.json() as VoiceAccessSnapshot;
      if (!alive.current || sequence !== serial.current) return;
      if (!Array.isArray(data.peers) || (data.scope !== "global" && data.scope !== "location") || (data.mode !== "sfu" && data.mode !== "mesh")) throw new Error("Invalid voice snapshot");
      const next = JSON.stringify(data);
      if (next !== serialized.current) { serialized.current = next; setSnapshot(data); setRevision(value => value + 1); }
      setStale(false);
    } catch { if (alive.current && sequence === serial.current) setStale(true); }
    finally { clearTimeout(timeout); }
  }, [props.campaignId]);
  useEffect(() => {
    alive.current = true;
    let cancelled = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => { await refresh(); if (!cancelled) timer = setTimeout(poll, 1000); };
    void poll();
    return () => { cancelled = true; alive.current = false; ++serial.current; controller.current?.abort(); clearTimeout(timer); };
  }, [refresh]);
  const changeScope = async (scope: "global" | "location") => {
    if (writing.current || !snapshot?.canManageScope || stale || scope === snapshot.scope) return;
    writing.current = true; setSaving(true); setError("");
    try {
      const response = await fetch(`/api/campaigns/${props.campaignId}/voice/scope`, { method: "PATCH",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope }), signal: AbortSignal.timeout(15_000) });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : copy.scopeFailed);
      if (alive.current) await refresh();
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : copy.scopeFailed); }
    finally { writing.current = false; if (alive.current) setSaving(false); }
  };
  // A failed refresh hides identities in the presentation but does not pretend
  // the authoritative roster is empty, which would destroy healthy consumers.
  // Revocation remains enforced by the SFU independently of this request.
  return snapshot ? <VoiceControls {...props} key={`${snapshot.mode}:${snapshot.available}`}
    access={snapshot} roster={snapshot.peers} stale={stale} scopeBusy={saving} scopeError={error}
    speaking={snapshot.peers.some(peer => peer.userId === props.speaking?.userId) ? props.speaking : null}
    audibilityVersion={(props.audibilityVersion ?? 0) + revision}
    onScopeChange={scope => void changeScope(scope)} onRefresh={() => void refresh()} />
    : <section className={s.call} aria-label={copy.title}><div className={s.empty} role="status"><h2>{copy.title}</h2>
      <p>{stale ? copy.stale : copy.loading}</p>{stale ? <button type="button" className={s.button} onClick={() => void refresh()}>{copy.refresh}</button> : null}</div></section>;
}
