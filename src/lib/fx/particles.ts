// A small 2D particle engine for the cinematic overlays: sparks, embers,
// confetti, coins, ash, rain, smoke, shards, shockwave rings and fireworks.
// It draws on one full-screen canvas, sleeps when nothing is alive and caches
// a tinted glow sprite per colour so thousands of additive particles stay
// cheap.

export type ParticleKind =
  | "spark"
  | "ember"
  | "glow"
  | "confetti"
  | "coin"
  | "ash"
  | "rain"
  | "smoke"
  | "shard"
  | "rocket";

type Particle = {
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  color: string;
  alpha: number;
  gravity: number;
  drag: number;
  rot: number;
  vr: number;
  flip: number;
  vflip: number;
  sway: number;
  twinkle: number;
  grow: number;
  trail: number;
  onDeath?: (p: Particle) => void;
  points?: number[];
};

type Ring = { x: number; y: number; r: number; maxR: number; age: number; life: number; color: string; width: number };
type Flash = { color: string; age: number; life: number; peak: number; x: number; y: number };

export type BurstOptions = {
  count: number;
  kind: ParticleKind;
  colors: string[];
  speed: [number, number];
  /** Direction in radians and spread around it; default is all directions. */
  angle?: number;
  spread?: number;
  life: [number, number];
  size: [number, number];
  gravity?: number;
  drag?: number;
  /** Random offset of the spawn point. */
  jitter?: number;
  trail?: number;
};

export const FIREWORK_COLORS = {
  gold: ["#fff4c2", "#ffd76b", "#f5b73b"],
  crimson: ["#ffd0d0", "#ff5a5a", "#e11d48"],
  violet: ["#f3e8ff", "#c084fc", "#8b5cf6"],
  azure: ["#e0f2fe", "#7dd3fc", "#38bdf8"],
  emerald: ["#dcfce7", "#6ee7b7", "#10b981"],
  ember: ["#fff1d6", "#ffb067", "#ff7a3d"],
} as const;

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];

function parseColor(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const PHI = (1 + Math.sqrt(5)) / 2;
const ICO_V: [number, number, number][] = [
  [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
  [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
  [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
];
const ICO_EDGES: [number, number][] = (() => {
  const edges: [number, number][] = [];
  for (let i = 0; i < ICO_V.length; i++) {
    for (let j = i + 1; j < ICO_V.length; j++) {
      const d = Math.hypot(ICO_V[i][0] - ICO_V[j][0], ICO_V[i][1] - ICO_V[j][1], ICO_V[i][2] - ICO_V[j][2]);
      if (Math.abs(d - 2) < 1e-6) edges.push([i, j]);
    }
  }
  return edges;
})();

export class FxCanvas {
  private ctx: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private flashes: Flash[] = [];
  private emitters = new Set<(dt: number) => void>();
  private glowCache = new Map<string, HTMLCanvasElement>();
  private raf = 0;
  private last = 0;
  private running = false;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private disposed = false;
  readonly maxParticles: number;
  /** Scales every burst's particle count (Lite quality runs well below 1). */
  readonly density: number;
  private readonly maxDpr: number;

  constructor(private canvas: HTMLCanvasElement, opts: { maxParticles?: number; density?: number; maxDpr?: number } = {}) {
    this.ctx = canvas.getContext("2d")!;
    this.maxParticles = opts.maxParticles ?? 2600;
    this.density = Math.max(0.05, Math.min(1, opts.density ?? 1));
    this.maxDpr = opts.maxDpr ?? 2;
    this.resize();
  }

  get width() {
    return this.w;
  }
  get height() {
    return this.h;
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    this.w = this.canvas.clientWidth || window.innerWidth;
    this.h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }

  private glowSprite(color: string): HTMLCanvasElement {
    let c = this.glowCache.get(color);
    if (!c) {
      c = document.createElement("canvas");
      c.width = c.height = 64;
      const g = c.getContext("2d")!;
      const [r, gr, b] = parseColor(color);
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, `rgba(255,255,255,1)`);
      grad.addColorStop(0.18, `rgba(${r},${gr},${b},0.95)`);
      grad.addColorStop(0.5, `rgba(${r},${gr},${b},0.25)`);
      grad.addColorStop(1, `rgba(${r},${gr},${b},0)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
      this.glowCache.set(color, c);
    }
    return c;
  }

  private spawn(p: Partial<Particle> & Pick<Particle, "kind" | "x" | "y" | "color">): Particle | null {
    if (this.particles.length >= this.maxParticles) return null;
    const full: Particle = {
      vx: 0,
      vy: 0,
      age: 0,
      life: 1,
      size: 3,
      alpha: 1,
      gravity: 0,
      drag: 0,
      rot: Math.random() * Math.PI * 2,
      vr: 0,
      flip: Math.random() * Math.PI * 2,
      vflip: 0,
      sway: 0,
      twinkle: 0,
      grow: 0,
      trail: 0,
      ...p,
    };
    this.particles.push(full);
    this.wake();
    return full;
  }

  burst(x: number, y: number, o: BurstOptions): void {
    // Thinned proportionally; the fraction is rolled so trickle emitters
    // (one particle per call) thin out too instead of rounding back up.
    const scaled = o.count * this.density;
    const count = this.density >= 1 ? o.count : Math.floor(scaled) + (Math.random() < scaled % 1 ? 1 : 0);
    for (let i = 0; i < count; i++) {
      const a = o.angle === undefined ? Math.random() * Math.PI * 2 : o.angle + (Math.random() - 0.5) * (o.spread ?? Math.PI * 2);
      const s = rand(o.speed[0], o.speed[1]);
      const kind = o.kind;
      this.spawn({
        kind,
        x: x + (o.jitter ? (Math.random() - 0.5) * o.jitter : 0),
        y: y + (o.jitter ? (Math.random() - 0.5) * o.jitter : 0),
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: rand(o.life[0], o.life[1]),
        size: rand(o.size[0], o.size[1]),
        color: pick(o.colors),
        gravity: o.gravity ?? 0,
        drag: o.drag ?? 0,
        vr: kind === "confetti" || kind === "shard" || kind === "coin" ? rand(-8, 8) : 0,
        vflip: kind === "confetti" || kind === "coin" ? rand(4, 12) : 0,
        sway: kind === "confetti" || kind === "ash" ? rand(0.6, 1.6) : 0,
        twinkle: kind === "spark" || kind === "glow" ? rand(0, 1) : 0,
        trail: o.trail ?? 0,
        grow: kind === "smoke" ? rand(20, 50) : 0,
        points:
          kind === "shard"
            ? Array.from({ length: 3 }, (_, k) => {
                const ang = (k / 3) * Math.PI * 2 + rand(-0.5, 0.5);
                const r = rand(0.5, 1.2);
                return [Math.cos(ang) * r, Math.sin(ang) * r];
              }).flat()
            : undefined,
      });
    }
  }

  ring(x: number, y: number, color: string, maxR: number, life = 0.7, width = 6): void {
    this.rings.push({ x, y, r: 0, maxR, age: 0, life, color, width });
    this.wake();
  }

  flash(color: string, peak = 0.8, life = 0.5, x = this.w / 2, y = this.h / 2): void {
    this.flashes.push({ color, age: 0, life, peak, x, y });
    this.wake();
  }

  /** Registers a continuous spawner; returns a function that removes it. */
  emit(fn: (dt: number, fx: FxCanvas) => void): () => void {
    const bound = (dt: number) => fn(dt, this);
    this.emitters.add(bound);
    this.wake();
    return () => this.emitters.delete(bound);
  }

  /** Launches a firework shell that bursts at (tx, ty). */
  rocket(x: number, tx: number, ty: number, pattern: "peony" | "ring" | "willow" | "d20" | "crackle" | "heart", palette: readonly string[]): void {
    const dur = rand(0.9, 1.25);
    const vy = (ty - this.h) / dur - 0.5 * 260 * dur;
    const p = this.spawn({
      kind: "rocket",
      x,
      y: this.h + 10,
      vx: (tx - x) / dur,
      vy,
      life: dur,
      size: 2.4,
      color: palette[0],
      gravity: 260,
      trail: 1,
    });
    if (p) p.onDeath = (r) => this.explode(r.x, r.y, pattern, palette);
  }

  explode(x: number, y: number, pattern: "peony" | "ring" | "willow" | "d20" | "crackle" | "heart", palette: readonly string[]): void {
    this.flash(palette[1] ?? palette[0], 0.16, 0.35, x, y);
    const scale = Math.min(1.3, Math.max(0.7, Math.min(this.w, this.h) / 800));
    if (pattern === "ring") {
      const n = 70;
      const tilt = rand(0.35, 1);
      const rot = Math.random() * Math.PI;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const cx = Math.cos(a) * 260 * scale;
        const cy = Math.sin(a) * 260 * scale * tilt;
        this.spawn({
          kind: "spark",
          x,
          y,
          vx: cx * Math.cos(rot) - cy * Math.sin(rot),
          vy: cx * Math.sin(rot) + cy * Math.cos(rot),
          life: rand(1.1, 1.5),
          size: rand(1.6, 2.4),
          color: pick(palette),
          gravity: 60,
          drag: 1.2,
          twinkle: Math.random(),
          trail: 1,
        });
      }
    } else if (pattern === "d20") {
      // The shell draws a spinning icosahedron wireframe in sparks.
      const ry = Math.random() * Math.PI * 2;
      const rx = Math.random() * Math.PI * 2;
      const project = ([vx, vy, vz]: [number, number, number]) => {
        const x1 = vx * Math.cos(ry) + vz * Math.sin(ry);
        const z1 = -vx * Math.sin(ry) + vz * Math.cos(ry);
        const y1 = vy * Math.cos(rx) - z1 * Math.sin(rx);
        return [x1, y1] as const;
      };
      const speed = 150 * scale;
      for (const [a, b] of ICO_EDGES) {
        const pa = project(ICO_V[a]);
        const pb = project(ICO_V[b]);
        for (let k = 0; k <= 5; k++) {
          const t = k / 5;
          const px = pa[0] + (pb[0] - pa[0]) * t;
          const py = pa[1] + (pb[1] - pa[1]) * t;
          this.spawn({
            kind: "spark",
            x,
            y,
            vx: px * speed,
            vy: py * speed,
            life: rand(1.3, 1.6),
            size: rand(1.6, 2.2),
            color: pick(palette),
            gravity: 40,
            drag: 1.1,
            twinkle: Math.random(),
            trail: 1,
          });
        }
      }
    } else if (pattern === "heart") {
      for (let i = 0; i < 80; i++) {
        const t = (i / 80) * Math.PI * 2;
        const hx = 16 * Math.pow(Math.sin(t), 3);
        const hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
        this.spawn({ kind: "spark", x, y, vx: hx * 14 * scale, vy: hy * 14 * scale, life: rand(1.2, 1.5), size: 2, color: pick(palette), gravity: 40, drag: 1.2, trail: 1 });
      }
    } else {
      const willow = pattern === "willow";
      const n = willow ? 90 : 120;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        // Uniform in a disc of a sphere's projection looks fuller than on the rim only.
        const s = (willow ? 210 : 300) * scale * Math.sqrt(Math.random() * 0.35 + 0.65);
        const p = this.spawn({
          kind: "spark",
          x,
          y,
          vx: Math.cos(a) * s,
          vy: Math.sin(a) * s,
          life: willow ? rand(2.2, 3.0) : rand(1.0, 1.6),
          size: willow ? rand(1.4, 2) : rand(1.6, 2.6),
          color: willow ? pick(FIREWORK_COLORS.gold) : pick(palette),
          gravity: willow ? 90 : 70,
          drag: willow ? 1.8 : 1.3,
          twinkle: Math.random(),
          trail: willow ? 2.4 : 1,
        });
        if (p && pattern === "crackle" && Math.random() < 0.35) {
          p.onDeath = (d) =>
            this.burst(d.x, d.y, { count: 6, kind: "spark", colors: ["#ffffff", "#fff4c2"], speed: [40, 110], life: [0.15, 0.3], size: [1, 1.6], drag: 2 });
        }
      }
    }
  }

  clear(): void {
    this.particles = [];
    this.rings = [];
    this.flashes = [];
    this.emitters.clear();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.clear();
  }

  private wake(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (now: number) => {
    if (this.disposed) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    for (const e of this.emitters) e(dt);
    this.update(dt);
    this.draw();
    if (this.particles.length || this.rings.length || this.flashes.length || this.emitters.size) {
      this.raf = requestAnimationFrame(this.tick);
    } else {
      this.running = false;
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  };

  private update(dt: number): void {
    // Survivors and anything spawned during the update (rocket trails,
    // secondary bursts) land in the fresh array.
    const current = this.particles;
    this.particles = [];
    const dead: Particle[] = [];
    for (const p of current) {
      p.age += dt;
      if (p.age >= p.life) {
        if (p.onDeath) dead.push(p);
        continue;
      }
      const damp = Math.exp(-p.drag * dt);
      p.vx *= damp;
      p.vy = p.vy * damp + p.gravity * dt;
      p.x += p.vx * dt + (p.sway ? Math.sin(p.age * 3 * p.sway + p.flip) * p.sway * 22 * dt : 0);
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      p.flip += p.vflip * dt;
      if (p.grow) p.size += p.grow * dt;
      if (p.kind === "rocket" && Math.random() < 0.9) {
        this.spawn({
          kind: "ember",
          x: p.x + rand(-1.5, 1.5),
          y: p.y + 4,
          vx: rand(-15, 15),
          vy: rand(20, 60),
          life: rand(0.3, 0.6),
          size: rand(1, 2),
          color: "#ffd9a0",
          gravity: 40,
          drag: 2,
        });
      }
      this.particles.push(p);
    }
    for (const p of dead) p.onDeath!(p);
    this.rings = this.rings.filter((r) => {
      r.age += dt;
      r.r = r.maxR * (1 - Math.pow(1 - Math.min(1, r.age / r.life), 3));
      return r.age < r.life;
    });
    this.flashes = this.flashes.filter((f) => {
      f.age += dt;
      return f.age < f.life;
    });
  }

  private draw(): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Normal-blended matter first (smoke, ash, confetti, coins, shards, rain)...
    ctx.globalCompositeOperation = "source-over";
    for (const p of this.particles) {
      const t = p.age / p.life;
      const fade = t < 0.1 ? t / 0.1 : 1 - Math.max(0, (t - 0.65) / 0.35);
      switch (p.kind) {
        case "smoke": {
          const a = p.alpha * (p.size > 30 ? 0.22 : 0.12) * Math.sin(Math.PI * t);
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
          const [r, gg, b] = parseColor(p.color);
          g.addColorStop(0, `rgba(${r},${gg},${b},${a})`);
          g.addColorStop(1, `rgba(${r},${gg},${b},0)`);
          ctx.fillStyle = g;
          ctx.fillRect(p.x - p.size, p.y - p.size, p.size * 2, p.size * 2);
          break;
        }
        case "ash": {
          ctx.globalAlpha = p.alpha * fade * 0.8;
          ctx.fillStyle = p.color;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
          ctx.restore();
          break;
        }
        case "rain": {
          ctx.globalAlpha = p.alpha * fade;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.size;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
          ctx.stroke();
          break;
        }
        case "confetti": {
          ctx.globalAlpha = fade;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          const sy = Math.cos(p.flip);
          ctx.scale(1, sy);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6);
          // Foil catches the light as it turns.
          if (sy > 0.85) {
            ctx.fillStyle = "rgba(255,255,255,0.55)";
            ctx.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.18);
          }
          ctx.restore();
          break;
        }
        case "coin": {
          ctx.globalAlpha = fade;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot * 0.2);
          const sx = Math.abs(Math.cos(p.flip));
          ctx.scale(Math.max(0.08, sx), 1);
          const g = ctx.createLinearGradient(-p.size, -p.size, p.size, p.size);
          g.addColorStop(0, "#fff4c2");
          g.addColorStop(0.45, "#e9b949");
          g.addColorStop(1, "#8a5a12");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(0, 0, p.size, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "rgba(90,55,5,0.8)";
          ctx.lineWidth = p.size * 0.14;
          ctx.stroke();
          ctx.restore();
          break;
        }
        case "shard": {
          ctx.globalAlpha = fade;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.scale(p.size, p.size);
          ctx.fillStyle = p.color;
          ctx.beginPath();
          const pts = p.points!;
          ctx.moveTo(pts[0], pts[1]);
          ctx.lineTo(pts[2], pts[3]);
          ctx.lineTo(pts[4], pts[5]);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
          break;
        }
      }
    }

    // ...then everything that glows, added on top.
    ctx.globalCompositeOperation = "lighter";
    for (const p of this.particles) {
      const t = p.age / p.life;
      const fade = 1 - t * t;
      if (p.kind === "spark" || p.kind === "rocket") {
        const tw = p.twinkle && t > 0.5 ? (Math.sin(p.age * 40 + p.twinkle * 10) > 0 ? 1 : 0.25) : 1;
        const a = p.alpha * fade * tw;
        if (p.trail) {
          ctx.globalAlpha = a * 0.7;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.size * 0.8;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 0.045 * p.trail, p.y - p.vy * 0.045 * p.trail);
          ctx.stroke();
        }
        const s = p.size * 5;
        ctx.globalAlpha = a;
        ctx.drawImage(this.glowSprite(p.color), p.x - s / 2, p.y - s / 2, s, s);
      } else if (p.kind === "ember" || p.kind === "glow") {
        const flicker = p.kind === "ember" ? 0.75 + Math.sin(p.age * 18 + p.flip) * 0.25 : 1;
        const inT = Math.min(1, t / 0.15);
        ctx.globalAlpha = p.alpha * inT * (1 - t) * flicker;
        const s = p.size * (p.kind === "glow" ? 4 : 5);
        ctx.drawImage(this.glowSprite(p.color), p.x - s / 2, p.y - s / 2, s, s);
      }
    }
    for (const r of this.rings) {
      const t = r.age / r.life;
      ctx.globalAlpha = (1 - t) * 0.9;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.width * (1 - t) + 1;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const f of this.flashes) {
      const t = f.age / f.life;
      const a = f.peak * (t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85);
      const R = Math.max(this.w, this.h) * 0.9;
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, R);
      const [r, gg, b] = parseColor(f.color);
      g.addColorStop(0, `rgba(${r},${gg},${b},${a})`);
      g.addColorStop(1, `rgba(${r},${gg},${b},0)`);
      ctx.globalAlpha = 1;
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.w, this.h);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
}

/** Common presets so every scene speaks the same visual language. */
export const Bursts = {
  sparks(fx: FxCanvas, x: number, y: number, colors: readonly string[] = FIREWORK_COLORS.gold, count = 60, power = 1) {
    fx.burst(x, y, { count, kind: "spark", colors: [...colors], speed: [120 * power, 520 * power], life: [0.5, 1.1], size: [1.4, 2.8], gravity: 380, drag: 1.4, trail: 1 });
  },
  embersRise(fx: FxCanvas, x: number, y: number, colors: readonly string[] = FIREWORK_COLORS.ember, count = 30, width = 200) {
    fx.burst(x, y, { count, kind: "ember", colors: [...colors], speed: [30, 120], angle: -Math.PI / 2, spread: 1.2, life: [1.2, 2.6], size: [1.2, 3], gravity: -30, drag: 0.8, jitter: width });
  },
  dust(fx: FxCanvas, x: number, y: number, strength: number) {
    fx.burst(x, y, { count: Math.round(3 + strength * 6), kind: "smoke", colors: ["#6f5f96"], speed: [30, 90 * (0.5 + strength)], angle: -Math.PI / 2, spread: Math.PI * 0.8, life: [0.35, 0.6], size: [6, 12], drag: 4, jitter: 18 });
    if (strength > 0.4) fx.burst(x, y, { count: Math.round(strength * 8), kind: "spark", colors: ["#ffe7b0"], speed: [60, 200], angle: -Math.PI / 2, spread: Math.PI * 0.8, life: [0.2, 0.45], size: [1, 1.6], gravity: 500, drag: 1 });
  },
  confettiCannon(fx: FxCanvas, x: number, y: number, angle: number, count = 90, colors: readonly string[] = ["#ffd76b", "#f5b73b", "#fff4c2", "#c084fc", "#7dd3fc", "#ff7a8a", "#6ee7b7"]) {
    fx.burst(x, y, { count, kind: "confetti", colors: [...colors], speed: [500, 1100], angle, spread: 0.55, life: [2.6, 4.2], size: [7, 13], gravity: 520, drag: 1.6 });
  },
  coins(fx: FxCanvas, x: number, y: number, count = 24) {
    fx.burst(x, y, { count, kind: "coin", colors: ["#e9b949"], speed: [260, 620], angle: -Math.PI / 2, spread: 1.4, life: [1.4, 2.2], size: [6, 10], gravity: 900, drag: 0.6 });
  },
  shatter(fx: FxCanvas, x: number, y: number, colors: readonly string[], count = 26, power = 1) {
    fx.burst(x, y, { count, kind: "shard", colors: [...colors], speed: [140 * power, 520 * power], life: [0.8, 1.5], size: [6, 16], gravity: 900, drag: 0.4 });
  },
};
