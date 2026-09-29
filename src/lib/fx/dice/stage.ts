// three.js dice stage: a transparent WebGL layer that throws real polyhedral
// dice onto an invisible table over the game UI.
//
// The stage knows nothing about rolls or React. Callers hand it dice specs
// (shape, face value, palette) and outcome cues; it answers with impact
// events and screen positions so DOM/2D effects can be layered on top.

import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  AmbientLight,
  BackSide,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  HemisphereLight,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  NoColorSpace,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  PointLight,
  Quaternion,
  Scene,
  ShadowMaterial,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Vector3,
  WebGLRenderer,
  type IUniform,
  type Texture,
} from "three";
import { buildDiceAtlas, DICE_PALETTES, ensureDiceFont, mulberry32, type DicePaletteId } from "./atlas";
import { dieShape, faceIndexFor, restPose, type DieKind, type DieShape } from "./geometry";
import { orientationFor, planThrow, supportHeight, type ThrowPlan } from "./motion";

export type StageDie = {
  kind: DieKind;
  /** Face value to land on (d10/d10x: 1..10, where 10 is printed 0 / 00). */
  value: number;
  palette: DicePaletteId;
  /** Advantage/disadvantage loser: shown, then dimmed. */
  dropped?: boolean;
};

export type DieOutcome = "neutral" | "success" | "fail" | "crit" | "fumble" | "dropped" | "kept";

export type StageLayout = { x: number; y: number; width: number; height: number };

export type DiceStageOptions = {
  onImpact?: (strength: number, x: number, y: number) => void;
  reducedMotion?: boolean;
  /** Tests drive time through `tick()` instead of requestAnimationFrame. */
  manualClock?: boolean;
};

type Tween = { from: number; to: number; start: number; dur: number; set: (v: number) => void; ease: (t: number) => number };

type LiveDie = {
  spec: StageDie;
  shape: DieShape;
  size: number;
  mesh: Mesh;
  material: MeshPhysicalMaterial;
  uniforms: { uHighlight: IUniform<number>; uBaseGlow: IUniform<number>; uFaceGlow: IUniform<number> };
  glow: Sprite;
  mode: "hover" | "tossed" | "throw" | "rest" | "lift";
  plan: ThrowPlan | null;
  planStart: number;
  impactIndex: number;
  target: Vector3;
  rest: Quaternion;
  pos: Vector3;
  quat: Quaternion;
  omega: Vector3;
  hoverBase: Vector3;
  phase: number;
  lift: { from: Vector3; fromQ: Quaternion; to: Vector3; toQ: Quaternion; start: number; dur: number } | null;
  cracked: boolean;
};

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = (t: number) => {
  const c1 = 1.4;
  return 1 + (c1 + 1) * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

const GEOMETRY_CACHE = new Map<DieKind, BufferGeometry>();

function geometryFor(shape: DieShape): BufferGeometry {
  const cached = GEOMETRY_CACHE.get(shape.kind);
  if (cached) return cached;
  // UV layout is identical across palettes, so any palette's atlas will do.
  const atlas = buildDiceAtlas(shape, DICE_PALETTES.arcane);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const faceIds: number[] = [];
  shape.faces.forEach((face, fi) => {
    const uv = atlas.uvs[fi];
    for (let k = 1; k < face.verts.length - 1; k++) {
      for (const idx of [0, k, k + 1]) {
        const v = shape.vertices[face.verts[idx]];
        positions.push(v[0], v[1], v[2]);
        normals.push(face.normal[0], face.normal[1], face.normal[2]);
        uvs.push(uv[idx][0], uv[idx][1]);
        faceIds.push(fi);
      }
    }
  });
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geo.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geo.setAttribute("faceId", new Float32BufferAttribute(faceIds, 1));
  geo.computeBoundingSphere();
  GEOMETRY_CACHE.set(shape.kind, geo);
  return geo;
}

function glowTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(255,255,255,0.45)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** A gilded summoning circle drawn once and laid on the table under the dice. */
function runeCircleTexture(): CanvasTexture {
  const S = 1024;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d")!;
  const cx = S / 2;
  ctx.translate(cx, cx);
  ctx.strokeStyle = "#fff";
  ctx.fillStyle = "#fff";
  const ring = (r: number, w: number, a = 1) => {
    ctx.globalAlpha = a;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  };
  ring(490, 6);
  ring(470, 2, 0.7);
  ring(360, 3, 0.85);
  ring(345, 1.5, 0.5);
  ring(150, 2, 0.6);
  // Tick marks between the outer rings.
  ctx.globalAlpha = 0.75;
  for (let i = 0; i < 120; i++) {
    const a = (i / 120) * Math.PI * 2;
    const long = i % 6 === 0;
    ctx.lineWidth = long ? 3 : 1.5;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 470, Math.sin(a) * 470);
    ctx.lineTo(Math.cos(a) * (long ? 430 : 452), Math.sin(a) * (long ? 430 : 452));
    ctx.stroke();
  }
  // Twenty glyphs, one per face of the d20.
  const rng = mulberry32(20);
  ctx.globalAlpha = 0.9;
  ctx.lineCap = "round";
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    ctx.save();
    ctx.rotate(a);
    ctx.translate(0, -400);
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    const strokes = 2 + Math.floor(rng() * 3);
    for (let s = 0; s < strokes; s++) {
      const x0 = (rng() - 0.5) * 26;
      const y0 = (rng() - 0.5) * 34;
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0 + (rng() - 0.5) * 30, y0 + (rng() - 0.5) * 36);
    }
    ctx.stroke();
    ctx.restore();
  }
  // Interlaced triangles: the d20's silhouette.
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 3;
  for (const offset of [0, Math.PI / 3]) {
    ctx.beginPath();
    for (let k = 0; k <= 3; k++) {
      const a = offset + (k / 3) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(a) * 345;
      const y = Math.sin(a) * 345;
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** A small emissive room so glossy resin picks up warm/cool reflections. */
function buildEnvironment(renderer: WebGLRenderer): Texture {
  const env = new Scene();
  const room = new Mesh(new BoxGeometry(20, 12, 20), new MeshBasicMaterial({ color: 0x0c0818, side: BackSide }));
  env.add(room);
  const panel = (color: number, intensity: number, w: number, h: number, pos: [number, number, number]) => {
    const m = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color: new Color(color).multiplyScalar(intensity) }));
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  panel(0xffd9a0, 7, 6, 4, [-5, 5.5, 4]);
  panel(0x8b6cff, 5, 5, 6, [6, 3, -5]);
  panel(0x5ad1ff, 2.5, 8, 2, [0, 5.9, -6]);
  panel(0x6a4cff, 0.7, 10, 2, [0, -3, 7]);
  const pmrem = new PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.035).texture;
  pmrem.dispose();
  return tex;
}

export class DiceStage {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(30, 1, 0.1, 100);
  private dice: LiveDie[] = [];
  private tweens: Tween[] = [];
  private time = 0;
  private last = 0;
  private raf = 0;
  private disposed = false;
  private layout: StageLayout = { x: 0, y: 0, width: 1, height: 1 };
  private glowTex: CanvasTexture;
  private rune: Mesh;
  private runeMat: MeshBasicMaterial;
  private verdictLight: PointLight;
  private key: DirectionalLight;
  private shake = 0;
  /** Camera pitch in degrees: lower while dice fly, overhead once they rest. */
  private elevation = 56;
  private settleWaiters: (() => void)[] = [];
  private rng = mulberry32(Date.now() & 0xffff);
  private readonly opts: DiceStageOptions;
  private readonly canvas: HTMLCanvasElement;
  private textures = new Map<string, { map: CanvasTexture; emissive: CanvasTexture; bump: CanvasTexture }>();

  static async create(canvas: HTMLCanvasElement, opts: DiceStageOptions = {}): Promise<DiceStage> {
    await ensureDiceFont();
    return new DiceStage(canvas, opts);
  }

  private constructor(canvas: HTMLCanvasElement, opts: DiceStageOptions) {
    this.canvas = canvas;
    this.opts = opts;
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;

    this.scene.environment = buildEnvironment(this.renderer);
    this.scene.add(new HemisphereLight(0x9d8cff, 0x1a0f30, 0.55));
    this.scene.add(new AmbientLight(0x2a1f4a, 0.4));

    const key = new DirectionalLight(0xffe2b8, 2.4);
    key.position.set(-3.5, 9, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -8;
    key.shadow.camera.right = 8;
    key.shadow.camera.top = 8;
    key.shadow.camera.bottom = -8;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 30;
    key.shadow.bias = -0.0015;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 4;
    this.key = key;
    this.scene.add(key);
    const rim = new DirectionalLight(0x8b6cff, 1.6);
    rim.position.set(4, 3.5, -6);
    this.scene.add(rim);

    this.verdictLight = new PointLight(0xffd27a, 0, 7, 1.6);
    this.verdictLight.position.set(0, 1.6, 0);
    this.scene.add(this.verdictLight);

    const floor = new Mesh(new PlaneGeometry(60, 60), new ShadowMaterial({ opacity: 0.55, color: 0x05020d }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    this.runeMat = new MeshBasicMaterial({
      map: runeCircleTexture(),
      color: 0xffcf6b,
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.rune = new Mesh(new PlaneGeometry(1, 1), this.runeMat);
    this.rune.rotation.x = -Math.PI / 2;
    this.rune.position.y = 0.004;
    this.scene.add(this.rune);

    this.glowTex = glowTexture();
    this.resize();
    this.last = performance.now();
    if (!opts.manualClock) this.raf = requestAnimationFrame(this.loop);
  }

  // ---------------------------------------------------------------- layout

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.frame();
  }

  /** Frames the table so the dice sit inside `layout` (CSS pixels). */
  setLayout(layout: StageLayout): void {
    this.layout = layout;
    this.frame();
  }

  private extent(): { hx: number; hz: number } {
    if (this.dice.length === 0) return { hx: 2.2, hz: 1.5 };
    let hx = 0;
    let hz = 0;
    for (const d of this.dice) {
      hx = Math.max(hx, Math.abs(d.target.x) + d.size * 1.3);
      hz = Math.max(hz, Math.abs(d.target.z) + d.size * 1.3);
    }
    return { hx: Math.max(hx, 2.1), hz: Math.max(hz, 1.4) };
  }

  private frame(): void {
    const W = this.canvas.clientWidth || window.innerWidth;
    const H = this.canvas.clientHeight || window.innerHeight;
    const { hx, hz } = this.extent();
    const elev = (this.elevation * Math.PI) / 180;
    const fov = (this.camera.fov * Math.PI) / 180;
    const lw = Math.max(80, this.layout.width);
    const lh = Math.max(80, this.layout.height);
    // Pixels per world unit that fit the tray (plus hover height) in the box.
    const ppu = Math.min(lw / (2 * hx * 1.08), lh / ((2 * hz * Math.sin(elev) + 2.2 * Math.cos(elev)) * 1.1));
    const dist = H / (2 * ppu * Math.tan(fov / 2));
    this.camera.position.set(0, Math.sin(elev) * dist, Math.cos(elev) * dist);
    this.camera.lookAt(0, 0.25, 0);
    const cx = this.layout.x + this.layout.width / 2;
    const cy = this.layout.y + this.layout.height / 2;
    this.camera.setViewOffset(W, H, W / 2 - cx, H / 2 - cy, W, H);
    this.camera.updateProjectionMatrix();
  }

  /** Screen position (CSS px) and apparent radius of die `i`. */
  project(i: number): { x: number; y: number; r: number } | null {
    const d = this.dice[i];
    if (!d) return null;
    const W = this.canvas.clientWidth || window.innerWidth;
    const H = this.canvas.clientHeight || window.innerHeight;
    const p = d.mesh.position.clone().project(this.camera);
    const edge = d.mesh.position.clone().add(new Vector3(d.size, 0, 0)).project(this.camera);
    const x = ((p.x + 1) / 2) * W;
    const y = ((1 - p.y) / 2) * H;
    return { x, y, r: Math.abs(((edge.x + 1) / 2) * W - x) };
  }

  // ---------------------------------------------------------------- dice

  private texturesFor(shape: DieShape, palette: DicePaletteId, cracked: boolean) {
    const key = `${shape.kind}:${palette}:${cracked}`;
    let t = this.textures.get(key);
    if (!t) {
      const atlas = buildDiceAtlas(shape, DICE_PALETTES[palette], cracked);
      const aniso = this.renderer.capabilities.getMaxAnisotropy();
      const map = new CanvasTexture(atlas.map);
      map.colorSpace = SRGBColorSpace;
      map.anisotropy = aniso;
      const emissive = new CanvasTexture(atlas.emissive);
      emissive.colorSpace = SRGBColorSpace;
      emissive.anisotropy = aniso;
      const bump = new CanvasTexture(atlas.bump);
      bump.colorSpace = NoColorSpace;
      t = { map, emissive, bump };
      this.textures.set(key, t);
    }
    return t;
  }

  private makeDie(spec: StageDie, size: number): LiveDie {
    const shape = dieShape(spec.kind);
    const palette = DICE_PALETTES[spec.palette];
    const tex = this.texturesFor(shape, spec.palette, false);
    const uniforms = {
      uHighlight: { value: -1 },
      uBaseGlow: { value: 0.18 },
      uFaceGlow: { value: 0.18 },
    };
    const material = new MeshPhysicalMaterial({
      map: tex.map,
      emissiveMap: tex.emissive,
      emissive: new Color(palette.glow),
      emissiveIntensity: 1,
      bumpMap: tex.bump,
      bumpScale: 1.4,
      envMapIntensity: 1.1,
      transparent: true,
      ...palette.material,
    });
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float faceId;\nvarying float vFaceId;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFaceId = faceId;");
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying float vFaceId;\nuniform float uHighlight;\nuniform float uBaseGlow;\nuniform float uFaceGlow;",
        )
        .replace(
          "#include <emissivemap_fragment>",
          "#include <emissivemap_fragment>\ntotalEmissiveRadiance *= abs(vFaceId - uHighlight) < 0.5 ? uFaceGlow : uBaseGlow;",
        );
    };
    material.customProgramCacheKey = () => "odm-die-face-glow";
    const mesh = new Mesh(geometryFor(shape), material);
    mesh.castShadow = true;
    mesh.scale.setScalar(size);
    this.scene.add(mesh);

    const glow = new Sprite(
      new SpriteMaterial({ map: this.glowTex, color: new Color(palette.glow), transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, depthTest: false }),
    );
    // Drawn first and without depth so the table never slices the halo.
    glow.renderOrder = -1;
    glow.scale.setScalar(size * 4.2);
    this.scene.add(glow);

    return {
      spec,
      shape,
      size,
      mesh,
      material,
      uniforms,
      glow,
      mode: "rest",
      plan: null,
      planStart: 0,
      impactIndex: 0,
      target: new Vector3(),
      rest: new Quaternion(),
      pos: new Vector3(),
      quat: new Quaternion(),
      omega: new Vector3(),
      hoverBase: new Vector3(),
      phase: this.rng() * Math.PI * 2,
      lift: null,
      cracked: false,
    };
  }

  private clearDice(): void {
    for (const d of this.dice) {
      this.scene.remove(d.mesh);
      this.scene.remove(d.glow);
      d.material.dispose();
      d.glow.material.dispose();
    }
    this.dice = [];
    this.tweens = [];
    this.verdictLight.intensity = 0;
    this.runeMat.opacity = 0;
  }

  private sizeFor(kind: DieKind, count: number): number {
    const base = count <= 2 ? 1.0 : count <= 6 ? 0.78 : count <= 12 ? 0.64 : 0.54;
    const shapeScale = kind === "d6" ? 0.82 : kind === "d4" ? 1.1 : kind === "d8" ? 0.95 : 1;
    return base * shapeScale;
  }

  /** Rest positions: one row for a few dice, a loose grid for a handful. */
  private layoutTargets(specs: StageDie[], sizes: number[]): Vector3[] {
    const n = specs.length;
    const maxSize = Math.max(...sizes);
    const gap = maxSize * 2.5;
    const cols = n <= 4 ? n : Math.ceil(Math.sqrt(n * 1.7));
    const rows = Math.ceil(n / cols);
    const out: Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / cols);
      const inRow = r === rows - 1 ? n - r * cols : cols;
      const c = i % cols;
      const x = (c - (inRow - 1) / 2) * gap + (n > 2 ? (this.rng() - 0.5) * gap * 0.22 : 0);
      const z = (r - (rows - 1) / 2) * gap * 0.92 + (n > 2 ? (this.rng() - 0.5) * gap * 0.2 : 0);
      out.push(new Vector3(x, 0, z));
    }
    return out;
  }

  private restFor(d: LiveDie, twist: number): Quaternion {
    const pose = restPose(d.shape, d.spec.value);
    return orientationFor(new Vector3(...pose.up), new Vector3(...pose.toward), twist);
  }

  /** Floating, slowly turning dice waiting for the player's click. */
  hover(specs: StageDie[]): void {
    this.clearDice();
    const sizes = specs.map((s) => this.sizeFor(s.kind, specs.length));
    const targets = this.layoutTargets(specs, sizes);
    specs.forEach((spec, i) => {
      const d = this.makeDie(spec, sizes[i]);
      d.target.copy(targets[i]);
      d.hoverBase.set(targets[i].x, 1.35 + d.size * 0.4, targets[i].z * 0.6);
      d.pos.copy(d.hoverBase);
      d.quat.copy(this.restFor(d, 0)).premultiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.9));
      d.omega.set(0.25, 0.7, 0.1);
      d.mode = "hover";
      this.dice.push(d);
    });
    this.rune.scale.setScalar(this.runeRadius() * 2);
    this.elevation = 50;
    this.tween(this.runeMat.opacity, 0.22, 0.8, (v) => (this.runeMat.opacity = v));
    for (const d of this.dice) this.tween(0, 0.35, 0.8, (v) => (d.glow.material.opacity = v));
    this.frame();
  }

  /** The player clicked: dice leap up and spin while the server rolls. */
  toss(): void {
    for (const d of this.dice) {
      if (d.mode !== "hover") continue;
      d.mode = "tossed";
      const from = d.pos.clone();
      const to = new Vector3(d.pos.x, 2.3 + d.size * 0.5, d.pos.z);
      this.tween(0, 1, 0.45, (v) => d.pos.lerpVectors(from, to, v), easeOutCubic);
      const axis = new Vector3(this.rng() - 0.5, this.rng() - 0.5, this.rng() - 0.5).normalize();
      const w0 = d.omega.clone();
      this.tween(0, 1, 0.35, (v) => d.omega.copy(w0).lerp(axis.clone().multiplyScalar(19), v), easeOutCubic);
    }
    this.tween(this.runeMat.opacity, 0.45, 0.4, (v) => (this.runeMat.opacity = v));
  }

  /**
   * Throws the dice onto the table. Dice already hovering/tossed continue
   * from where they are; otherwise they fly in from below the frame.
   * Resolves once every die has come to rest.
   */
  throw(specs: StageDie[]): Promise<void> {
    const reuse = this.dice.length === specs.length && this.dice.every((d, i) => d.spec.kind === specs[i].kind && (d.mode === "hover" || d.mode === "tossed"));
    const previous = reuse ? this.dice : [];
    if (!reuse) this.clearDice();
    const sizes = specs.map((s, i) => previous[i]?.size ?? this.sizeFor(s.kind, specs.length));
    const targets = this.layoutTargets(specs, sizes);
    if (!reuse) specs.forEach((spec, i) => this.dice.push(this.makeDie(spec, sizes[i])));

    this.dice.forEach((d, i) => {
      d.spec = specs[i];
      d.target.copy(targets[i]);
      const hero = specs.length <= 2;
      const twist = hero ? (this.rng() - 0.5) * 0.2 : (this.rng() - 0.5) * 0.9;
      d.rest.copy(this.restFor(d, twist));
      let start;
      if (reuse) {
        start = { pos: d.pos.clone(), quat: d.quat.clone(), vel: new Vector3(0, -0.5, 0), omega: d.omega.clone() };
      } else {
        const from = this.offscreenOrigin(targets[i], i, specs.length);
        start = { pos: from, quat: new Quaternion().setFromAxisAngle(new Vector3(this.rng(), this.rng(), this.rng()).normalize(), this.rng() * 6), vel: new Vector3(0, 1.5, 0) };
        d.pos.copy(from);
        d.quat.copy(start.quat);
      }
      d.plan = planThrow({
        shape: d.shape,
        size: d.size,
        target: d.target,
        rest: d.rest,
        start,
        rng: this.rng,
        delay: reuse ? 0 : i * 0.06 + this.rng() * 0.05,
      });
      d.planStart = this.time;
      d.impactIndex = 0;
      d.mode = "throw";
      if (this.opts.reducedMotion) {
        d.planStart = this.time - d.plan.duration;
        d.impactIndex = d.plan.impacts.length;
      }
    });
    this.rune.scale.setScalar(this.runeRadius() * 2);
    this.tween(this.runeMat.opacity, 0.12, 0.6, (v) => (this.runeMat.opacity = v));
    this.tween(this.elevation, 54, 0.5, (v) => (this.elevation = v), easeInOut);
    for (const d of this.dice) this.tween(d.glow.material.opacity, 0, 0.4, (v) => (d.glow.material.opacity = v));
    this.frame();
    return new Promise((resolve) => this.settleWaiters.push(resolve));
  }

  private restElevation(): number {
    return this.dice.length <= 2 ? 76 : 70;
  }

  private runeRadius(): number {
    const { hx, hz } = this.extent();
    return Math.min(3.4, Math.max(1.8, Math.max(hx, hz * 1.4) * 0.8));
  }

  /** A point below the bottom edge of the frame, on the way to `target`. */
  private offscreenOrigin(target: Vector3, i: number, n: number): Vector3 {
    const W = this.canvas.clientWidth || window.innerWidth;
    const H = this.canvas.clientHeight || window.innerHeight;
    const spread = n > 1 ? (i / (n - 1) - 0.5) * 0.5 : (this.rng() - 0.5) * 0.3;
    const sx = (0.5 + spread) * W;
    const ndc = new Vector3((sx / W) * 2 - 1, -1.12, 0.5).unproject(this.camera);
    const dir = ndc.sub(this.camera.position).normalize();
    const height = 1.6 + this.rng() * 0.8;
    const t = (height - this.camera.position.y) / dir.y;
    const p = this.camera.position.clone().add(dir.multiplyScalar(t));
    // Keep the arc short enough to land on its spot.
    p.x = target.x + (p.x - target.x) * 0.6;
    return p;
  }

  /** Visual verdict for one die. */
  setOutcome(i: number, outcome: DieOutcome): void {
    const d = this.dice[i];
    if (!d) return;
    const faceIndex = d.shape.kind === "d4" ? -1 : faceIndexFor(d.shape, d.spec.value);
    const u = d.uniforms;
    const glowTo = (base: number, face: number, dur = 0.5) => {
      this.tween(u.uBaseGlow.value, base, dur, (v) => (u.uBaseGlow.value = v));
      this.tween(u.uFaceGlow.value, face, dur, (v) => (u.uFaceGlow.value = v));
    };
    u.uHighlight.value = faceIndex;
    const color = (hex: string) => {
      d.material.emissive.set(hex);
      (d.glow.material as SpriteMaterial).color.set(hex);
    };
    switch (outcome) {
      case "neutral":
      case "kept":
        glowTo(0.12, faceIndex < 0 ? 0.9 : 1.6);
        break;
      case "success":
        color("#ffd76b");
        glowTo(0.1, 2.4);
        this.flare(d, "#ffcf6b", 0.55, 5);
        break;
      case "fail":
        color("#ff5a4f");
        glowTo(0.05, 1.3);
        this.flare(d, "#ff3b3b", 0.3, 3);
        break;
      case "crit":
        color("#ffe08a");
        glowTo(0.6, 4.5, 0.35);
        this.flare(d, "#ffd24d", 1, 9);
        this.liftToCamera(d);
        this.shake = 0.5;
        break;
      case "fumble": {
        const tex = this.texturesFor(d.shape, d.spec.palette, true);
        d.material.map = tex.map;
        d.material.emissiveMap = tex.emissive;
        d.material.needsUpdate = true;
        d.cracked = true;
        color("#ff2a2a");
        glowTo(1.8, 2.2, 0.25);
        this.flare(d, "#ff2020", 0.7, 6);
        this.shake = 0.7;
        break;
      }
      case "dropped": {
        glowTo(0, 0, 0.4);
        const from = d.mesh.position.clone();
        const to = from.clone().add(new Vector3(0, 0, -0.5));
        this.tween(1, 0.38, 0.6, (v) => (d.material.opacity = v));
        this.tween(0, 1, 0.6, (v) => d.target.lerpVectors(from, to, v), easeInOut);
        this.tween(1, 0, 0.6, (v) => d.material.color.setScalar(0.45 + 0.55 * v));
        break;
      }
    }
  }

  private flare(d: LiveDie, color: string, rune: number, light: number): void {
    this.runeMat.color.set(color);
    this.rune.position.x = d.target.x;
    this.rune.position.z = d.target.z;
    this.tween(this.runeMat.opacity, rune, 0.25, (v) => (this.runeMat.opacity = v));
    this.tween(rune, rune * 0.45, 1.6, (v) => (this.runeMat.opacity = v), easeInOut, 0.35);
    this.verdictLight.color.set(color);
    this.verdictLight.position.set(d.target.x, 1.4 + d.size, d.target.z + 0.4);
    this.tween(0, light, 0.2, (v) => (this.verdictLight.intensity = v));
    this.tween(light, light * 0.35, 1.4, (v) => (this.verdictLight.intensity = v), easeInOut, 0.25);
    const glow = d.glow.material as SpriteMaterial;
    this.tween(0, 0.9, 0.2, (v) => (glow.opacity = v));
    this.tween(0.9, 0.45, 1.2, (v) => (glow.opacity = v), easeInOut, 0.2);
  }

  /** Crit reveal: the die rises and turns its winning face to the camera. */
  private liftToCamera(d: LiveDie): void {
    // Aim at where the camera will be once its overhead move finishes.
    const saved = this.elevation;
    this.elevation = this.restElevation();
    this.frame();
    const camPos = this.camera.position.clone();
    const camQuat = this.camera.quaternion.clone();
    this.elevation = saved;
    this.frame();
    const to = new Vector3(d.target.x * 0.6, 1.25 + d.size, d.target.z + 0.6);
    const camDir = camPos.sub(to).normalize();
    const camUp = new Vector3(0, 1, 0).applyQuaternion(camQuat);
    camUp.sub(camDir.clone().multiplyScalar(camUp.dot(camDir))).normalize();
    // Map the face frame (label-up, normal) onto the camera frame (up, toward viewer).
    const pose = restPose(d.shape, d.spec.value);
    const normal = new Vector3(...pose.up);
    const labelUp = new Vector3(...pose.toward).multiplyScalar(-1);
    const local = new Matrix4().makeBasis(labelUp.clone().cross(normal).normalize(), labelUp, normal);
    const world = new Matrix4().makeBasis(camUp.clone().cross(camDir).normalize(), camUp, camDir);
    const toQ = new Quaternion().setFromRotationMatrix(world).multiply(new Quaternion().setFromRotationMatrix(local).invert());
    d.lift = { from: d.mesh.position.clone(), fromQ: d.mesh.quaternion.clone(), to, toQ, start: this.time + 0.15, dur: 0.85 };
    d.mode = "lift";
  }

  // ---------------------------------------------------------------- loop

  private tween(from: number, to: number, dur: number, set: (v: number) => void, ease: (t: number) => number = easeOutCubic, delay = 0): void {
    if (this.opts.reducedMotion) {
      set(to);
      return;
    }
    this.tweens.push({ from, to, start: this.time + delay, dur, set, ease });
  }

  private loop = (now: number) => {
    if (this.disposed) return;
    this.tick(Math.min(0.05, Math.max(0, (now - this.last) / 1000)));
    this.last = now;
    this.raf = requestAnimationFrame(this.loop);
  };

  /** Advances the stage by `dt` seconds and renders one frame. */
  tick(dt: number): void {
    if (this.disposed) return;
    this.time += dt;
    this.step(dt);
    this.renderer.render(this.scene, this.camera);
  }

  private step(dt: number): void {
    const t = this.time;
    this.tweens = this.tweens.filter((tw) => {
      if (t < tw.start) return true;
      const k = Math.min(1, (t - tw.start) / tw.dur);
      tw.set(tw.from + (tw.to - tw.from) * tw.ease(k));
      return k < 1;
    });

    let throwing = false;
    for (const d of this.dice) {
      if (d.mode === "hover" || d.mode === "tossed") {
        const angle = d.omega.length() * dt;
        if (angle > 0) d.quat.premultiply(new Quaternion().setFromAxisAngle(d.omega.clone().normalize(), angle)).normalize();
        const bob = Math.sin(t * 2.1 + d.phase) * 0.08;
        d.mesh.position.set(d.pos.x, d.pos.y + bob, d.pos.z);
        d.mesh.quaternion.copy(d.quat);
      } else if (d.mode === "throw" && d.plan) {
        throwing = true;
        const local = t - d.planStart;
        d.plan.sample(Math.min(local, d.plan.duration), d.pos, d.quat);
        d.mesh.position.copy(d.pos);
        d.mesh.quaternion.copy(d.quat);
        while (d.impactIndex < d.plan.impacts.length && local >= d.plan.impacts[d.impactIndex].t) {
          const im = d.plan.impacts[d.impactIndex++];
          const p = this.project(this.dice.indexOf(d));
          if (p) this.opts.onImpact?.(im.strength, p.x, p.y + p.r * 0.6);
          if (im.strength > 0.5 && this.dice.length <= 2) this.shake = Math.max(this.shake, im.strength * 0.18);
        }
        if (local >= d.plan.duration) {
          d.mode = "rest";
          d.mesh.quaternion.copy(d.rest);
          d.pos.set(d.target.x, supportHeight(d.shape, d.size, d.rest), d.target.z);
          d.mesh.position.copy(d.pos);
        }
      } else if (d.mode === "rest") {
        // Targets can be tweened (dropped dice slide back).
        d.mesh.position.set(d.target.x, supportHeight(d.shape, d.size, d.mesh.quaternion), d.target.z);
      } else if (d.mode === "lift" && d.lift) {
        const k = Math.min(1, Math.max(0, (t - d.lift.start) / d.lift.dur));
        const e = easeOutBack(k);
        d.mesh.position.lerpVectors(d.lift.from, d.lift.to, e);
        d.mesh.quaternion.slerpQuaternions(d.lift.fromQ, d.lift.toQ, easeInOut(k));
        if (k >= 1) {
          // Keep a gentle levitation once presented.
          d.mesh.position.y = d.lift.to.y + Math.sin((t - d.lift.start) * 2.2) * 0.05;
        }
      }
      d.glow.position.copy(d.mesh.position);
      if (d.cracked) {
        d.uniforms.uBaseGlow.value = 1.2 + Math.sin(t * 7) * 0.5;
      }
    }
    this.rune.rotation.z += dt * 0.12;

    if (!throwing && this.settleWaiters.length && this.dice.every((d) => d.mode !== "throw")) {
      const waiters = this.settleWaiters;
      this.settleWaiters = [];
      waiters.forEach((w) => w());
      // Rise overhead so the resting faces read square-on.
      this.tween(this.elevation, this.restElevation(), 0.9, (v) => (this.elevation = v), easeInOut);
    }

    this.frame();
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 1.6);
      const s = this.shake * this.shake * 0.12;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
    }
  }

  isThrowing(): boolean {
    return this.dice.some((d) => d.mode === "throw");
  }

  clear(): void {
    this.clearDice();
    const waiters = this.settleWaiters;
    this.settleWaiters = [];
    waiters.forEach((w) => w());
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.clear();
    for (const t of this.textures.values()) {
      t.map.dispose();
      t.emissive.dispose();
      t.bump.dispose();
    }
    this.textures.clear();
    this.runeMat.map?.dispose();
    this.runeMat.dispose();
    this.glowTex.dispose();
    this.scene.environment?.dispose();
    this.renderer.dispose();
  }
}

/** True when WebGL is usable; the overlay falls back to flat dice otherwise. */
export function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

