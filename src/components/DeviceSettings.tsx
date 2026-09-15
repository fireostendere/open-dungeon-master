"use client";

import { Bluetooth, Dices, Mic, Volume2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { DiceSourcesPanel } from "@/app/campaigns/[campaignId]/DiceSourcesDialog";
import {
  PTT_KEY,
  readMicId,
  readMicMode,
  setMasterVolume,
  subscribeMicPrefs,
  useVolumePrefs,
  writeMicId,
  writeMicMode,
  type MicMode,
} from "@/app/campaigns/[campaignId]/useVoicePrefs";
import {
  MIC_GAIN_MAX,
  registerOutput,
  releaseOutput,
  supportsOutputSelection,
  useMicGain,
  useOutputId,
  writeMicGain,
  writeOutputId,
} from "@/lib/audio-devices";
import { AUDIO_PREF_FIELDS, writeAudioPref, type AudioPrefField } from "@/lib/audio-prefs";
import { cn } from "@/lib/cn";
import { useI18n, type Locale } from "@/lib/i18n";
import { MASTER_VOLUME_MAX, VOLUME_STEP } from "@/lib/voice/volume";

const COPY = {
  en: {
    microphoneNoun: "Microphone",
    outputNoun: "Output",
    on: "On",
    off: "Off",
    microphone: "Microphone",
    recordingDevice: "Recording device",
    systemDefault: "System default",
    allowMic: "Allow microphone access to see device names",
    recordingLevel: "Recording level",
    stopTest: "Stop test",
    testMic: "Test microphone",
    mode: "Mode",
    hold: "hold",
    orTalkButton: "or the talk button",
    microphoneMode: "Microphone mode",
    openMic: "Open mic",
    pushToTalk: "Push to talk",
    playback: "Playback",
    playbackDevice: "Playback device",
    test: "Test",
    systemOutput:
      "Sound plays through the output this device has selected; change it in the system settings.",
    voiceChat: "Voice chat",
    narration: "Narration",
    narrationReadAloud: "Narration read aloud",
    ambience: "Ambience",
    dice: "Dice",
    roll3d: "Roll 3D dice on the table",
    physicalDice: "Physical dice",
  },
  ru: {
    microphoneNoun: "Микрофон",
    outputNoun: "Выход",
    on: "Вкл.",
    off: "Выкл.",
    microphone: "Микрофон",
    recordingDevice: "Устройство записи",
    systemDefault: "Системное по умолчанию",
    allowMic: "Разрешить доступ к микрофону, чтобы увидеть названия устройств",
    recordingLevel: "Уровень записи",
    stopTest: "Остановить тест",
    testMic: "Проверить микрофон",
    mode: "Режим",
    hold: "удерживайте",
    orTalkButton: "или кнопку разговора",
    microphoneMode: "Режим микрофона",
    openMic: "Открытый микрофон",
    pushToTalk: "Нажать, чтобы говорить",
    playback: "Воспроизведение",
    playbackDevice: "Устройство воспроизведения",
    test: "Проверить",
    systemOutput:
      "Звук выводится через устройство, выбранное системой; изменить его можно в системных настройках.",
    voiceChat: "Голосовой чат",
    narration: "Озвучка повествования",
    narrationReadAloud: "Читать повествование вслух",
    ambience: "Фоновая атмосфера",
    dice: "Кости",
    roll3d: "Показывать 3D-броски костей на столе",
    physicalDice: "Физические кости",
  },
  pl: {
    microphoneNoun: "Mikrofon",
    outputNoun: "Wyjście",
    on: "Wł.",
    off: "Wył.",
    microphone: "Mikrofon",
    recordingDevice: "Urządzenie nagrywające",
    systemDefault: "Domyślne systemowe",
    allowMic: "Zezwól na dostęp do mikrofonu, aby zobaczyć nazwy urządzeń",
    recordingLevel: "Poziom nagrywania",
    stopTest: "Zatrzymaj test",
    testMic: "Przetestuj mikrofon",
    mode: "Tryb",
    hold: "przytrzymaj",
    orTalkButton: "lub przycisk mówienia",
    microphoneMode: "Tryb mikrofonu",
    openMic: "Otwarty mikrofon",
    pushToTalk: "Naciśnij, aby mówić",
    playback: "Odtwarzanie",
    playbackDevice: "Urządzenie odtwarzające",
    test: "Test",
    systemOutput:
      "Dźwięk jest odtwarzany przez wyjście wybrane przez to urządzenie; zmień je w ustawieniach systemu.",
    voiceChat: "Czat głosowy",
    narration: "Narracja",
    narrationReadAloud: "Czytaj narrację na głos",
    ambience: "Dźwięki otoczenia",
    dice: "Kości",
    roll3d: "Pokazuj rzuty kośćmi 3D na stole",
    physicalDice: "Fizyczne kości",
  },
} as const;

type DeviceCopy = (typeof COPY)[Locale];

// Everything about the machine in front of the player: which microphone
// and how hot, which output and how loud, and the dice on the table. The
// apps mount this on their own Settings screen, reachable from every page
// including mid-call and mid-table, so a preference changed here has to
// reach whatever is already playing: every control writes the same store
// the table's hooks read (useVoicePrefs, audio-devices, audio-prefs,
// dice-sources), and those hooks apply the change live.

const SELECT = cn(
  "w-full rounded-md border border-stone-700 bg-stone-900 px-2 py-1.5 text-xs",
  "text-stone-200 outline-none focus:border-amber-500",
);
const RANGE = "w-full accent-amber-400";
const BUTTON = cn(
  "rounded-md border border-stone-700 px-2.5 py-1 text-xs text-stone-300",
  "hover:bg-stone-900 disabled:opacity-50",
);
const HEADING = "mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-stone-400";
const ROW = "flex items-center justify-between gap-3";
const LABEL = "text-xs text-stone-400";

type Device = { deviceId: string; label: string };

// The microphones and outputs the browser knows. Labels are only readable
// once microphone permission has been granted; `allow` asks for it with a
// capture that is stopped the moment it starts.
function useDevices(microphoneNoun: string, outputNoun: string) {
  const [inputs, setInputs] = useState<Device[]>([]);
  const [outputs, setOutputs] = useState<Device[]>([]);
  const [labelled, setLabelled] = useState(false);

  const refresh = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return;
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const named = (kind: MediaDeviceKind, noun: string): Device[] =>
        devices
          .filter((device) => device.kind === kind)
          .map((device, index) => ({
            deviceId: device.deviceId,
            label: device.label || `${noun} ${index + 1}`,
          }));
      setInputs(named("audioinput", microphoneNoun));
      setOutputs(named("audiooutput", outputNoun));
      setLabelled(devices.some((device) => device.label));
    } catch {
      // No device access at all; the selects stay on the system default.
    }
  }, [microphoneNoun, outputNoun]);

  useEffect(() => {
    // Deferred a tick: the list arrives asynchronously anyway, and the
    // first render is not held for it.
    void Promise.resolve().then(refresh);
    const media = navigator.mediaDevices;
    media?.addEventListener?.("devicechange", refresh);
    return () => media?.removeEventListener?.("devicechange", refresh);
  }, [refresh]);

  const allow = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of stream.getTracks()) {
        track.stop();
      }
    } catch {
      // Denied: the list keeps its numbered placeholders.
    }
    await refresh();
  }, [refresh]);

  return { inputs, outputs, labelled, allow };
}

// A live level from the chosen microphone while the player tests it, with
// the level setting applied so the bar shows what the call would send.
function useMicMeter(deviceId: string, gain: number) {
  const [level, setLevel] = useState(0);
  const [testing, setTesting] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);
  const gainRef = useRef(gain);
  useEffect(() => {
    gainRef.current = gain;
  }, [gain]);

  const stop = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
    setTesting(false);
    setLevel(0);
  }, []);

  const start = useCallback(async () => {
    stopRef.current?.();
    stopRef.current = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { ideal: deviceId } } : true,
      });
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      let frame = 0;
      const tick = () => {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) {
          const centred = (sample - 128) / 128;
          sum += centred * centred;
        }
        const rms = Math.sqrt(sum / samples.length);
        setLevel(Math.min(1, rms * 3 * gainRef.current));
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      stopRef.current = () => {
        cancelAnimationFrame(frame);
        for (const track of stream.getTracks()) {
          track.stop();
        }
        void context.close().catch(() => {});
      };
      setTesting(true);
    } catch {
      setTesting(false);
    }
  }, [deviceId]);

  // A different microphone picked mid-test moves the meter to it.
  useEffect(() => {
    if (stopRef.current) {
      void start();
    }
  }, [start]);

  useEffect(() => () => stopRef.current?.(), []);

  return { level, testing, start, stop };
}

// A short tone through the chosen output, so "which one is the headset"
// can be answered without joining a call.
async function playTestTone() {
  let context: AudioContext;
  try {
    context = new AudioContext();
  } catch {
    return;
  }
  const destination = context.createMediaStreamDestination();
  const oscillator = context.createOscillator();
  oscillator.frequency.value = 440;
  const gain = context.createGain();
  gain.gain.value = 0.2;
  oscillator.connect(gain);
  gain.connect(destination);
  const audio = registerOutput(new Audio());
  audio.srcObject = destination.stream;
  oscillator.start();
  await audio.play().catch(() => {});
  setTimeout(() => {
    oscillator.stop();
    audio.pause();
    audio.srcObject = null;
    releaseOutput(audio);
    void context.close().catch(() => {});
  }, 700);
}

// Narration and ambience keep their own keys and events (audio-prefs.ts);
// read the same way their hooks do, so this panel and the table agree.
function useAudioFlag(field: AudioPrefField, fallback: boolean): boolean {
  const { key, event } = AUDIO_PREF_FIELDS[field];
  return useSyncExternalStore(
    (listener) => {
      window.addEventListener(event, listener);
      window.addEventListener("storage", listener);
      return () => {
        window.removeEventListener(event, listener);
        window.removeEventListener("storage", listener);
      };
    },
    () => {
      const stored = window.localStorage.getItem(key);
      return stored === null ? fallback : stored === "1";
    },
    () => fallback,
  );
}

function useAudioLevel(field: AudioPrefField, fallback: number): number {
  const { key, event } = AUDIO_PREF_FIELDS[field];
  return useSyncExternalStore(
    (listener) => {
      window.addEventListener(event, listener);
      window.addEventListener("storage", listener);
      return () => {
        window.removeEventListener(event, listener);
        window.removeEventListener("storage", listener);
      };
    },
    () => {
      const stored = Number(window.localStorage.getItem(key));
      return Number.isFinite(stored) && stored > 0 ? Math.min(1, stored) : fallback;
    },
    () => fallback,
  );
}

const DICE3D_KEY = "odm:dice3d";
const DICE3D_EVENT = "odm-dice3d-pref";

function subscribeDice3d(listener: () => void) {
  window.addEventListener(DICE3D_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(DICE3D_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function Slider({
  label,
  value,
  max,
  min = 0,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  min?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className={cn(ROW, "mb-1")}>
        <span className={LABEL}>{label}</span>
        <span className="font-mono text-xs text-stone-300">{percent(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={VOLUME_STEP}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={label}
        className={RANGE}
      />
    </label>
  );
}

function Switch({
  label,
  on,
  onChange,
  copy,
}: {
  label: string;
  on: boolean;
  onChange: (next: boolean) => void;
  copy: DeviceCopy;
}) {
  return (
    <div className={ROW}>
      <span className={LABEL}>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        className={cn(
          "rounded-md border px-2.5 py-1 text-xs",
          on
            ? "border-amber-700 bg-amber-950/40 text-amber-200"
            : "border-stone-700 text-stone-400 hover:bg-stone-900",
        )}
      >
        {on ? copy.on : copy.off}
      </button>
    </div>
  );
}

function MicrophoneSection({
  devices,
  copy,
}: {
  devices: ReturnType<typeof useDevices>;
  copy: DeviceCopy;
}) {
  const micId = useSyncExternalStore(subscribeMicPrefs, readMicId, () => "");
  const micMode = useSyncExternalStore(subscribeMicPrefs, readMicMode, () => "open" as MicMode);
  const gain = useMicGain();
  const meter = useMicMeter(micId, gain);
  const pttKey = PTT_KEY === "Backquote" ? "`" : PTT_KEY;
  return (
    <section>
      <h3 className={HEADING}>
        <Mic className="size-3.5" /> {copy.microphone}
      </h3>
      <div className="space-y-3">
        <div>
          <span className={cn(LABEL, "mb-1 block")}>{copy.recordingDevice}</span>
          <select
            value={micId}
            onChange={(event) => writeMicId(event.target.value)}
            aria-label={copy.recordingDevice}
            className={SELECT}
          >
            <option value="">{copy.systemDefault}</option>
            {devices.inputs.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </select>
          {!devices.labelled ? (
            <button type="button" onClick={() => void devices.allow()} className={cn(BUTTON, "mt-1.5")}>
              {copy.allowMic}
            </button>
          ) : null}
        </div>
        <Slider label={copy.recordingLevel} value={gain} max={MIC_GAIN_MAX} onChange={writeMicGain} />
        <div className={ROW}>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-stone-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-amber-300 transition-[width] duration-75"
              style={{ width: percent(meter.level) }}
            />
          </div>
          <button
            type="button"
            onClick={() => (meter.testing ? meter.stop() : void meter.start())}
            className={BUTTON}
          >
            {meter.testing ? copy.stopTest : copy.testMic}
          </button>
        </div>
        <div className={ROW}>
          <span className={LABEL}>
            {copy.mode}
            {micMode === "ptt" ? ` (${copy.hold} ${pttKey} ${copy.orTalkButton})` : ""}
          </span>
          <select
            value={micMode}
            onChange={(event) => writeMicMode(event.target.value as MicMode)}
            aria-label={copy.microphoneMode}
            className={cn(SELECT, "w-auto")}
          >
            <option value="open">{copy.openMic}</option>
            <option value="ptt">{copy.pushToTalk}</option>
          </select>
        </div>
      </div>
    </section>
  );
}

function PlaybackSection({
  devices,
  copy,
}: {
  devices: ReturnType<typeof useDevices>;
  copy: DeviceCopy;
}) {
  const outputId = useOutputId();
  const volumes = useVolumePrefs();
  const narrationMuted = useAudioFlag("narrationMuted", false);
  const narrationVolume = useAudioLevel("narrationVolume", 0.8);
  const ambienceMuted = useAudioFlag("ambienceMuted", false);
  const ambienceVolume = useAudioLevel("ambienceVolume", 0.6);
  const selectable = supportsOutputSelection();
  return (
    <section>
      <h3 className={HEADING}>
        <Volume2 className="size-3.5" /> {copy.playback}
      </h3>
      <div className="space-y-3">
        <div>
          <span className={cn(LABEL, "mb-1 block")}>{copy.playbackDevice}</span>
          {selectable ? (
            <div className="flex items-center gap-2">
              <select
                value={outputId}
                onChange={(event) => writeOutputId(event.target.value)}
                aria-label={copy.playbackDevice}
                className={SELECT}
              >
                <option value="">{copy.systemDefault}</option>
                {devices.outputs.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label}
                  </option>
                ))}
              </select>
              <button type="button" onClick={() => void playTestTone()} className={BUTTON}>
                {copy.test}
              </button>
            </div>
          ) : (
            <p className="text-xs text-stone-500">{copy.systemOutput}</p>
          )}
        </div>
        <Slider
          label={copy.voiceChat}
          value={volumes.master}
          max={MASTER_VOLUME_MAX}
          onChange={setMasterVolume}
        />
        <Slider
          label={copy.narration}
          value={narrationVolume}
          max={1}
          min={VOLUME_STEP}
          onChange={(value) => writeAudioPref("narrationVolume", value)}
        />
        <Switch
          label={copy.narrationReadAloud}
          on={!narrationMuted}
          onChange={(on) => writeAudioPref("narrationMuted", !on)}
          copy={copy}
        />
        <Slider
          label={copy.ambience}
          value={ambienceVolume}
          max={1}
          min={VOLUME_STEP}
          onChange={(value) => writeAudioPref("ambienceVolume", value)}
        />
        <Switch
          label={copy.ambience}
          on={!ambienceMuted}
          onChange={(on) => writeAudioPref("ambienceMuted", !on)}
          copy={copy}
        />
      </div>
    </section>
  );
}

function DiceSection({ copy }: { copy: DeviceCopy }) {
  const dice3d = useSyncExternalStore(
    subscribeDice3d,
    () => window.localStorage.getItem(DICE3D_KEY) !== "off",
    () => true,
  );
  return (
    <section>
      <h3 className={HEADING}>
        <Dices className="size-3.5" /> {copy.dice}
      </h3>
      <div className="space-y-3">
        <Switch
          label={copy.roll3d}
          on={dice3d}
          onChange={(on) => {
            window.localStorage.setItem(DICE3D_KEY, on ? "on" : "off");
            window.dispatchEvent(new Event(DICE3D_EVENT));
          }}
          copy={copy}
        />
        <div className={cn(HEADING, "mb-0")}>
          <Bluetooth className="size-3.5" /> {copy.physicalDice}
        </div>
        <DiceSourcesPanel />
      </div>
    </section>
  );
}

export function DeviceSettings() {
  const { locale } = useI18n();
  const copy = COPY[locale];
  const devices = useDevices(copy.microphoneNoun, copy.outputNoun);
  return (
    <div className="space-y-6 text-sm text-stone-200">
      <MicrophoneSection devices={devices} copy={copy} />
      <PlaybackSection devices={devices} copy={copy} />
      <DiceSection copy={copy} />
    </div>
  );
}
