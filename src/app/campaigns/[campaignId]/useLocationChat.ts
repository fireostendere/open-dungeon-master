"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import type { SpatialPage, SpatialView } from "@/lib/spatial/store.mjs";
import { LocationIntentSession, type IntentStatus } from "@/lib/spatial/client-intents";

type Snapshot = { key: string; identity: string; view: SpatialView; page: SpatialPage };
const EMPTY: SpatialPage = { messages: [], nextBefore: null };

export function useLocationChat(campaignId: string, userId: string, enabledHint = false) {
  const identity = JSON.stringify([campaignId, userId]);
  const [navigation, setNavigation] = useState<{ identity: string; selected: string | null; before: number | null }>({ identity, selected: null, before: null });
  const selected = navigation.identity === identity ? navigation.selected : null;
  const before = navigation.identity === identity ? navigation.before : null;
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [pollError, setPollError] = useState({ identity, message: "" });
  const [intentStatus, setIntentStatus] = useState<IntentStatus>({ identity, pending: false, busy: false, error: "" });
  const [version, setVersion] = useState(0);
  const pollingScope = JSON.stringify([identity, enabledHint]);
  const [pollingOverride, setPollingOverride] = useState<{ scope: string; enabled: boolean } | null>(null);
  const pollingEnabled = pollingOverride?.scope === pollingScope ? pollingOverride.enabled : enabledHint;
  const refresh = useCallback(() => setVersion(value => value + 1), []);
  const session = useMemo(() => new LocationIntentSession({ campaignId, userId, onSuccess: refresh }), [campaignId, userId, refresh]);
  const endpoint = session.endpoint;
  const key = JSON.stringify([campaignId, userId, selected, before, pollingScope]);

  // Runs on commit, before user events. Old callbacks keep the old, disposed
  // session and cannot retarget a pending draft to a new endpoint or account.
  useLayoutEffect(() => {
    session.activate();
    const unsubscribe = session.subscribe(setIntentStatus);
    return () => { unsubscribe(); session.dispose(); };
  }, [session]);

  useEffect(() => {
    if (!pollingEnabled) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let etag: string | null = null;
    let delay = 0, failures = 0;
    const current = () => session.active && !abort.signal.aborted;
    async function poll() {
      try {
        const query = new URLSearchParams();
        if (selected) query.set("roomId", selected);
        if (before) query.set("beforeSeq", String(before));
        if (etag) query.set("waitMs", "20000");
        const response = await fetch(endpoint + (query.size ? `?${query}` : ""), {
          cache: "no-store", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(25000)]),
          headers: { "X-ODM-Expected-User": userId, ...(etag ? { "If-None-Match": etag } : {}) },
        });
        if (!current()) return;
        // No sleep after a supported long poll. Older servers retain the
        // conservative polling interval instead of spinning on fast 304s.
        delay = response.headers.get("x-odm-long-poll") === "1" ? 0 : 2000;
        if (response.status === 304) { failures = 0; setPollError({ identity, message: "" }); return; }
        const data = await response.json();
        if (!current()) return;
        if (data?.code === "identity_changed" || [401, 403].includes(response.status)) {
          setSnapshot(null); session.dispose("Your account or access changed. Reload to continue."); return;
        }
        if (response.status === 404 && selected) {
          setNavigation({ identity, selected: null, before: null }); setSnapshot(null); return;
        }
        if (!response.ok) { setSnapshot(null); throw new Error(data.error || "Unable to load location chat."); }
        failures = 0; etag = response.headers.get("etag");
        if (data.enabled && selected && selected !== "ooc" && !data.rooms.some((room: { id: string }) => room.id === selected)) {
          setNavigation({ identity, selected: data.current?.roomId ?? "ooc", before: null }); return;
        }
        setSnapshot({ key, identity, view: data, page: { messages: data.messages ?? [], nextBefore: data.nextBefore ?? null } });
        setPollError({ identity, message: "" });
        if (data.enabled && selected === null) setNavigation({ identity, selected: data.current?.roomId ?? data.rooms[0]?.id ?? "ooc", before: null });
      } catch (cause) {
        delay = Math.min(30000, 1000 * 2 ** Math.min(++failures, 5));
        if (current()) setPollError({ identity, message: cause instanceof Error ? cause.message : "Unable to load location chat." });
      } finally { if (current()) timer = setTimeout(poll, delay); }
    }
    void poll();
    return () => { abort.abort(); if (timer) clearTimeout(timer); };
  }, [endpoint, selected, before, key, version, identity, session, userId, pollingEnabled]);

  const command = useCallback(async (input: Record<string, unknown>) => {
    const ok = await session.send(input);
    if (!ok) return false;
    if (input.operation === "enable") setPollingOverride({ scope: pollingScope, enabled: true });
    if (input.operation === "disable") {
      setPollingOverride({ scope: pollingScope, enabled: false });
      setSnapshot(null);
    }
    return true;
  }, [session, pollingScope, setPollingOverride, setSnapshot]);
  const retry = useCallback(() => session.retry(), [session]);
  const select = useCallback((roomId: string) => { if (session.active) setNavigation({ identity, selected: roomId, before: null }); }, [identity, session, setNavigation]);
  const older = () => { if (session.active && snapshot?.key === key && snapshot.page.nextBefore) setNavigation({ identity, selected, before: snapshot.page.nextBefore }); };
  const currentSnapshot = snapshot?.identity === identity && snapshot.key === key;
  const status = intentStatus.identity === identity ? intentStatus : null;
  return {
    view: pollingEnabled && currentSnapshot ? snapshot.view : null, campaignId, userId,
    page: pollingEnabled && currentSnapshot ? snapshot.page : EMPTY, loading: pollingEnabled && !currentSnapshot,
    selected, select, error: status?.error || (pollError.identity === identity ? pollError.message : ""),
    busy: status?.busy ?? false, command, refresh, older,
    showingOlder: before !== null,
    newest: () => { if (session.active) setNavigation({ identity, selected, before: null }); },
    pending: status?.pending ?? false, retry,
  };
}
export type LocationChatController = ReturnType<typeof useLocationChat>;
