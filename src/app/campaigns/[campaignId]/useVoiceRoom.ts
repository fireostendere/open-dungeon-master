"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Device } from "mediasoup-client";
import type { Consumer, Transport } from "mediasoup-client/types";
import { micBlockMessage, micBlockReason } from "@/lib/secure-context";
import type { VoiceRosterEntry } from "@/lib/voice/types";
import { DEFAULT_PEER_VOLUME, effectiveVolume, silenced, type VoiceVolumePrefs } from "@/lib/voice/volume";
import { PTT_KEY, readMicId, readMicMode, readVolumePrefs, subscribeMicPrefs, useVoiceVolumes,
  writeMicId, writeMicMode, type MicMode } from "@/app/campaigns/[campaignId]/useVoicePrefs";
import { registerOutput, releaseOutput, withMicGain } from "@/lib/audio-devices";
import { captureConstraints, DEFAULT_CALL_PREFERENCES, isTypingTarget, microphoneEnabled,
  readCallPreferences, subscribeCallPreferences } from "@/lib/voice/call-preferences";
import type { AudioStat } from "@/lib/voice/call-diagnostics";

export type VoiceStatus = "idle" | "connecting" | "connected" | "error" | "reconnecting";
export type { MicMode };
export { PTT_KEY };
function applyVolumes(elements: Map<string, HTMLAudioElement>, gains: Record<string, number>, prefs: VoiceVolumePrefs) {
  for (const [userId, element] of elements) {
    const peer = prefs.peers[userId] ?? DEFAULT_PEER_VOLUME;
    element.volume = effectiveVolume(gains[userId] ?? 1, peer, prefs);
    element.muted = silenced(peer, prefs.deafened);
  }
}
const stopStream = (stream: MediaStream | null) => stream?.getTracks().forEach(track => track.stop());

// One call controller, shared by the expanded and compact presentation. The
// server still decides membership, room access, floor control and subscriptions.
export function useVoiceRoom(campaignId: string, rosterFromStream: VoiceRosterEntry[] | null,
  mePeerId = "", audibilityVersion = 0, meshSignal: { to: string; version: number } | null = null) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [talking, setTalking] = useState(false);
  const [pending, setPending] = useState(false);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [probedPeers, setProbedPeers] = useState<VoiceRosterEntry[]>([]);
  const [available, setAvailable] = useState(false);
  const [unavailableReason, setUnavailableReason] = useState("");
  const [micDevices, setMicDevices] = useState<Array<{ deviceId: string; label: string }>>([]);
  const micId = useSyncExternalStore(subscribeMicPrefs, readMicId, () => "");
  const micMode = useSyncExternalStore(subscribeMicPrefs, readMicMode, () => "open" as MicMode);
  const preferences = useSyncExternalStore(subscribeCallPreferences, readCallPreferences, () => DEFAULT_CALL_PREFERENCES);
  const deviceRef = useRef<Device | null>(null);
  const sendRef = useRef<Transport | null>(null);
  const recvRef = useRef<Transport | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const producerRef = useRef<Awaited<ReturnType<Transport["produce"]>> | null>(null);
  const consumersRef = useRef(new Map<string, Consumer>());
  const resumeRef = useRef(new Set<string>());
  const elementsRef = useRef(new Map<string, HTMLAudioElement>());
  const gainsRef = useRef<Record<string, number>>({});
  const joinedRef = useRef(false);
  const busyRef = useRef(false);
  const disposedRef = useRef(false);
  const epochRef = useRef(0);
  const micSwapRef = useRef(0);
  const micQueueRef = useRef<Promise<void>>(Promise.resolve());
  const replacingStreamsRef = useRef(new Set<MediaStream>());
  const muteRef = useRef(false);
  const holdsRef = useRef(new Set<string>());
  const activeCaptureRef = useRef("");
  const activeModeRef = useRef<MicMode>("open");
  const stateQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const consumeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const modeRef = useRef<"sfu" | "mesh">("sfu");
  const joinTaskRef = useRef<Promise<void> | null>(null);
  type MeshConn = { pc: RTCPeerConnection; polite: boolean; makingOffer: boolean; ignoreOffer: boolean };
  const meshRef = useRef(new Map<string, MeshConn>());
  const iceRef = useRef<RTCIceServer[]>([]);
  const heartbeatRef = useRef(10_000);
  const isCurrent = useCallback((epoch: number) => !disposedRef.current && epochRef.current === epoch, []);

  const post = useCallback(async (path: string, body?: unknown) => {
    const response = await fetch(`/api/campaigns/${campaignId}/voice/${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Voice request failed.");
    return data;
  }, [campaignId]);
  const removeAudio = useCallback((userId: string) => {
    const consumer = consumersRef.current.get(userId);
    if (consumer) { resumeRef.current.delete(consumer.id); consumer.close(); consumersRef.current.delete(userId); }
    const element = elementsRef.current.get(userId);
    if (element) { element.pause(); element.srcObject = null; releaseOutput(element); elementsRef.current.delete(userId); }
  }, []);
  const teardown = useCallback(() => {
    joinedRef.current = false;
    holdsRef.current.clear();
    stopStream(streamRef.current); streamRef.current = null;
    for (const stream of replacingStreamsRef.current) stopStream(stream);
    replacingStreamsRef.current.clear();
    producerRef.current = null;
    sendRef.current?.close(); recvRef.current?.close();
    sendRef.current = null; recvRef.current = null; deviceRef.current = null;
    for (const conn of meshRef.current.values()) conn.pc.close();
    meshRef.current.clear();
    for (const userId of [...elementsRef.current.keys()]) removeAudio(userId);
    consumersRef.current.clear(); resumeRef.current.clear(); gainsRef.current = {};
  }, [removeAudio]);
  const playAudio = useCallback((element: HTMLAudioElement) => {
    const epoch = epochRef.current;
    void element.play().catch(() => { if (isCurrent(epoch) && element.srcObject) setPlaybackBlocked(true); });
  }, [isCurrent]);
  const attachAudio = useCallback((userId: string, track: MediaStreamTrack, consumer?: Consumer) => {
    removeAudio(userId);
    const element = registerOutput(new Audio());
    element.autoplay = true;
    element.srcObject = new MediaStream([track]);
    elementsRef.current.set(userId, element);
    if (consumer) consumersRef.current.set(userId, consumer);
    applyVolumes(elementsRef.current, gainsRef.current, readVolumePrefs());
    playAudio(element);
  }, [playAudio, removeAudio]);
  const unlockPlayback = useCallback(async () => {
    const results = await Promise.allSettled([...elementsRef.current.values()].map(element => element.play()));
    if (!disposedRef.current) setPlaybackBlocked(results.some(result => result.status === "rejected"));
  }, []);
  const refreshGains = useCallback(async () => {
    if (!joinedRef.current) return;
    const epoch = epochRef.current;
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/voice/audibility`, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) return;
      const data = await response.json();
      if (!isCurrent(epoch)) return;
      gainsRef.current = data.gains ?? {};
      applyVolumes(elementsRef.current, gainsRef.current, readVolumePrefs());
    } catch { /* A later roster/audibility event retries. Server gates actual media. */ }
  }, [campaignId, isCurrent]);
  const syncConsumers = useCallback(() => {
    const epoch = epochRef.current;
    const work = consumeQueueRef.current.catch(() => {}).then(async () => {
      const device = deviceRef.current, transport = recvRef.current;
      if (!isCurrent(epoch) || !joinedRef.current || !device || !transport) return;
      const { consumers } = await post("consume", { rtpCapabilities: device.rtpCapabilities });
      if (!isCurrent(epoch)) return;
      for (const params of consumers ?? []) {
        const consumer = await transport.consume({ id: params.id, producerId: params.producerId,
          kind: params.kind, rtpParameters: params.rtpParameters });
        if (!isCurrent(epoch)) { consumer.close(); return; }
        attachAudio(params.producerUserId, consumer.track, consumer);
        resumeRef.current.add(consumer.id);
      }
      const ids = [...resumeRef.current];
      if (ids.length && isCurrent(epoch)) {
        await post("resume", { consumerIds: ids });
        if (isCurrent(epoch)) for (const id of ids) resumeRef.current.delete(id);
      }
    });
    consumeQueueRef.current = work;
    return work;
  }, [attachAudio, isCurrent, post]);
  const postState = useCallback((body: { muted?: boolean; sayRange?: "whisper" | "normal" | "shout" }) => {
    const epoch = epochRef.current;
    const work = stateQueueRef.current.catch(() => {}).then(() => {
      if (isCurrent(epoch) && joinedRef.current) return post(modeRef.current === "mesh" ? "mesh/state" : "state", body);
    });
    stateQueueRef.current = work;
    return work;
  }, [isCurrent, post]);
  const applyMicrophone = useCallback(() => {
    const enabled = microphoneEnabled(muteRef.current, readMicMode(), holdsRef.current.size > 0);
    for (const stream of [streamRef.current, ...replacingStreamsRef.current]) {
      for (const track of stream?.getAudioTracks() ?? []) track.enabled = enabled;
    }
    if (joinedRef.current) void postState({ muted: !enabled }).catch(() => {
      if (!disposedRef.current) setError("Microphone state could not be confirmed. Retry or reconnect.");
    });
  }, [postState]);
  const meshSend = useCallback((to: string, data: unknown) => { void post("mesh/signal", { to, data }).catch(() => {}); }, [post]);
  const ensureMeshConn = useCallback((userId: string): MeshConn => {
    const existing = meshRef.current.get(userId);
    if (existing) return existing;
    const pc = new RTCPeerConnection({ iceServers: iceRef.current });
    const conn = { pc, polite: mePeerId > userId, makingOffer: false, ignoreOffer: false };
    const epoch = epochRef.current;
    meshRef.current.set(userId, conn);
    for (const track of streamRef.current?.getAudioTracks() ?? []) pc.addTrack(track, streamRef.current!);
    pc.ontrack = event => { if (isCurrent(epoch)) attachAudio(userId, event.track); };
    pc.onnegotiationneeded = async () => {
      try { conn.makingOffer = true; await pc.setLocalDescription();
        if (isCurrent(epoch) && pc.localDescription) meshSend(userId, { description: pc.localDescription });
      } catch { /* peer departed */ } finally { conn.makingOffer = false; }
    };
    pc.onicecandidate = event => { if (isCurrent(epoch) && event.candidate) meshSend(userId, { candidate: event.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => {
      if (!isCurrent(epoch) || !joinedRef.current) return;
      if (pc.connectionState === "failed") { setStatus("reconnecting"); pc.restartIce(); }
      else if (pc.connectionState === "connected" && !busyRef.current) setStatus("connected");
    };
    return conn;
  }, [attachAudio, isCurrent, mePeerId, meshSend]);
  const handleMeshSignal = useCallback(async (from: string, data: unknown) => {
    const note = data as { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
    const conn = ensureMeshConn(from), { pc } = conn;
    try {
      if (note?.description) {
        conn.ignoreOffer = !conn.polite && note.description.type === "offer" && (conn.makingOffer || pc.signalingState !== "stable");
        if (conn.ignoreOffer) return;
        await pc.setRemoteDescription(note.description);
        if (note.description.type === "offer") { await pc.setLocalDescription(); if (pc.localDescription) meshSend(from, { description: pc.localDescription }); }
      } else if (note?.candidate) {
        try { await pc.addIceCandidate(note.candidate); } catch (cause) { if (!conn.ignoreOffer) throw cause; }
      }
    } catch { /* A subsequent negotiation retries. */ }
  }, [ensureMeshConn, meshSend]);
  const drainMeshSignals = useCallback(async () => {
    if (!joinedRef.current || modeRef.current !== "mesh") return;
    const epoch = epochRef.current;
    try {
      const data = await post("mesh/heartbeat");
      if (!isCurrent(epoch)) return;
      for (const signal of data.signals ?? []) { if (!isCurrent(epoch)) return; await handleMeshSignal(String(signal.from ?? ""), signal.data); }
    } catch (cause) {
      if (isCurrent(epoch) && cause instanceof Error && cause.message.includes("Not on the call")) {
        teardown(); setError("The connection idled too long. Join again."); setStatus("error");
      }
    }
  }, [handleMeshSignal, isCurrent, post, teardown]);

  const join = useCallback(async (options?: { muted?: boolean }) => {
    if (joinedRef.current || busyRef.current || disposedRef.current) return;
    const blocked = micBlockReason();
    if (blocked) { setError(micBlockMessage(blocked)); setStatus("error"); return; }
    busyRef.current = true; setPending(true); setStatus("connecting"); setError(""); setPlaybackBlocked(false);
    const epoch = ++epochRef.current;
    const task = (async () => {
      let captured: MediaStream | null = null;
      let serverJoined = false;
      const current = () => { if (!isCurrent(epoch)) throw new DOMException("Call cancelled", "AbortError"); };
      try {
        await stateQueueRef.current.catch(() => {}); current();
        const savedMic = readMicId();
        captured = withMicGain(await navigator.mediaDevices.getUserMedia(captureConstraints(savedMic)));
        current();
        muteRef.current = readMicMode() === "ptt" ? false : (options?.muted ?? readCallPreferences().startMuted);
        holdsRef.current.clear();
        for (const track of captured.getAudioTracks()) track.enabled = microphoneEnabled(muteRef.current, readMicMode(), false);
        streamRef.current = captured;
        activeCaptureRef.current = JSON.stringify(captureConstraints(savedMic)); activeModeRef.current = readMicMode();
        if (modeRef.current === "mesh") {
          const data = await post("mesh/join"); serverJoined = true; current();
          iceRef.current = data.iceServers ?? []; heartbeatRef.current = Number(data.heartbeatMs) || 10_000;
          joinedRef.current = true;
          await postState({ muted: !captured.getAudioTracks()[0]?.enabled }); current();
          await refreshGains(); current();
          for (const peer of data.peers ?? []) if (peer.userId !== mePeerId) ensureMeshConn(peer.userId);
        } else {
          const { Device } = await import("mediasoup-client"); current();
          const data = await post("join"); serverJoined = true; current();
          const device = new Device(); await device.load({ routerRtpCapabilities: data.routerRtpCapabilities }); current();
          deviceRef.current = device; joinedRef.current = true;
          const send = device.createSendTransport(data.sendTransport), recv = device.createRecvTransport(data.recvTransport);
          sendRef.current = send; recvRef.current = recv;
          for (const transport of [send, recv]) {
            transport.on("connect", ({ dtlsParameters }, callback, errback) => {
              post("connect", { transportId: transport.id, dtlsParameters }).then(() => callback()).catch(cause => errback(cause as Error));
            });
            let restarting = false;
            transport.on("connectionstatechange", state => {
              if (!isCurrent(epoch) || !joinedRef.current) return;
              if (state === "connected" && !busyRef.current) setStatus("connected");
              if ((state === "failed" || state === "disconnected") && !restarting) {
                setStatus("reconnecting"); restarting = true;
                void post("ice-restart", { transportId: transport.id }).then(data => {
                  if (isCurrent(epoch) && !transport.closed) return transport.restartIce({ iceParameters: data.iceParameters });
                }).catch(() => {}).finally(() => { restarting = false; });
              }
            });
          }
          send.on("produce", ({ rtpParameters }, callback, errback) => {
            post("produce", { transportId: send.id, rtpParameters }).then(result => callback({ id: result.producerId })).catch(cause => errback(cause as Error));
          });
          producerRef.current = await send.produce({ track: captured.getAudioTracks()[0] }); current();
          await postState({ muted: !captured.getAudioTracks()[0]?.enabled }); current();
          await refreshGains(); current(); await syncConsumers(); current();
        }
        setMuted(muteRef.current); setTalking(false); setHandRaised(false); setStartedAt(Date.now()); setStatus("connected");
      } catch (cause) {
        stopStream(captured);
        if (isCurrent(epoch)) { teardown(); setError(cause instanceof Error ? cause.message : "Could not join voice chat."); setStatus("error"); }
        // A cancelled HTTP join may still have created a server peer. New joins
        // stay locked until cleanup finishes, so this cannot remove a newer call.
        if (serverJoined) await post(modeRef.current === "mesh" ? "mesh/leave" : "leave").catch(() => {});
      } finally {
        busyRef.current = false;
        if (!disposedRef.current) setPending(false);
      }
    })();
    joinTaskRef.current = task;
    await task;
    if (joinTaskRef.current === task) joinTaskRef.current = null;
  }, [ensureMeshConn, isCurrent, mePeerId, post, postState, refreshGains, syncConsumers, teardown]);
  const leave = useCallback(async () => {
    const wasJoined = joinedRef.current;
    ++epochRef.current; ++micSwapRef.current;
    teardown(); setStatus("idle"); setStartedAt(null); setTalking(false); setError(""); setPlaybackBlocked(false);
    // Pending join cleans up its own eventual response. Do not remove a peer
    // while that operation is still creating transports.
    if (joinTaskRef.current) { await joinTaskRef.current; return; }
    if (wasJoined) {
      busyRef.current = true; setPending(true);
      await stateQueueRef.current.catch(() => {});
      await post(modeRef.current === "mesh" ? "mesh/leave" : "leave").catch(() => {});
      busyRef.current = false; if (!disposedRef.current) setPending(false);
    }
  }, [post, teardown]);
  const toggleMute = useCallback(async () => {
    muteRef.current = !muteRef.current; setMuted(muteRef.current); applyMicrophone();
    // Never visually undo a local privacy mute after a network failure.
  }, [applyMicrophone]);
  const setTalking_ = useCallback((held: boolean, source = "pointer") => {
    if (held && (!joinedRef.current || readMicMode() !== "ptt")) return;
    if (held) holdsRef.current.add(source); else holdsRef.current.delete(source);
    setTalking(holdsRef.current.size > 0); applyMicrophone();
  }, [applyMicrophone]);
  const releaseTalking = useCallback(() => { holdsRef.current.clear(); setTalking(false); applyMicrophone(); }, [applyMicrophone]);
  const setSayRange = useCallback(async (sayRange: "whisper" | "normal" | "shout") => { await postState({ sayRange }).catch(() => {}); }, [postState]);
  const selectMic = useCallback((deviceId: string) => writeMicId(deviceId), []);
  const selectMicMode = useCallback((mode: MicMode) => writeMicMode(mode), []);
  const swapMic = useCallback((deviceId: string) => {
    const epoch = epochRef.current, revision = ++micSwapRef.current;
    const requested = readCallPreferences();
    // Serialize replaceTrack as well as capture. A late device switch must not
    // replace the track installed by a newer request or reopen a muted mic.
    const work = micQueueRef.current.catch(() => {}).then(async () => {
      if (!joinedRef.current || !isCurrent(epoch) || revision !== micSwapRef.current) return;
      let stream: MediaStream | null = null;
      try {
        stream = withMicGain(await navigator.mediaDevices.getUserMedia(captureConstraints(deviceId, true, requested)));
        if (!isCurrent(epoch) || revision !== micSwapRef.current) { stopStream(stream); return; }
        replacingStreamsRef.current.add(stream);
        const track = stream.getAudioTracks()[0];
        track.enabled = microphoneEnabled(muteRef.current, readMicMode(), holdsRef.current.size > 0);
        if (producerRef.current) await producerRef.current.replaceTrack({ track });
        if (!isCurrent(epoch)) { stopStream(stream); return; }
        for (const conn of meshRef.current.values()) {
          const sender = conn.pc.getSenders().find(entry => entry.track?.kind === "audio");
          if (sender) await sender.replaceTrack(track);
        }
        if (!isCurrent(epoch)) { stopStream(stream); return; }
        // Keep this intermediate working capture until the next queued switch
        // succeeds; stopping it on supersession would leave a dead sender.
        stopStream(streamRef.current); streamRef.current = stream;
        activeCaptureRef.current = JSON.stringify(captureConstraints(deviceId, false, requested));
        applyMicrophone();
      } catch {
        if (stream !== streamRef.current) stopStream(stream);
        if (isCurrent(epoch)) setError("Could not switch microphone. Retry or reconnect if audio stopped.");
      } finally {
        if (stream) replacingStreamsRef.current.delete(stream);
      }
    });
    micQueueRef.current = work;
    return work;
  }, [applyMicrophone, isCurrent]);
  const captureKey = JSON.stringify(captureConstraints(micId, false, preferences));
  useEffect(() => {
    if (joinedRef.current && captureKey !== activeCaptureRef.current) void swapMic(micId);
  }, [captureKey, micId, swapMic]);
  useEffect(() => {
    if (micMode === activeModeRef.current) return;
    activeModeRef.current = micMode;
    const timer = setTimeout(releaseTalking, 0);
    return () => clearTimeout(timer);
  }, [micMode, releaseTalking]);
  const toggleHand = useCallback(async () => {
    const entry = (rosterFromStream ?? probedPeers).find(peer => peer.userId === mePeerId);
    const next = !(entry ? Boolean(entry.handRaisedAt) : handRaised); setHandRaised(next);
    try { await post("hand", { raised: next }); } catch { if (!disposedRef.current) setHandRaised(!next); }
  }, [handRaised, mePeerId, post, probedPeers, rosterFromStream]);
  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    if (!disposedRef.current) setMicDevices(devices.filter(d => d.kind === "audioinput").map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` })));
  }, []);
  useEffect(() => {
    void refreshDevices();
    navigator.mediaDevices?.addEventListener("devicechange", refreshDevices);
    return () => navigator.mediaDevices?.removeEventListener("devicechange", refreshDevices);
  }, [refreshDevices, status]);
  useEffect(() => {
    if (micMode !== "ptt" || (status !== "connected" && status !== "reconnecting")) return;
    const down = (event: KeyboardEvent) => {
      if (event.code !== preferences.pttKey || event.repeat || event.ctrlKey || event.altKey || event.metaKey || isTypingTarget(event.target)) return;
      event.preventDefault(); setTalking_(true, "key");
    };
    const up = (event: KeyboardEvent) => { if (event.code === preferences.pttKey) setTalking_(false, "key"); };
    const visibility = () => { if (document.hidden) releaseTalking(); };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    window.addEventListener("blur", releaseTalking); document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("keydown", down); window.removeEventListener("keyup", up);
      window.removeEventListener("blur", releaseTalking); document.removeEventListener("visibilitychange", visibility);
      holdsRef.current.clear(); applyMicrophone();
      if (!disposedRef.current) setTalking(false);
    };
  }, [applyMicrophone, micMode, preferences.pttKey, releaseTalking, setTalking_, status]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/campaigns/${campaignId}/voice`, { signal: controller.signal }).then(r => r.ok ? r.json() : null).then(data => {
      if (controller.signal.aborted || !data) return;
      setAvailable(Boolean(data.available)); setUnavailableReason(String(data.unavailableReason ?? ""));
      setProbedPeers(data.peers ?? []); modeRef.current = data.mode === "mesh" ? "mesh" : "sfu";
    }).catch(() => {});
    return () => controller.abort();
  }, [campaignId]);
  useEffect(() => { if (audibilityVersion > 0) void refreshGains(); }, [audibilityVersion, refreshGains]);
  useEffect(() => {
    if (!rosterFromStream || !joinedRef.current) return;
    const present = new Set(rosterFromStream.filter(peer => peer.producing).map(peer => peer.userId));
    for (const userId of [...elementsRef.current.keys()]) if (!present.has(userId)) removeAudio(userId);
    for (const [userId, conn] of meshRef.current) {
      if (!rosterFromStream.some(peer => peer.userId === userId)) { conn.pc.close(); meshRef.current.delete(userId); }
    }
    if (modeRef.current === "sfu") void syncConsumers().catch(() => {});
  }, [removeAudio, rosterFromStream, syncConsumers]);
  useEffect(() => {
    if (meshSignal?.to === mePeerId && meshSignal.version > 0) void drainMeshSignals();
  }, [drainMeshSignals, mePeerId, meshSignal]);
  useEffect(() => {
    if ((status !== "connected" && status !== "reconnecting") || modeRef.current !== "mesh") return;
    const timer = setInterval(() => void drainMeshSignals(), heartbeatRef.current);
    return () => clearInterval(timer);
  }, [drainMeshSignals, status]);
  useEffect(() => {
    disposedRef.current = false;
    const unload = () => {
      const wasJoined = joinedRef.current;
      ++epochRef.current; teardown();
      if (wasJoined) void fetch(`/api/campaigns/${campaignId}/voice/${modeRef.current === "mesh" ? "mesh/leave" : "leave"}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", keepalive: true,
      }).catch(() => {});
    };
    window.addEventListener("pagehide", unload);
    return () => { disposedRef.current = true; window.removeEventListener("pagehide", unload); unload(); };
  }, [campaignId, teardown]);
  const getMicrophoneStream = useCallback(() => streamRef.current, []);
  const getStats = useCallback(async (): Promise<AudioStat[]> => {
    const rows: AudioStat[] = [];
    const sources = modeRef.current === "sfu" ? [sendRef.current, recvRef.current].filter((v): v is Transport => Boolean(v))
      : [...meshRef.current.values()].map(conn => conn.pc);
    await Promise.all(sources.map(async (source, index) => {
      try { const report = await source.getStats(); report.forEach(stat => rows.push({ ...stat, id: `${index}:${stat.id}` })); } catch { /* closed transport */ }
    }));
    return rows;
  }, []);
  const peers = rosterFromStream ?? probedPeers;
  const myEntry = peers.find(peer => peer.userId === mePeerId);
  const presentIds = useMemo(() => peers.map(peer => peer.userId), [peers]);
  const volumes = useVoiceVolumes(presentIds);
  useEffect(() => { applyVolumes(elementsRef.current, gainsRef.current, volumes.prefs); }, [volumes.prefs]);
  return {
    status, error, muted, pending, startedAt, playbackBlocked, unlockPlayback, getMicrophoneStream, getStats,
    handRaised: myEntry ? Boolean(myEntry.handRaisedAt) : handRaised, toggleHand,
    sayRange: myEntry?.sayRange ?? "normal", setSayRange, micDevices, refreshDevices, micId, selectMic,
    micMode, selectMicMode, talking, setTalking: setTalking_, reconnecting: status === "reconnecting",
    peers, available, unavailableReason, join, leave, toggleMute, connected: status === "connected",
    peerVolume: volumes.peerVolume, setPeerVolume: volumes.setPeerVolume, togglePeerMute: volumes.togglePeerMute,
    resetPeerVolume: volumes.resetPeer, masterVolume: volumes.prefs.master, setMasterVolume: volumes.setMaster,
    deafened: volumes.prefs.deafened, toggleDeafen: volumes.toggleDeafen,
  };
}
