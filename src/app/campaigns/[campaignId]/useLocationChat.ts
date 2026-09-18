"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SpatialPage, SpatialView } from "@/lib/spatial/store.mjs";

type Snapshot = { key: string; view: SpatialView; page: SpatialPage };
type Pending = { requestId: string; input: Record<string, unknown>; identity: string };
const EMPTY: SpatialPage = { messages: [], nextBefore: null };
// Poll the authorized projection, not the campaign-wide event bus. Fetches
// are serial and abort on room/account changes; another room's result cannot
// overwrite the selected tab. No private prose is written to localStorage.
export function useLocationChat(campaignId: string, userId: string) {
  const [selected, setSelected] = useState<string | null>(null);
  const [before, setBefore] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const busyRef = useRef(false);
  const [version, setVersion] = useState(0);
  const key = `${campaignId}:${userId}:${selected ?? ""}:${before ?? "latest"}`;
  const endpoint = `/api/campaigns/${encodeURIComponent(campaignId)}/location-chat`;
  const refresh = useCallback(() => setVersion(value => value + 1), []);
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let etag: string | null = null;
    async function poll() {
      try {
        const response = await fetch(endpoint + (selected ? `?roomId=${encodeURIComponent(selected)}${before ? `&beforeSeq=${before}` : ""}` : ""),
          { cache: "no-store", signal: abort.signal, headers: etag ? { "If-None-Match": etag } : {} });
        if (response.status === 304) return;
        if (response.status === 404 && selected) { setSelected(null); setBefore(null); setSnapshot(null); return; }
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to load location chat.");
        if (abort.signal.aborted) return;
        etag = response.headers.get("etag");
        if (data.enabled && selected && selected !== "ooc" && !data.rooms.some((room: { id: string }) => room.id === selected)) {
          setSelected(data.current?.roomId ?? "ooc");
          return;
        }
        setSnapshot({ key, view: data, page: { messages: data.messages ?? [], nextBefore: data.nextBefore ?? null } });
        setError("");
        if (data.enabled && selected === null) setSelected(data.current?.roomId ?? data.rooms[0]?.id ?? "ooc");
      } catch (cause) {
        if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to load location chat.");
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(poll, 2000);
      }
    }
    void poll();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [endpoint, selected, before, key, version]);

  const command = useCallback(async (input: Record<string, unknown>) => {
    if (busyRef.current) return false;
    const previous = pendingRef.current?.identity === `${campaignId}:${userId}` ? pendingRef.current : null;
    if (previous && JSON.stringify(previous.input) !== JSON.stringify(input)) {
      setError("Retry the unconfirmed command before submitting another one."); return false;
    }
    const attempt = previous ?? { requestId: crypto.randomUUID(), input, identity: `${campaignId}:${userId}` };
    pendingRef.current = attempt; setPending(attempt);
    busyRef.current = true; setBusy(true); setError("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...attempt.input, requestId: attempt.requestId }) });
      const data = await response.json();
      if (!response.ok) {
        // Explicit client rejection is definite. Network/5xx failures may
        // have committed; retain the UUID and exact payload for manual retry.
        if (response.status < 500) { pendingRef.current = null; setPending(null); }
        throw new Error(data.error || "Location command failed.");
      }
      pendingRef.current = null; setPending(null);
      refresh();
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Location command failed."); return false; }
    finally { busyRef.current = false; setBusy(false); }
  }, [campaignId, endpoint, refresh, userId]);

  const select = useCallback((roomId: string) => { setBefore(null); setSelected(roomId); }, []);
  const older = () => { if (snapshot?.key === key && snapshot.page.nextBefore) setBefore(snapshot.page.nextBefore); };

  // A selected-tab switch temporarily hides the old tab's messages. Room
  // metadata may be reused within this identity, never across accounts.
  const sameIdentity = snapshot?.key.startsWith(`${campaignId}:${userId}:`);
  return { view: sameIdentity ? snapshot?.view ?? null : null,
    campaignId, userId,
    page: snapshot?.key === key ? snapshot.page : EMPTY, loading: !sameIdentity,
    selected, select, error, busy, command, refresh, older,
    showingOlder: before !== null, newest: () => setBefore(null),
    pending: Boolean(pending), retry: () => pendingRef.current ? command(pendingRef.current.input) : Promise.resolve(false) };
}
export type LocationChatController = ReturnType<typeof useLocationChat>;
