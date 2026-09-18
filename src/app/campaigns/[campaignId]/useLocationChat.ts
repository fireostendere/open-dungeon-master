"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { LocationCommandClient } from "@/lib/spatial/client-commands.mjs";
import type { SpatialPage, SpatialView } from "@/lib/spatial/store.mjs";

type Snapshot = { key: string; view: SpatialView; page: SpatialPage };
type CommandState = { identity: string; busy: boolean; pending: boolean; error: string };
const EMPTY: SpatialPage = { messages: [], nextBefore: null };
// Poll the authorized projection, not the campaign-wide event bus. Fetches
// are serial and abort on room/account changes; another room's result cannot
// overwrite the selected tab. No private prose is written to localStorage.
export function useLocationChat(campaignId: string, userId: string) {
  const [selected, setSelected] = useState<string | null>(null);
  const [before, setBefore] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const identity = `${campaignId}:${userId}`;
  const [loadError, setLoadError] = useState({ identity, text: "" });
  const [commandState, setCommandState] = useState<CommandState>({ identity, busy: false, pending: false, error: "" });
  const clientRef = useRef<LocationCommandClient | null>(null);
  const [version, setVersion] = useState(0);
  const key = `${campaignId}:${userId}:${selected ?? ""}:${before ?? "latest"}`;
  const endpoint = `/api/campaigns/${encodeURIComponent(campaignId)}/location-chat`;
  const refresh = useCallback(() => setVersion(value => value + 1), []);
  useEffect(() => {
    const client = new LocationCommandClient({ campaignId, userId });
    clientRef.current = client;
    return () => { client.dispose(); if (clientRef.current === client) clientRef.current = null; };
  }, [campaignId, userId]);
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let etag: string | null = null;
    async function poll() {
      try {
        const response = await fetch(endpoint + (selected ? `?roomId=${encodeURIComponent(selected)}${before ? `&beforeSeq=${before}` : ""}` : ""),
          { cache: "no-store", signal: abort.signal, headers: { "X-ODM-Actor": userId, ...(etag ? { "If-None-Match": etag } : {}) } });
        if (abort.signal.aborted) return;
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
        setLoadError({ identity, text: "" });
        if (data.enabled && selected === null) setSelected(data.current?.roomId ?? data.rooms[0]?.id ?? "ooc");
      } catch (cause) {
        if (!abort.signal.aborted) setLoadError({ identity, text: cause instanceof Error ? cause.message : "Unable to load location chat." });
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(poll, 2000);
      }
    }
    void poll();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [endpoint, selected, before, key, version, identity, userId]);

  const execute = useCallback(async (input?: Record<string, unknown>) => {
    const client = clientRef.current;
    // This also protects callbacks retained by the old screen before React's
    // effect cleanup has run. Never reinterpret old pending input as a new send.
    if (!client || client.identity !== identity || client.closed || client.busy) return false;
    const sync = (error = "") => {
      if (clientRef.current === client && !client.closed) {
        setCommandState({ identity, busy: client.busy, pending: Boolean(client.pending), error });
      }
    };
    try {
      const request = input === undefined ? client.retry() : client.command(input);
      sync();
      await request;
      if (clientRef.current !== client || client.closed) return false;
      sync(); refresh();
      return true;
    } catch (cause) { sync(cause instanceof Error ? cause.message : "Location command failed."); return false; }
  }, [identity, refresh]);
  const command = useCallback((input: Record<string, unknown>) => execute(input), [execute]);
  const retry = useCallback(() => execute(), [execute]);

  const select = useCallback((roomId: string) => { setBefore(null); setSelected(roomId); }, []);
  const older = () => { if (snapshot?.key === key && snapshot.page.nextBefore) setBefore(snapshot.page.nextBefore); };

  // A selected-tab switch temporarily hides the old tab's messages. Room
  // metadata may be reused within this identity, never across accounts.
  const sameIdentity = snapshot?.key.startsWith(`${campaignId}:${userId}:`);
  return { view: sameIdentity ? snapshot?.view ?? null : null,
    campaignId, userId,
    page: snapshot?.key === key ? snapshot.page : EMPTY, loading: !sameIdentity,
    selected, select,
    error: (commandState.identity === identity ? commandState.error : "") || (loadError.identity === identity ? loadError.text : ""),
    busy: commandState.identity === identity && commandState.busy, command, refresh, older,
    showingOlder: before !== null, newest: () => setBefore(null),
    pending: commandState.identity === identity && commandState.pending, retry };
}
export type LocationChatController = ReturnType<typeof useLocationChat>;
