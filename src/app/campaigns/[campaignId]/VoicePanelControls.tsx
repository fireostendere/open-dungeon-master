"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Activity, Check, Copy, Globe, Hand, HeadphoneOff, Headphones, LayoutGrid, List,
  Loader2, MapPin, Mic, MicOff, PhoneOff, Radio, RefreshCw, RotateCcw, Search,
  Settings2, Shield, Users, Volume2, VolumeX } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { localeText } from "@/lib/i18n/locale-text";
import { useVoiceRoom } from "./useVoiceRoom";
import { useVoiceAudioCheck } from "./useVoiceAudioCheck";
import { voiceCopy } from "./voice-copy";
import { MIC_GAIN_MAX, supportsOutputSelection, useMicGain, useOutputId, writeMicGain, writeOutputId } from "@/lib/audio-devices";
import { DEFAULT_CALL_PREFERENCES, PTT_KEYS, readCallPreferences, subscribeCallPreferences, writeCallPreferences } from "@/lib/voice/call-preferences";
import { EMPTY_DIAGNOSTICS, summarizeAudioStats, type AudioStat } from "@/lib/voice/call-diagnostics";
import { MASTER_VOLUME_MAX, PEER_VOLUME_MAX, VOLUME_STEP } from "@/lib/voice/volume";
import { mayTransmit, type TurnEnforcement, type VoiceFloorMode } from "@/lib/voice/turn-logic";
import type { VoiceRosterEntry } from "@/lib/voice/types";
import type { VoiceAccessSnapshot } from "@/lib/voice/call-types";
import s from "./VoiceCall.module.css";

export type VoicePanelProps = {
  campaignId: string; meUserId: string; roster: VoiceRosterEntry[] | null;
  speaking?: { userId: string; at: number } | null; floorMode?: VoiceFloorMode;
  floorUserIds?: string[]; turnEnforcement?: TurnEnforcement; adjudicates?: boolean;
  steersStory?: boolean; sayRangeRule?: boolean; audibilityVersion?: number;
  meshSignal?: { to: string; version: number } | null; compact?: boolean; visible?: boolean;
};
type Props = VoicePanelProps & {
  access: VoiceAccessSnapshot; stale: boolean; scopeBusy: boolean; scopeError: string;
  onScopeChange: (scope: "global" | "location") => void; onRefresh: () => void;
};
const joinClasses = (...values: Array<string | false | undefined>) => values.filter(Boolean).join(" ");
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(word => [...word][0] ?? "").join("").toLocaleUpperCase() || "?";
const elapsed = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;

export function VoicePanel({ campaignId, meUserId, roster, speaking, floorMode = "open", floorUserIds = [],
  turnEnforcement = "soft", adjudicates = false, sayRangeRule = false, audibilityVersion = 0,
  meshSignal = null, visible = true, access, stale, scopeBusy, scopeError, onScopeChange, onRefresh }: Props) {
  const { locale } = useI18n();
  const copy = localeText(locale, voiceCopy);
  const id = useId();
  const voice = useVoiceRoom(campaignId, roster, meUserId, audibilityVersion, meshSignal);
  const [tab, setTab] = useState<"people" | "sound" | "connection">("people");
  const [query, setQuery] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [stats, setStats] = useState(EMPTY_DIAGNOSTICS);
  const [clipboard, setClipboard] = useState("");
  const [deviceError, setDeviceError] = useState("");
  const preferences = useSyncExternalStore(subscribeCallPreferences, readCallPreferences, () => DEFAULT_CALL_PREFERENCES);
  const outputId = useOutputId(), micGain = useMicGain();
  const supportsMicrophone = typeof navigator !== "undefined" && "getUserMedia" in (navigator.mediaDevices ?? {});
  const onCall = voice.connected || voice.reconnecting;
  const audio = useVoiceAudioCheck(visible && tab === "sound", onCall, voice.micId, voice.getMicrophoneStream);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!visible || voice.startedAt === null || !onCall) return;
    const update = () => setSeconds(Math.max(0, Math.floor((Date.now() - voice.startedAt!) / 1000)));
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [onCall, visible, voice.startedAt]);
  useEffect(() => {
    if (!visible || tab !== "connection" || !onCall) return;
    let cancelled = false, before: AudioStat[] = [], timer: ReturnType<typeof setTimeout>;
    const sample = async () => {
      const current = await voice.getStats();
      if (cancelled) return;
      setStats(summarizeAudioStats(current, before)); before = current;
      timer = setTimeout(sample, 2000);
    };
    void sample();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [onCall, tab, visible, voice.getStats, voice.startedAt]);
  const begin = async () => { audio.stop(); await voice.join({ muted: preferences.startMuted }); };
  const reconnect = async () => { audio.stop(); await voice.leave(); if (alive.current) await voice.join({ muted: true }); };
  const chooseOutput = async (deviceId: string) => {
    setDeviceError("");
    try {
      const probe = new Audio() as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
      if (!probe.setSinkId) throw new Error(copy.outputUnsupported);
      await probe.setSinkId(deviceId);
      if (alive.current) writeOutputId(deviceId);
    } catch (cause) { if (alive.current) setDeviceError(cause instanceof Error ? cause.message : copy.error); }
  };
  const copyDiagnostics = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify({ time: new Date().toISOString(), status: voice.status,
        transport: access.mode, scope: access.scope, secureContext: window.isSecureContext,
        microphoneApi: supportsMicrophone, ...(onCall ? stats : EMPTY_DIAGNOSTICS) }, null, 2));
      if (alive.current) setClipboard(copy.copied);
    } catch { if (alive.current) setClipboard(copy.copyFailed); }
  };
  const peers = useMemo(() => stale ? [] : [...voice.peers].sort((a, b) => {
    if (a.userId === meUserId) return -1; if (b.userId === meUserId) return 1;
    return a.username.localeCompare(b.username);
  }), [meUserId, stale, voice.peers]);
  const filtered = peers.filter(peer => peer.username.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const statusLabel = voice.pending && voice.status === "idle" ? copy.finishing : ({ idle: copy.disconnected,
    connecting: copy.joining, connected: copy.connected, reconnecting: copy.reconnecting, error: copy.failed }[voice.status]);
  const verdict = mayTransmit(floorMode, floorUserIds, { userId: meUserId, adjudicates }, turnEnforcement);
  const keyName = (key: string) => key === "Backquote" ? "`" : key === "Space" ? copy.space : key.replace("Key", "").replace("Numpad", "Num ");
  const error = voice.error || audio.error || deviceError || scopeError;
  const tabs = ["people", "sound", "connection"] as const;
  const supports: MediaTrackSupportedConstraints = typeof navigator === "undefined" ? {} : navigator.mediaDevices?.getSupportedConstraints() ?? {};
  const canChooseOutput = supportsOutputSelection();
  const deviceList = (kind: MediaDeviceKind) => audio.devices.filter(device => device.kind === kind && device.deviceId && device.deviceId !== "default");
  const chooseTab = useCallback((value: "people" | "sound" | "connection") => { setTab(value); }, []);

  return <section className={s.call} aria-label={copy.title} data-testid="voice-call">
    <header className={s.header}>
      <div className={s.headingRow}>
        <span className={s.eyebrow}>{copy.title}</span>
        <span className={joinClasses(s.status, voice.connected && s.live, voice.status === "error" && s.bad)} role="status">
          <span className={s.dot} />{statusLabel}{onCall && voice.startedAt !== null ? <span aria-hidden="true"> · {elapsed(seconds)}</span> : null}
        </span>
      </div>
      <h2 className={s.title}>{access.scope === "location" ? <MapPin /> : <Headphones />}{access.scope === "location" ? copy.location : copy.global}</h2>
      <p className={s.description}>{access.scope === "location" ? copy.locationNote : copy.globalNote}</p>
      <div className={s.scopeSwitch} role="group" aria-label={copy.leader}>
        <button type="button" aria-pressed={access.scope === "global"} disabled={!access.canManageScope || scopeBusy || stale}
          onClick={() => onScopeChange("global")}><Globe />{copy.globalMode}</button>
        <button type="button" aria-pressed={access.scope === "location"}
          disabled={!access.canManageScope || !access.privateScopeAvailable || scopeBusy || stale}
          title={!access.privateScopeAvailable ? copy.unavailablePrivate : undefined}
          onClick={() => onScopeChange("location")}><Shield />{copy.locationMode}</button>
      </div>
      <p className={s.note}>{!access.privateScopeAvailable ? copy.unavailablePrivate : copy.leader}</p>
    </header>

    {stale ? <div className={s.notice} role="alert">{copy.stale}<br /><button className={s.button} onClick={onRefresh} type="button"><RefreshCw />{copy.refresh}</button></div> : null}
    {access.scope === "location" && !access.assignedLocation ? <div className={s.notice}>{copy.unassigned}</div> : null}
    {!access.available ? <div className={s.notice}>{access.unavailableReason === "server" ? copy.serverOff : access.unavailableReason === "privacy" ? copy.privacyOff : copy.campaignOff}</div> : null}
    {access.warning ? <div className={s.notice}><details><summary>{copy.troubleshooting}</summary>{access.warning}</details></div> : null}
    {error ? <div className={joinClasses(s.notice, s.error)} role="alert">{scopeError ? copy.scopeFailed : copy.error}
      <details><summary>{copy.details}</summary>{error}</details></div> : null}
    {voice.playbackBlocked ? <div className={s.notice} role="alert">{copy.autoplay}<br />
      <button className={s.button} type="button" onClick={() => void voice.unlockPlayback()}><Volume2 />{copy.unlock}</button></div> : null}

    <nav className={s.tabs} role="tablist" aria-label={copy.title}>
      {tabs.map((value, index) => <button key={value} ref={node => { tabRefs.current[index] = node; }}
        className={s.tab} type="button" role="tab" id={`${id}-${value}-tab`} aria-controls={`${id}-${value}-panel`}
        aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} onClick={() => chooseTab(value)}
        onKeyDown={event => {
          let next = index;
          if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
          else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
          else if (event.key === "Home") next = 0; else if (event.key === "End") next = tabs.length - 1; else return;
          event.preventDefault(); chooseTab(tabs[next]); tabRefs.current[next]?.focus();
        }}>{value === "people" ? <Users /> : value === "sound" ? <Settings2 /> : <Activity />}{copy[value]}
        {value === "people" ? <span className={s.count}>{peers.length}</span> : null}</button>)}
    </nav>

    <div className={s.body} role="tabpanel" id={`${id}-${tab}-panel`} aria-labelledby={`${id}-${tab}-tab`} tabIndex={0}>
      {tab === "people" ? <>
        {peers.length ? <div className={s.tools}>
          <label className={s.search}><Search /><input aria-label={copy.search} placeholder={copy.search} value={query} onChange={event => setQuery(event.target.value)} /></label>
          <div className={s.viewSwitch} role="group" aria-label={`${copy.grid} / ${copy.list}`}>
            <button className={s.iconButton} type="button" aria-label={copy.grid} title={copy.grid} aria-pressed={preferences.layout === "grid"} onClick={() => writeCallPreferences({ layout: "grid" })}><LayoutGrid /></button>
            <button className={s.iconButton} type="button" aria-label={copy.list} title={copy.list} aria-pressed={preferences.layout === "list"} onClick={() => writeCallPreferences({ layout: "list" })}><List /></button>
          </div>
        </div> : null}
        {!peers.length ? <div className={s.empty}><div className={s.emptyIcon}><Headphones /></div><h3>{copy.empty}</h3><p>{copy.emptyNote}</p>
          <button className={s.button} type="button" onClick={() => chooseTab("sound")}><Settings2 />{copy.test}</button></div> : null}
        {peers.length && !filtered.length ? <p className={s.description}>{copy.noResults}</p> : null}
        <div className={preferences.layout === "grid" ? s.grid : s.list}>
          {filtered.map(peer => {
            const me = peer.userId === meUserId, volume = voice.peerVolume(peer.userId);
            const active = speaking?.userId === peer.userId && !peer.muted && !peer.forceMuted;
            const label = peer.forceMuted ? copy.forceMuted : peer.muted ? copy.muted : !peer.producing ? copy.waiting : active ? copy.speaking : copy.ready;
            return <article className={joinClasses(s.peer, active && s.peerSpeaking)} key={peer.userId} aria-label={`${peer.username}: ${label}`}>
              <div className={s.peerMain}><div className={s.peerTop}><div className={s.avatar} aria-hidden="true">{initials(peer.username)}</div>
                {peer.handRaisedAt ? <span className={s.badge} title={copy.raised}><Hand /></span> : me ? <span className={s.badge}>{copy.you}</span> : null}</div>
                <h3 className={s.peerName} title={peer.username}>{peer.username}</h3>
                <div className={s.peerState}>{peer.forceMuted ? <Shield /> : peer.muted ? <MicOff /> : active ? <Activity /> : <Headphones />}{label}</div>
              </div>
              {!me ? <div className={s.peerControls}>
                <button className={s.iconButton} type="button" aria-label={`${volume.muted ? copy.localUnmute : copy.localMute}: ${peer.username}`}
                  title={volume.muted ? copy.localUnmute : copy.localMute} aria-pressed={volume.muted} onClick={() => voice.togglePeerMute(peer.userId)}>{volume.muted ? <VolumeX /> : <Volume2 />}</button>
                <input className={s.slider} type="range" min={0} max={PEER_VOLUME_MAX} step={VOLUME_STEP} value={volume.volume}
                  aria-label={`${copy.volume}: ${peer.username}`} onChange={event => voice.setPeerVolume(peer.userId, Number(event.target.value))} />
                <span className={s.percent}>{Math.round(volume.volume * 100)}%</span>
                <button className={s.iconButton} type="button" aria-label={`${copy.reset}: ${peer.username}`} title={copy.reset} onClick={() => voice.resetPeerVolume(peer.userId)}><RotateCcw /></button>
              </div> : null}
            </article>;
          })}
        </div>
        {peers.length > 1 ? <p className={s.note}>{copy.localOnly}</p> : null}
      </> : null}

      {tab === "sound" ? <>
        <section className={s.section}>
          <div className={s.sectionTitle}><span>{copy.microphone}</span><button type="button" className={s.iconButton} title={copy.refreshDevices} aria-label={copy.refreshDevices}
            onClick={() => { void audio.refresh(); void voice.refreshDevices(); }}><RefreshCw /></button></div>
          <label className={s.field}>{copy.microphone}<select className={s.select} aria-label={copy.microphone} value={voice.micId} onChange={event => voice.selectMic(event.target.value)}>
            <option value="">{copy.system}</option>
            {deviceList("audioinput").map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `${copy.microphone} ${index + 1}`}</option>)}
            {voice.micId && !deviceList("audioinput").some(d => d.deviceId === voice.micId) ? <option value={voice.micId}>{copy.microphone} · {copy.missing}</option> : null}
          </select></label>
          <label className={s.fieldRow}><span className={s.field}>{copy.micGain} <span className={s.percent}>{Math.round(micGain * 100)}%</span></span>
            <input className={s.slider} type="range" min={0} max={MIC_GAIN_MAX} step={0.05} value={micGain} aria-label={copy.micGain} onChange={event => writeMicGain(Number(event.target.value))} /></label>
          <div className={s.meterBox}><div className={s.meterLabel}><span>{onCall ? copy.liveMeter : copy.level}</span><span>{audio.level > .9 ? copy.clipping : `${Math.round(audio.level * 100)}%`}</span></div>
            <div className={s.meter} role="meter" aria-label={copy.level} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(audio.level * 100)}>
              {Array.from({ length: 24 }, (_, index) => <span key={index} data-on={audio.level * 24 > index} data-hot={index > 18} />)}
            </div></div>
          {!onCall ? <><div className={s.buttonRow}>
            <button className={s.button} type="button" disabled={voice.pending} onClick={() => audio.testing || audio.requesting ? audio.stop() : void audio.start()}>
              {audio.requesting ? <Loader2 className={s.spin} /> : <Mic />}{audio.testing || audio.requesting ? copy.stopTest : copy.test}</button>
            {audio.testing ? <button type="button" className={s.button} aria-pressed={audio.monitoring} onClick={() => void audio.toggleMonitor()}><Headphones />{copy.monitor}</button> : null}
          </div><p className={s.note}>{audio.requesting ? copy.requesting : copy.testNote}{audio.monitoring ? ` ${copy.monitorNote}` : ""}</p></> : null}
          <p className={s.note}>{copy.devicesNote}</p>
        </section>
        <section className={s.section}>
          <label className={s.field}>{copy.output}<select className={s.select} aria-label={copy.output} disabled={!canChooseOutput} value={outputId} onChange={event => void chooseOutput(event.target.value)}>
            <option value="">{copy.system}</option>{deviceList("audiooutput").map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `${copy.output} ${index + 1}`}</option>)}
            {outputId && !deviceList("audiooutput").some(d => d.deviceId === outputId) ? <option value={outputId}>{copy.output} · {copy.missing}</option> : null}
          </select></label>
          {!canChooseOutput ? <p className={s.note}>{copy.outputUnsupported}</p> : null}
          <div><button className={s.button} type="button" onClick={() => void audio.testOutput()}><Volume2 />{copy.outputTest}</button></div>
        </section>
        <section className={s.section}>
          <label className={s.field}>{copy.micMode}<select className={s.select} aria-label={`${copy.openMic} / ${copy.ptt}`} value={voice.micMode} onChange={event => voice.selectMicMode(event.target.value as "open" | "ptt")}>
            <option value="open">{copy.openMic}</option><option value="ptt">{copy.ptt}</option></select></label>
          {voice.micMode === "ptt" ? <><label className={s.field}>{copy.pttKey}<select className={s.select} aria-label={copy.pttKey} value={preferences.pttKey} onChange={event => writeCallPreferences({ pttKey: event.target.value })}>
            {PTT_KEYS.map(key => <option key={key} value={key}>{keyName(key)}</option>)}</select></label><p className={s.note}>{copy.pttNote}</p></> : null}
          <label className={s.check}><input type="checkbox" checked={preferences.startMuted} onChange={event => writeCallPreferences({ startMuted: event.target.checked })} />{copy.startMuted}</label>
          <p className={s.note}>{copy.startMutedNote}</p>
        </section>
        <section className={s.section}>
          <h3 className={s.sectionTitle}>{copy.processing}</h3>
          <div className={s.processing}>{([ ["noiseSuppression", copy.noise], ["echoCancellation", copy.echo], ["autoGainControl", copy.agc] ] as const).map(([key, label]) =>
            <label className={s.check} key={key} title={!supports[key] ? copy.unsupported : undefined}><input type="checkbox" checked={preferences[key]} disabled={!supports[key]}
              onChange={event => { audio.stop(); writeCallPreferences({ [key]: event.target.checked }); }} />{label}</label>)}</div>
          <p className={s.note}>{copy.processingNote}</p><p className={s.note}>{copy.saved}</p>
        </section>
      </> : null}

      {tab === "connection" ? <>
        <section className={s.section}><h3 className={s.sectionTitle}>{copy.quality}</h3>
          <div className={s.metrics}>{([
            [copy.rtt, stats.rttMs, copy.ms], [copy.jitter, stats.jitterMs, copy.ms],
            [copy.loss, stats.lossPercent, "%"], [copy.bitrate, stats.receiveKbps, copy.kbps],
          ] as const).map(([label, value, unit]) => <div className={s.metric} key={label}><div className={s.metricValue}>{onCall && value !== null ? value.toFixed(value < 10 ? 1 : 0) : "—"}<small>{unit}</small></div><div className={s.metricLabel}>{label}</div></div>)}</div>
          <p className={s.note}>{copy.statsNote}</p>
          <div className={s.dataRow}><span>{copy.transport}</span><strong>{access.mode === "sfu" ? copy.sfu : copy.mesh}</strong></div>
          <div className={s.dataRow}><span>{copy.secure}</span><strong>{typeof window !== "undefined" && window.isSecureContext ? copy.yes : copy.no}</strong></div>
          <div className={s.dataRow}><span>{copy.microphoneApi}</span><strong>{supportsMicrophone ? copy.supported : copy.missing}</strong></div>
          <div className={s.buttonRow}><button className={s.button} type="button" onClick={() => void copyDiagnostics()}>{clipboard === copy.copied ? <Check /> : <Copy />}{copy.copy}</button>
            <button className={s.button} type="button" disabled={voice.pending || stale || !access.available} onClick={() => void reconnect()}><RefreshCw />{copy.retry}</button></div>
          {clipboard ? <p className={s.note} role="status">{clipboard}</p> : null}<p className={s.note}>{copy.privacyDiagnostics}</p>
        </section>
        <section className={s.section}><h3 className={s.sectionTitle}>{copy.troubleshooting}</h3><p className={s.description}>{copy.troubleshootNote}</p></section>
      </> : null}
    </div>

    <footer className={s.footer}>
      {onCall && !verdict.mayTransmit && turnEnforcement === "strict" ? <p className={s.note}>{copy.floorBlocked}</p> : null}
      <div className={s.master}><Volume2 /><label htmlFor={`${id}-master`}>{copy.master}</label>
        <input id={`${id}-master`} className={s.slider} type="range" min={0} max={MASTER_VOLUME_MAX} step={VOLUME_STEP} value={voice.masterVolume} onChange={event => voice.setMasterVolume(Number(event.target.value))} />
        <span className={s.percent}>{Math.round(voice.masterVolume * 100)}%</span></div>
      {onCall && voice.micMode === "ptt" ? <button type="button" className={s.ptt} aria-pressed={voice.talking} disabled={voice.muted || (!verdict.mayTransmit && turnEnforcement === "strict")}
        onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); voice.setTalking(true); }}
        onPointerUp={() => voice.setTalking(false)} onPointerCancel={() => voice.setTalking(false)} onLostPointerCapture={() => voice.setTalking(false)}
        onKeyDown={event => { if ((event.key === " " || event.key === "Enter") && !event.repeat) { event.preventDefault(); voice.setTalking(true, "button"); } }}
        onKeyUp={event => { if (event.key === " " || event.key === "Enter") voice.setTalking(false, "button"); }}
        onBlur={() => voice.setTalking(false, "button")} onContextMenu={event => event.preventDefault()}>
        <Radio />{voice.talking && !voice.muted ? copy.held : copy.hold}<kbd className={s.keycap}>{keyName(preferences.pttKey)}</kbd></button> : null}
      <div className={s.toolbar}>
        {onCall ? <>
          <button className={s.control} type="button" title={voice.muted ? copy.unmute : copy.mute} aria-label={voice.muted ? copy.unmute : copy.mute} aria-pressed={voice.muted}
            onClick={() => void voice.toggleMute()}>{voice.muted ? <MicOff /> : <Mic />}<span>{copy.microphone}</span></button>
          <button className={s.control} type="button" title={voice.deafened ? copy.undeafen : copy.deafen} aria-label={voice.deafened ? copy.undeafen : copy.deafen}
            aria-pressed={voice.deafened} onClick={voice.toggleDeafen}>{voice.deafened ? <HeadphoneOff /> : <Headphones />}<span>{voice.deafened ? copy.audioOff : copy.sound}</span></button>
          {!adjudicates ? <button className={s.control} type="button" title={voice.handRaised ? copy.lowerHand : copy.hand} aria-label={voice.handRaised ? copy.lowerHand : copy.hand}
            aria-pressed={voice.handRaised} onClick={() => void voice.toggleHand()}><Hand /><span>{copy.hand}</span></button> : null}
          <button className={joinClasses(s.control, s.leave)} type="button" title={copy.leave} aria-label={copy.leave} onClick={() => void voice.leave()}><PhoneOff /><span>{copy.leave}</span></button>
        </> : <>
          <button className={s.primary} type="button" disabled={!access.available || !voice.available || stale || voice.pending} onClick={() => void begin()}>
            {voice.pending ? <Loader2 className={s.spin} /> : preferences.startMuted || voice.micMode === "ptt" ? <MicOff /> : <Mic />}{voice.status === "connecting" ? copy.joining : copy.join}</button>
          {voice.pending ? <button type="button" className={s.button} onClick={() => void voice.leave()}>{copy.cancel}</button> : null}
        </>}
      </div>
      {!onCall ? <label className={s.check} style={{ marginTop: 12 }}><input type="checkbox" checked={preferences.startMuted} onChange={event => writeCallPreferences({ startMuted: event.target.checked })} />{copy.startMuted}</label> : null}
      {onCall && sayRangeRule ? <label className={s.field} style={{ marginTop: 12 }}>{copy.range}<select className={s.select} value={voice.sayRange} onChange={event => void voice.setSayRange(event.target.value as "whisper" | "normal" | "shout")}>
        <option value="whisper">{copy.whisper}</option><option value="normal">{copy.normal}</option><option value="shout">{copy.shout}</option></select></label> : null}
      <p className={s.footerNote}>{voice.deafened ? copy.deafenNote : copy.closeKeepsCall}</p>
    </footer>
  </section>;
}
