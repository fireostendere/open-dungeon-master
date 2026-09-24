// Browser-only preferences. No identifiers, room membership or credentials are stored here.
export type CallPreferences = {
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  startMuted: boolean;
  pttKey: string;
  layout: "grid" | "list";
};
export const DEFAULT_CALL_PREFERENCES: CallPreferences = {
  echoCancellation: true, noiseSuppression: true, autoGainControl: true,
  startMuted: true, pttKey: "Backquote", layout: "grid",
};
export const PTT_KEYS = ["Backquote", "Space", "KeyV", "KeyB", "KeyT", "Numpad0"] as const;
const KEY = "odm.voice.call.v2";
const EVENT = "odm-voice-call-preferences";
let memory = DEFAULT_CALL_PREFERENCES;
let lastRaw: string | null = null;

export function parseCallPreferences(raw: string | null): CallPreferences {
  try {
    const value: unknown = JSON.parse(raw || "null");
    if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_CALL_PREFERENCES };
    const p = value as Record<string, unknown>;
    return {
      echoCancellation: typeof p.echoCancellation === "boolean" ? p.echoCancellation : true,
      noiseSuppression: typeof p.noiseSuppression === "boolean" ? p.noiseSuppression : true,
      autoGainControl: typeof p.autoGainControl === "boolean" ? p.autoGainControl : true,
      startMuted: typeof p.startMuted === "boolean" ? p.startMuted : true,
      pttKey: PTT_KEYS.some(key => key === p.pttKey) ? String(p.pttKey) : "Backquote",
      layout: p.layout === "list" ? "list" : "grid",
    };
  } catch { return { ...DEFAULT_CALL_PREFERENCES }; }
}
export function readCallPreferences(): CallPreferences {
  if (typeof window === "undefined") return DEFAULT_CALL_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw !== lastRaw) { memory = parseCallPreferences(raw); lastRaw = raw; }
  } catch { /* In-memory preferences still work when storage is denied. */ }
  return memory;
}
export function writeCallPreferences(patch: Partial<CallPreferences>) {
  memory = parseCallPreferences(JSON.stringify({ ...readCallPreferences(), ...patch }));
  const raw = JSON.stringify(memory);
  try { window.localStorage.setItem(KEY, raw); lastRaw = raw; } catch { /* session only */ }
  window.dispatchEvent(new Event(EVENT));
}
export function subscribeCallPreferences(listener: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === KEY || event.key === null) listener(); };
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", storage);
  return () => { window.removeEventListener(EVENT, listener); window.removeEventListener("storage", storage); };
}
export function captureConstraints(deviceId: string, exact = false, prefs = readCallPreferences()): MediaStreamConstraints {
  return { audio: {
    echoCancellation: prefs.echoCancellation, noiseSuppression: prefs.noiseSuppression,
    autoGainControl: prefs.autoGainControl,
    ...(deviceId ? { deviceId: exact ? { exact: deviceId } : { ideal: deviceId } } : {}),
  }, video: false };
}
export function microphoneEnabled(muted: boolean, mode: "open" | "ptt", held: boolean) {
  return !muted && (mode === "open" || held);
}
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']"));
}
