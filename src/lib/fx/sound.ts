// Synthesised sound effects for the cinematic overlays. No audio files: every
// cue is built from oscillators and filtered noise, routed through one master
// bus with a compressor and a generated reverb so the cues sit together.

const MUTE_KEY = "odm:fx-muted";
export const FX_PREFS_EVENT = "odm-fx-prefs";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let reverbSend: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;

export function fxMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setFxMuted(muted: boolean): void {
  try {
    window.localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    // The choice still applies to this tab through the event below.
  }
  window.dispatchEvent(new Event(FX_PREFS_EVENT));
}

function audio(): { ctx: AudioContext; out: GainNode; wet: GainNode } | null {
  if (typeof window === "undefined" || fxMuted()) return null;
  if (!ctx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(comp).connect(ctx.destination);

    // Generated hall impulse: decaying stereo noise.
    const seconds = 2.4;
    const ir = ctx.createBuffer(2, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3.2);
      }
    }
    const convolver = ctx.createConvolver();
    convolver.buffer = ir;
    reverbSend = ctx.createGain();
    reverbSend.gain.value = 0.32;
    reverbSend.connect(convolver).connect(master);

    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const n = noiseBuffer.getChannelData(0);
    for (let i = 0; i < n.length; i++) n[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return { ctx, out: master!, wet: reverbSend! };
}

type Env = { a?: number; d: number; peak: number; at?: number };

function envGain(c: AudioContext, env: Env): GainNode {
  const g = c.createGain();
  const t = env.at ?? c.currentTime;
  const a = env.a ?? 0.004;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, env.peak), t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + env.d);
  return g;
}

function route(node: AudioNode, a: { out: GainNode; wet: GainNode }, wet = 0.3) {
  node.connect(a.out);
  if (wet > 0) {
    const send = node.context.createGain();
    send.gain.value = wet;
    node.connect(send).connect(a.wet);
  }
}

function tone(type: OscillatorType, freq: number, env: Env, opts: { to?: number; wet?: number; detune?: number } = {}) {
  const a = audio();
  if (!a) return;
  const t = env.at ?? a.ctx.currentTime;
  const o = a.ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (opts.detune) o.detune.value = opts.detune;
  if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t + (env.a ?? 0.004) + env.d);
  const g = envGain(a.ctx, env);
  o.connect(g);
  route(g, a, opts.wet ?? 0.3);
  o.start(t);
  o.stop(t + (env.a ?? 0.004) + env.d + 0.05);
}

function noise(env: Env, filter: { type: BiquadFilterType; freq: number; q?: number; to?: number }, wet = 0.2) {
  const a = audio();
  if (!a || !noiseBuffer) return;
  const t = env.at ?? a.ctx.currentTime;
  const src = a.ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  const f = a.ctx.createBiquadFilter();
  f.type = filter.type;
  f.frequency.setValueAtTime(filter.freq, t);
  if (filter.to) f.frequency.exponentialRampToValueAtTime(filter.to, t + (env.a ?? 0.004) + env.d);
  f.Q.value = filter.q ?? 1;
  const g = envGain(a.ctx, env);
  src.connect(f).connect(g);
  route(g, a, wet);
  src.start(t, Math.random() * 0.5);
  src.stop(t + (env.a ?? 0.004) + env.d + 0.05);
}

function at(delay: number): number {
  return (ctx?.currentTime ?? 0) + delay;
}

/** Resin die hitting a wooden table; `strength` 0..1 from the impact speed. */
export function sfxDieClack(strength: number) {
  if (!audio()) return;
  const s = Math.min(1, Math.max(0.08, strength));
  const pitch = 0.85 + Math.random() * 0.35;
  noise({ d: 0.05 + s * 0.04, peak: 0.5 * s }, { type: "bandpass", freq: 2600 * pitch, q: 3.5 }, 0.12);
  tone("triangle", 1500 * pitch, { d: 0.05, peak: 0.12 * s }, { to: 900 * pitch, wet: 0.1 });
  tone("sine", 190 * pitch, { d: 0.09, peak: 0.28 * s }, { to: 90, wet: 0.05 });
}

export function sfxWhoosh(duration = 0.45, up = true) {
  noise({ a: duration * 0.45, d: duration * 0.55, peak: 0.22 }, { type: "bandpass", freq: up ? 350 : 1800, to: up ? 2200 : 300, q: 1.2 }, 0.25);
}

export function sfxShake() {
  // Dice rattling in a cupped hand.
  for (let i = 0; i < 6; i++) {
    const d = i * 0.055 + Math.random() * 0.02;
    noise({ at: at(d), d: 0.035, peak: 0.12 }, { type: "bandpass", freq: 3200 + Math.random() * 1200, q: 4 }, 0.05);
  }
}

function chord(freqs: number[], type: OscillatorType, env: Omit<Env, "at">, delayStep = 0, wet = 0.45, detune = 0) {
  freqs.forEach((f, i) => tone(type, f, { ...env, at: at(i * delayStep) }, { wet, detune: detune ? (i % 2 ? detune : -detune) : 0 }));
}

function bell(freq: number, delay = 0, peak = 0.16, wet = 0.5) {
  // Inharmonic partials of a small bell.
  [1, 2.76, 5.4, 8.93].forEach((m, i) => {
    tone("sine", freq * m, { at: at(delay), a: 0.002, d: 1.4 / (i + 1), peak: peak / (i + 1.3) }, { wet });
  });
}

export function sfxSuccess() {
  chord([523.25, 659.25, 783.99, 1046.5], "triangle", { a: 0.01, d: 0.9, peak: 0.1 }, 0.06, 0.5);
  bell(1567.98, 0.2, 0.08);
}

export function sfxFail() {
  chord([196, 233.08, 277.18], "sawtooth", { a: 0.02, d: 0.7, peak: 0.05 }, 0.0, 0.35);
  tone("sine", 110, { a: 0.01, d: 0.8, peak: 0.25 }, { to: 70, wet: 0.2 });
}

export function sfxCrit() {
  tone("sine", 60, { a: 0.005, d: 0.9, peak: 0.55 }, { to: 38, wet: 0.2 });
  noise({ a: 0.01, d: 0.9, peak: 0.25 }, { type: "highpass", freq: 3000, to: 9000 }, 0.6);
  chord([523.25, 659.25, 783.99, 1046.5, 1318.5, 1568], "triangle", { a: 0.01, d: 1.6, peak: 0.09 }, 0.07, 0.6);
  chord([261.63, 392, 523.25], "sawtooth", { a: 0.08, d: 1.8, peak: 0.035 }, 0, 0.5, 8);
  [0.45, 0.6, 0.75].forEach((d, i) => bell(2093 * (1 + i * 0.25), d, 0.07));
}

export function sfxFumble() {
  // Crack, then a falling detuned brass groan.
  noise({ d: 0.18, peak: 0.6 }, { type: "highpass", freq: 1800 }, 0.3);
  noise({ at: at(0.05), d: 0.35, peak: 0.25 }, { type: "bandpass", freq: 900, q: 6 }, 0.3);
  tone("sawtooth", 233, { at: at(0.15), a: 0.03, d: 1.3, peak: 0.07 }, { to: 110, wet: 0.4, detune: 14 });
  tone("sawtooth", 247, { at: at(0.15), a: 0.03, d: 1.3, peak: 0.06 }, { to: 104, wet: 0.4, detune: -14 });
  tone("sine", 70, { d: 1.0, peak: 0.4 }, { to: 32, wet: 0.2 });
}

export function sfxBell() {
  bell(880, 0, 0.14);
  bell(1318.5, 0.18, 0.1);
}

export function sfxTick() {
  tone("square", 1800, { d: 0.02, peak: 0.03 }, { wet: 0 });
}

export function sfxCountUp(step: number) {
  tone("triangle", 700 + step * 90, { d: 0.05, peak: 0.05 }, { wet: 0.1 });
}

export function sfxImpact(big = false) {
  tone("sine", big ? 80 : 120, { d: big ? 0.8 : 0.4, peak: big ? 0.7 : 0.45 }, { to: 30, wet: 0.35 });
  noise({ d: big ? 0.5 : 0.25, peak: big ? 0.45 : 0.3 }, { type: "lowpass", freq: 900, to: 120 }, 0.4);
}

export function sfxSwordClash() {
  noise({ d: 0.12, peak: 0.55 }, { type: "highpass", freq: 2500 }, 0.4);
  [1180, 2757, 4012, 5480, 7210].forEach((f, i) =>
    tone("sine", f * (0.98 + Math.random() * 0.04), { a: 0.002, d: 1.4 / (1 + i * 0.6), peak: 0.1 / (1 + i * 0.4) }, { wet: 0.6 }),
  );
}

export function sfxWarDrum(delay = 0) {
  tone("sine", 95, { at: at(delay), d: 0.55, peak: 0.7 }, { to: 42, wet: 0.35 });
  noise({ at: at(delay), d: 0.12, peak: 0.25 }, { type: "lowpass", freq: 600 }, 0.3);
}

export function sfxBrassFanfare() {
  // C – G – C' – E' held, then a C-major swell.
  const notes: [number, number, number][] = [
    [261.63, 0, 0.16],
    [392, 0.18, 0.16],
    [523.25, 0.36, 0.22],
    [659.25, 0.62, 1.4],
  ];
  for (const [f, d, len] of notes) {
    [-7, 0, 7].forEach((det) => tone("sawtooth", f, { at: at(d), a: 0.03, d: len, peak: 0.045 }, { wet: 0.45, detune: det }));
    tone("square", f / 2, { at: at(d), a: 0.03, d: len, peak: 0.02 }, { wet: 0.3 });
  }
  chord([523.25, 659.25, 783.99, 1046.5], "sawtooth", { a: 0.25, d: 1.8, peak: 0.03 }, 0, 0.6, 6);
  [0.62, 0.9, 1.2].forEach((d) => bell(2093, d, 0.05));
}

export function sfxFirework(delay = 0) {
  noise({ at: at(delay), a: 0.25, d: 0.1, peak: 0.08 }, { type: "bandpass", freq: 900, to: 3500, q: 2 }, 0.1);
  noise({ at: at(delay + 0.35), d: 0.9, peak: 0.55 }, { type: "lowpass", freq: 700, to: 90 }, 0.6);
  for (let i = 0; i < 14; i++) {
    noise({ at: at(delay + 0.55 + Math.random() * 0.9), d: 0.02, peak: 0.08 }, { type: "highpass", freq: 4000 }, 0.3);
  }
}

export function sfxHeartbeat(delay = 0, peak = 0.7) {
  tone("sine", 62, { at: at(delay), a: 0.01, d: 0.18, peak }, { to: 40, wet: 0.1 });
  tone("sine", 58, { at: at(delay + 0.24), a: 0.01, d: 0.22, peak: peak * 0.75 }, { to: 36, wet: 0.1 });
}

export function sfxDoom() {
  chord([55, 82.41, 103.83], "sawtooth", { a: 0.4, d: 3.2, peak: 0.05 }, 0, 0.6, 10);
  tone("sine", 41, { a: 0.3, d: 3.5, peak: 0.45 }, { wet: 0.3 });
  noise({ a: 1.2, d: 2.5, peak: 0.1 }, { type: "lowpass", freq: 400, to: 120 }, 0.5);
}

export function sfxSadTrombone() {
  const notes: [number, number, number][] = [
    [293.66, 0, 0.42],
    [277.18, 0.46, 0.42],
    [261.63, 0.92, 0.42],
    [246.94, 1.38, 1.3],
  ];
  const a = audio();
  if (!a) return;
  for (const [f, d, len] of notes) {
    const t = at(d);
    const o = a.ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(f, t);
    if (len > 1) {
      // The last "waaah" wobbles down.
      const lfo = a.ctx.createOscillator();
      const lfoGain = a.ctx.createGain();
      lfo.frequency.value = 5.5;
      lfoGain.gain.value = 9;
      lfo.connect(lfoGain).connect(o.frequency);
      lfo.start(t + 0.2);
      lfo.stop(t + len);
      o.frequency.exponentialRampToValueAtTime(f * 0.92, t + len);
    }
    const lp = a.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(900, t);
    lp.Q.value = 3;
    const g = envGain(a.ctx, { at: t, a: 0.05, d: len, peak: 0.12 });
    o.connect(lp).connect(g);
    route(g, a, 0.3);
    o.start(t);
    o.stop(t + len + 0.1);
  }
}

export function sfxChoir() {
  // Level-up: an "aah" pad (formant-filtered saws) with a rising shimmer.
  const a = audio();
  if (!a) return;
  const t = at(0);
  const freqs = [261.63, 329.63, 392, 523.25];
  for (const f of freqs) {
    for (const det of [-9, 0, 9]) {
      const o = a.ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      o.detune.value = det;
      const f1 = a.ctx.createBiquadFilter();
      f1.type = "bandpass";
      f1.frequency.value = 800;
      f1.Q.value = 5;
      const g = envGain(a.ctx, { at: t, a: 0.6, d: 2.6, peak: 0.03 });
      o.connect(f1).connect(g);
      route(g, a, 0.7);
      o.start(t);
      o.stop(t + 3.4);
    }
  }
  [0.3, 0.45, 0.6, 0.75, 0.9, 1.05].forEach((d, i) => bell(1046.5 * Math.pow(1.122, i), d, 0.05, 0.7));
}

export function sfxCoins() {
  for (let i = 0; i < 9; i++) {
    const d = i * 0.07 + Math.random() * 0.04;
    const f = 2400 + Math.random() * 1800;
    tone("sine", f, { at: at(d), a: 0.001, d: 0.25, peak: 0.07 }, { wet: 0.35 });
    tone("sine", f * 2.7, { at: at(d), a: 0.001, d: 0.12, peak: 0.03 }, { wet: 0.35 });
  }
}

export function sfxSlash() {
  noise({ a: 0.05, d: 0.18, peak: 0.4 }, { type: "bandpass", freq: 1200, to: 5000, q: 1.5 }, 0.2);
  tone("sine", 140, { at: at(0.12), d: 0.3, peak: 0.4 }, { to: 50, wet: 0.2 });
}

export function sfxDawn() {
  chord([196, 293.66, 392, 493.88], "sine", { a: 1.2, d: 2.5, peak: 0.07 }, 0.25, 0.7);
  [1.6, 1.9, 2.2].forEach((d, i) => bell(1174.66 * (1 + i * 0.26), d, 0.05));
}
