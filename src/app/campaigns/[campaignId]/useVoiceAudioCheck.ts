"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { registerOutput, releaseOutput, withMicGain } from "@/lib/audio-devices";
import { captureConstraints } from "@/lib/voice/call-preferences";

// The preview owns only its own capture. Closing it can never stop the live call.
export function useVoiceAudioCheck(visible: boolean, connected: boolean, microphoneId: string,
  getCallStream: () => MediaStream | null) {
  const [testing, setTesting] = useState(false), [requesting, setRequesting] = useState(false);
  const [monitoring, setMonitoring] = useState(false), [error, setError] = useState("");
  const [level, setLevel] = useState(0);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const preview = useRef<MediaStream | null>(null), monitor = useRef<HTMLAudioElement | null>(null);
  const generation = useRef(0), alive = useRef(true);
  const stopTone = useRef<(() => void) | null>(null);
  const releaseMonitor = useCallback(() => {
    if (monitor.current) { monitor.current.pause(); monitor.current.srcObject = null; releaseOutput(monitor.current); monitor.current = null; }
  }, []);
  const stop = useCallback(() => {
    ++generation.current; releaseMonitor();
    preview.current?.getTracks().forEach(track => track.stop()); preview.current = null;
    if (alive.current) { setTesting(false); setRequesting(false); setMonitoring(false); setLevel(0); }
  }, [releaseMonitor]);
  const refresh = useCallback(async () => {
    const found = await navigator.mediaDevices?.enumerateDevices().catch(() => []);
    if (alive.current) setDevices(found ?? []);
  }, []);
  const start = useCallback(async () => {
    stop(); const run = generation.current; setRequesting(true); setError("");
    try {
      const raw = await navigator.mediaDevices.getUserMedia(captureConstraints(microphoneId));
      if (!alive.current || run !== generation.current) { raw.getTracks().forEach(track => track.stop()); return; }
      preview.current = withMicGain(raw); setTesting(true); await refresh();
    } catch (cause) { if (alive.current && run === generation.current) setError(cause instanceof Error ? cause.message : "Microphone unavailable"); }
    finally { if (alive.current && run === generation.current) setRequesting(false); }
  }, [microphoneId, refresh, stop]);
  const toggleMonitor = useCallback(async () => {
    if (monitor.current) { releaseMonitor(); setMonitoring(false); return; }
    if (!preview.current) return;
    const element = registerOutput(new Audio()); element.srcObject = preview.current; element.volume = 0.5; monitor.current = element;
    try { await element.play(); if (monitor.current === element) setMonitoring(true); }
    catch (cause) { releaseMonitor(); setError(cause instanceof Error ? cause.message : "Playback blocked"); }
  }, [releaseMonitor]);
  const testOutput = useCallback(async () => {
    stopTone.current?.(); setError("");
    let context: AudioContext | null = null, element: HTMLAudioElement | null = null;
    try {
      context = new AudioContext();
      const destination = context.createMediaStreamDestination(), gain = context.createGain(), oscillator = context.createOscillator();
      oscillator.frequency.value = 660; oscillator.connect(gain); gain.connect(destination);
      gain.gain.setValueAtTime(0, context.currentTime); gain.gain.linearRampToValueAtTime(0.08, context.currentTime + 0.03);
      gain.gain.setValueAtTime(0.08, context.currentTime + 0.35); gain.gain.linearRampToValueAtTime(0, context.currentTime + 0.5);
      element = registerOutput(new Audio()); element.srcObject = destination.stream;
      const audio = element, audioContext = context;
      let timer: ReturnType<typeof setTimeout>;
      const cleanup = () => { clearTimeout(timer); audio.pause(); audio.srcObject = null; releaseOutput(audio);
        destination.stream.getTracks().forEach(track => track.stop()); void audioContext.close().catch(() => {});
        if (stopTone.current === cleanup) stopTone.current = null; };
      stopTone.current = cleanup; timer = setTimeout(cleanup, 1500);
      await context.resume(); await element.play(); oscillator.start(); oscillator.stop(context.currentTime + 0.55);
    } catch (cause) {
      stopTone.current?.(); if (context) void context.close().catch(() => {}); if (element) releaseOutput(element);
      if (alive.current) setError(cause instanceof Error ? cause.message : "Playback unavailable");
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    void refresh(); navigator.mediaDevices?.addEventListener("devicechange", refresh);
    return () => { alive.current = false; stop(); stopTone.current?.(); navigator.mediaDevices?.removeEventListener("devicechange", refresh); };
  }, [refresh, stop]);
  useEffect(() => { const timer = setTimeout(stop, 0); return () => clearTimeout(timer); }, [microphoneId, stop]);
  useEffect(() => {
    if (visible && !connected) return;
    const timer = setTimeout(() => { stop(); stopTone.current?.(); }, 0);
    return () => clearTimeout(timer);
  }, [connected, stop, visible]);
  useEffect(() => {
    if (!visible) return;
    let context: AudioContext | null = null, stream: MediaStream | null = null, analyser: AnalyserNode | null = null;
    let timer: ReturnType<typeof setTimeout>, cancelled = false;
    const samples = new Float32Array(256);
    const tick = () => {
      if (cancelled) return;
      const next = connected ? getCallStream() : preview.current;
      if (next !== stream) {
        if (context) void context.close().catch(() => {});
        context = null; analyser = null; stream = next;
        if (next && typeof AudioContext !== "undefined") {
          try { context = new AudioContext(); analyser = context.createAnalyser(); analyser.fftSize = samples.length;
            context.createMediaStreamSource(next).connect(analyser); void context.resume().catch(() => {});
          } catch { analyser = null; }
        }
      }
      let rms = 0;
      if (analyser && next?.getAudioTracks().some(track => track.enabled && track.readyState === "live")) {
        analyser.getFloatTimeDomainData(samples);
        rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
      }
      setLevel(Math.min(1, Math.round(rms * 400) / 100));
      timer = setTimeout(tick, 100);
    };
    timer = setTimeout(tick, 0);
    return () => { cancelled = true; clearTimeout(timer); if (context) void context.close().catch(() => {}); };
  }, [connected, getCallStream, visible]);
  return { testing, requesting, monitoring, error, level, devices, refresh, start, stop, toggleMonitor, testOutput };
}
