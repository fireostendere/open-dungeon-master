// Standalone 3D bestiary: a book with one creature per page. Everything (the
// catalog, the generator, three.js) is inlined into one HTML file by
// scripts/build-bestiary-3d.mjs, so it opens straight from disk.
//
// Each creature turns on a turntable: dragging rotates it around the
// vertical axis only, the camera never tilts.
import {
  ACESFilmicToneMapping, AmbientLight, BufferGeometry, CanvasTexture, CircleGeometry, Color, DirectionalLight, Float32BufferAttribute,
  Fog, GridHelper, Group, HemisphereLight, LineBasicMaterial, LineLoop, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderer, type Material,
} from "three";
import { buildCreature, deriveCreatureSpec, type CreatureInput, type CreatureModel, type CreatureSpec } from "../lib/bestiary3d";
import "./bestiary.css";

interface Row extends CreatureInput {
  cr: number;
  sources: string[];
}

const TYPE_RU: Record<string, string> = {
  aberration: "Аберрация", beast: "Зверь", celestial: "Небожитель", construct: "Конструкт", dragon: "Дракон",
  elemental: "Элементаль", fey: "Фея", fiend: "Исчадие", giant: "Великан", humanoid: "Гуманоид",
  monstrosity: "Монстр", ooze: "Слизь", plant: "Растение", undead: "Нежить", swarm: "Рой",
};
const TYPE_COLOR: Record<string, string> = {
  aberration: "#b06cf0", beast: "#b98a52", celestial: "#f5e7a6", construct: "#93a3b8", dragon: "#e0553f",
  elemental: "#4fc3d9", fey: "#6fd68c", fiend: "#c2263d", giant: "#d49a6a", humanoid: "#e2c6a0",
  monstrosity: "#d17a3c", ooze: "#7ad14a", plant: "#4f9b3e", undead: "#9aa58f", swarm: "#c6c15a",
};
const SIZE_RU: Record<string, string> = {
  tiny: "Крошечный", small: "Маленький", medium: "Средний", large: "Большой", huge: "Огромный", gargantuan: "Громадный", titanic: "Титанический",
};
const PLAN_RU: Record<string, string> = {
  biped: "Двуногое", quadruped: "Четвероногое", theropod: "Двуногий ящер", dragon: "Дракон", serpent: "Змееподобное",
  avian: "Летун / птица", hexapod: "Насекомое", octopod: "Паук / краб", fish: "Рыба", blob: "Слизь / куча", spirit: "Дух",
  orb: "Парящий шар", tentacled: "Щупальца", swarm: "Рой", taur: "Тавр", cube: "Куб / сундук", vortex: "Вихрь",
  fungus: "Гриб", object: "Предмет",
};
const SPEED_RU: Record<string, string> = { walk: "ходьба", fly: "полёт", swim: "плавание", climb: "лазание", burrow: "копание" };
const SORTS = [
  { id: "name", label: "По алфавиту" },
  { id: "cr-asc", label: "Опасность ↑" },
  { id: "cr-desc", label: "Опасность ↓" },
  { id: "type", label: "По типу" },
] as const;
const IGNORED_FAMILIES = new Set(["", "none", "null", "any race", "any lineage", "miscellaneous creatures"]);

const rows: Row[] = JSON.parse(document.getElementById("bestiary-data")!.textContent || "[]");

const fmtCr = (cr: number) => (cr === 0.125 ? "1/8" : cr === 0.25 ? "1/4" : cr === 0.5 ? "1/2" : String(cr));
const feetToMeters = (ft: number) => `${+(ft * 0.3).toFixed(1)} м`;
const familyOf = (r: Row) => (r.group || r.subtype || "").trim();
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// ---------------------------------------------------------------------------
// viewer

const CELL = 1.5; // one 5-foot battle-grid square, in metres

class Viewer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(30, 1, 0.05, 2000);
  private readonly pivot = new Group();
  private readonly fixed = new Group();
  private model: CreatureModel | null = null;
  private human: CreatureModel | null = null;
  private footprint: LineLoop | null = null;
  private shadow: Mesh | null = null;
  private readonly grid: GridHelper;
  private readonly fog = new Fog(0x100e17, 10, 40);
  private readonly shadowTexture: CanvasTexture;
  private dist = 6;
  private lookY = 1;
  private lookX = 0;
  private zoom = 1;
  private yaw = 0;
  private velocity = 0;
  private dragging = false;
  private lastX = 0;
  private lastT = 0;
  private time = 0;
  private last = performance.now();
  private size = { x: 1, y: 1, z: 1 };
  private footprintHalf = CELL / 2;
  private humanSpec: CreatureSpec;
  get modelHeight(): number { return this.size.y; }
  autoRotate = false;
  animate = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  showHuman = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene.fog = this.fog;
    this.scene.add(new HemisphereLight(0xdfe8ff, 0x3a3040, 1.55));
    this.scene.add(new AmbientLight(0xffffff, 0.15));
    const sun = new DirectionalLight(0xfff0dd, 2.9);
    sun.position.set(3.5, 6, 4.5);
    this.scene.add(sun);
    const rim = new DirectionalLight(0x8ab4ff, 1.2);
    rim.position.set(-4, 3, -5);
    this.scene.add(rim);

    this.grid = new GridHelper(180, 120, 0x574f78, 0x2f2a45);
    (this.grid.material as Material).transparent = true;
    this.scene.add(this.grid, this.fixed, this.pivot);

    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0, "rgba(0,0,0,0.75)");
    grad.addColorStop(0.55, "rgba(0,0,0,0.35)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    this.shadowTexture = new CanvasTexture(c);
    this.humanSpec = deriveCreatureSpec({ slug: "ref-human", name: "Commoner", type: "humanoid", size: "medium" });

    canvas.addEventListener("pointerdown", (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastT = performance.now();
      this.velocity = 0;
      canvas.setPointerCapture(e.pointerId);
      canvas.classList.add("dragging");
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      const now = performance.now();
      const dx = e.clientX - this.lastX;
      // Only the horizontal drag matters: the model turns around its vertical axis.
      this.yaw += dx * 0.012;
      const dt = Math.max(1, now - this.lastT) / 1000;
      this.velocity = this.velocity * 0.5 + ((dx * 0.012) / dt) * 0.5;
      this.lastX = e.clientX;
      this.lastT = now;
    });
    const end = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      if (performance.now() - this.lastT > 90) this.velocity = 0;
      canvas.classList.remove("dragging");
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("dblclick", () => { this.yaw = 0; this.velocity = 0; this.zoom = 1; this.place(); });
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.zoom = Math.min(1.7, Math.max(0.55, this.zoom * Math.exp(e.deltaY * 0.001)));
      this.place();
    }, { passive: false });

    new ResizeObserver(() => this.resize()).observe(canvas.parentElement!);
    this.resize();
    requestAnimationFrame(this.frame);
  }

  private resize(): void {
    const box = this.canvas.parentElement!.getBoundingClientRect();
    const w = Math.max(2, Math.floor(box.width));
    const h = Math.max(2, Math.floor(box.height));
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Portrait stages need a wider vertical field to keep the creature framed.
    this.camera.fov = w / h < 0.85 ? 38 : 30;
    this.camera.updateProjectionMatrix();
    this.place();
  }

  private clearModel(): void {
    if (this.model) { this.pivot.remove(this.model.root); this.model.dispose(); this.model = null; }
    if (this.footprint) { this.fixed.remove(this.footprint); this.footprint.geometry.dispose(); (this.footprint.material as Material).dispose(); this.footprint = null; }
    if (this.shadow) { this.fixed.remove(this.shadow); this.shadow.geometry.dispose(); (this.shadow.material as Material).dispose(); this.shadow = null; }
  }

  setCreature(spec: CreatureSpec): void {
    this.clearModel();
    this.model = buildCreature(spec);
    this.pivot.add(this.model.root);
    this.size = { x: this.model.size.x, y: this.model.size.y, z: this.model.size.z };

    const half = (spec.footprintCells * CELL) / 2;
    this.footprintHalf = half;
    const pts = [-half, 0.012, -half, half, 0.012, -half, half, 0.012, half, -half, 0.012, half];
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(pts, 3));
    this.footprint = new LineLoop(geo, new LineBasicMaterial({ color: 0xe2b75b, transparent: true, opacity: 0.9, fog: false }));
    this.fixed.add(this.footprint);

    const radius = Math.max(this.size.x, this.size.z) * 0.62 + 0.15;
    this.shadow = new Mesh(new CircleGeometry(1, 32), new MeshBasicMaterial({ map: this.shadowTexture, transparent: true, depthWrite: false, fog: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.006;
    this.shadow.scale.setScalar(radius);
    this.fixed.add(this.shadow);
    this.model.update(this.time);
    this.syncHuman();
    this.place();
  }

  setShowHuman(on: boolean): void {
    this.showHuman = on;
    this.syncHuman();
    this.place();
  }

  private syncHuman(): void {
    if (this.human) {
      this.fixed.remove(this.human.root);
      this.human.dispose();
      this.human = null;
    }
    if (!this.showHuman || !this.model) return;
    const human = buildCreature(this.humanSpec);
    const seen = new Set<Material>();
    human.root.traverse((o) => {
      const m = (o as Mesh).material as Material | Material[] | undefined;
      for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
        if (seen.has(mat)) continue;
        seen.add(mat);
        mat.transparent = true;
        mat.opacity = Math.min(mat.opacity, 0.5);
        mat.depthWrite = false;
        if ((mat as MeshStandardMaterial).color) (mat as MeshStandardMaterial).color.lerp(new Color(0x9fb6d8), 0.7);
      }
    });
    const x = -(Math.max(this.size.x, this.size.z, CELL) / 2 + 0.75);
    human.root.position.set(x, 0, 0);
    this.fixed.add(human.root);
    this.human = human;
  }

  private place(): void {
    const humanReach = this.human ? Math.max(this.size.x, this.size.z, CELL) / 2 + 1.5 : 0;
    const w = this.size.x;
    const h = this.size.y;
    const d = this.size.z;
    const radius = 0.5 * Math.hypot(w, h, d);
    // Keep the creature's own battle-grid square in frame too, so its size against the grid reads at a glance.
    const footprintReach = this.footprintHalf * Math.SQRT2 * 0.8;
    const framed = Math.max(radius, footprintReach, humanReach + 0.2, this.human ? 1.1 : 0);
    const fov = (this.camera.fov * Math.PI) / 180;
    // Fit the bounding sphere in the vertical field and, on wide stages, keep it inside the horizontal one too.
    const distV = framed / Math.sin(fov / 2);
    const distH = framed / Math.sin(Math.atan(Math.tan(fov / 2) * this.camera.aspect));
    this.dist = Math.max(distV, distH) * 1.06 * this.zoom;
    this.lookY = h * 0.46;
    this.lookX = this.human ? -humanReach / 2 + 0.2 : 0;
    // The camera sits a little to the side so the battle grid reads as a floor, not as scan lines.
    const elev = 0.3;
    const az = 0.6;
    this.camera.position.set(
      this.lookX + Math.sin(az) * Math.cos(elev) * this.dist,
      this.lookY + Math.sin(elev) * this.dist,
      Math.cos(az) * Math.cos(elev) * this.dist,
    );
    this.camera.lookAt(this.lookX, this.lookY, 0);
    this.fog.near = this.dist * 1.1;
    this.fog.far = this.dist * 2.6;
  }

  private frame = (now: number): void => {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.animate) this.time += dt;
    if (!this.dragging) {
      this.yaw += (this.velocity + (this.autoRotate ? 0.55 : 0)) * dt;
      this.velocity *= Math.exp(-dt * 3.2);
      if (Math.abs(this.velocity) < 0.003) this.velocity = 0;
    }
    this.pivot.rotation.y = this.yaw;
    this.model?.update(this.time);
    this.human?.update(this.time);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.frame);
  };
}

// ---------------------------------------------------------------------------
// page shell

const app = document.getElementById("app")!;
const typeOptions = Object.keys(TYPE_RU).map((t) => `<option value="${t}">${TYPE_RU[t]}</option>`).join("");
const sizeOptions = Object.keys(SIZE_RU).map((s) => `<option value="${s}">${SIZE_RU[s]}</option>`).join("");
const sortOptions = SORTS.map((s) => `<option value="${s.id}">${s.label}</option>`).join("");

const familyCounts = new Map<string, number>();
for (const r of rows) {
  const f = familyOf(r);
  if (!IGNORED_FAMILIES.has(f.toLowerCase())) familyCounts.set(f, (familyCounts.get(f) ?? 0) + 1);
}
const families = [...familyCounts.entries()].filter(([, n]) => n >= 3).sort((a, b) => a[0].localeCompare(b[0]));
const familyOptions = families.map(([f, n]) => `<option value="${esc(f)}">${esc(f)} (${n})</option>`).join("");

app.innerHTML = `
<div class="app">
  <aside class="index" id="index" aria-label="Оглавление">
    <div class="index-head">
      <div class="brand"><h1>Бестиарий</h1><span>D&amp;D 5e · 3D</span></div>
      <input class="search" id="search" type="search" placeholder="Поиск по названию  ( / )" autocomplete="off" spellcheck="false">
      <div class="filters">
        <select id="f-type" aria-label="Тип существа"><option value="">Все типы</option>${typeOptions}</select>
        <select id="f-size" aria-label="Размер"><option value="">Любой размер</option>${sizeOptions}</select>
        <select id="f-family" class="wide" aria-label="Семейство или раса"><option value="">Все семейства и расы</option>${familyOptions}</select>
        <select id="f-sort" class="wide" aria-label="Порядок">${sortOptions}</select>
      </div>
      <p class="count" id="count"></p>
    </div>
    <div class="list" id="list"></div>
  </aside>
  <div class="scrim" id="scrim"></div>
  <main class="book">
    <div class="topbar">
      <button class="chip toc-btn" id="toc" type="button">☰ Оглавление</button>
      <span class="spacer"></span>
      <button class="chip" id="t-rotate" type="button" aria-pressed="false">↻ Автоповорот</button>
      <button class="chip" id="t-anim" type="button" aria-pressed="true">▶ Анимация</button>
      <button class="chip" id="t-human" type="button" aria-pressed="false">Рост 1,75 м</button>
    </div>
    <div class="page" id="page">
      <div class="stage-wrap">
        <canvas id="stage" aria-label="3D-модель существа"></canvas>
        <button class="nav prev" id="prev" type="button" aria-label="Предыдущая страница">‹</button>
        <button class="nav next" id="next" type="button" aria-label="Следующая страница">›</button>
        <div class="stage-hint" id="hint">Тяните мышью: поворот вокруг вертикальной оси · колесо: приближение · двойной клик: сброс</div>
      </div>
      <section class="plate" id="plate"></section>
    </div>
    <div class="foot">
      <span id="pagelabel"></span>
      <span class="spacer"></span>
      <span class="keys"><kbd>←</kbd> <kbd>→</kbd> листать · <kbd>PgUp</kbd> <kbd>PgDn</kbd> ±10 · <kbd>Home</kbd> <kbd>End</kbd></span>
      <label>Страница <input class="pageinput" id="goto" type="number" min="1" inputmode="numeric"></label>
    </div>
  </main>
</div>`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const viewer = new Viewer($("stage") as HTMLCanvasElement);

const state = {
  filtered: rows.slice(),
  index: 0,
};

function applyFilters(keepSlug?: string): void {
  const q = ($("search") as HTMLInputElement).value.trim().toLowerCase();
  const type = ($("f-type") as HTMLSelectElement).value;
  const size = ($("f-size") as HTMLSelectElement).value;
  const family = ($("f-family") as HTMLSelectElement).value;
  const sort = ($("f-sort") as HTMLSelectElement).value;
  let list = rows.filter((r) => {
    if (type && r.type !== type) return false;
    if (size && r.size !== size) return false;
    if (family && familyOf(r) !== family) return false;
    if (q && !r.name.toLowerCase().includes(q) && !(TYPE_RU[r.type] ?? "").toLowerCase().includes(q)) return false;
    return true;
  });
  const byName = (a: Row, b: Row) => a.name.localeCompare(b.name);
  if (sort === "cr-asc") list = list.sort((a, b) => a.cr - b.cr || byName(a, b));
  else if (sort === "cr-desc") list = list.sort((a, b) => b.cr - a.cr || byName(a, b));
  else if (sort === "type") list = list.sort((a, b) => (TYPE_RU[a.type] ?? "").localeCompare(TYPE_RU[b.type] ?? "") || byName(a, b));
  else list = list.sort(byName);
  state.filtered = list;
  $("count").textContent = list.length === rows.length ? `${rows.length} существ` : `Найдено ${list.length} из ${rows.length}`;
  renderList();
  const keep = keepSlug ? list.findIndex((r) => r.slug === keepSlug) : -1;
  show(keep >= 0 ? keep : 0, 0, true);
}

function renderList(): void {
  const list = $("list");
  if (!state.filtered.length) {
    list.innerHTML = `<div class="empty">Ничего не найдено.</div>`;
    return;
  }
  list.innerHTML = state.filtered
    .map((r, i) => `<button class="entry" type="button" data-i="${i}"><span class="dot" style="background:${TYPE_COLOR[r.type] ?? "#888"}"></span><span class="nm">${esc(r.name)}</span><span class="cr">${fmtCr(r.cr)}</span></button>`)
    .join("");
}

function speedText(r: Row): string {
  const parts: string[] = [];
  for (const [k, label] of Object.entries(SPEED_RU)) {
    const raw = (r.speed as Record<string, unknown> | undefined)?.[k];
    const ft = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
    if (Number.isFinite(ft) && ft > 0) parts.push(`${label} ${feetToMeters(ft)}`);
  }
  return parts.join(", ") || "—";
}

function footprintHtml(cells: number): { text: string; icon: string } {
  if (cells < 1) return { text: "½ × ½ клетки", icon: `<span class="footprint" style="grid-template-columns:repeat(1,5px)"><i style="width:5px;height:5px"></i></span>` };
  const n = Math.round(cells);
  return {
    text: `${n} × ${n} ${n === 1 ? "клетка" : n < 5 ? "клетки" : "клеток"}`,
    icon: `<span class="footprint" style="grid-template-columns:repeat(${Math.min(n, 6)},9px)">${"<i></i>".repeat(Math.min(n, 6) ** 2)}</span>`,
  };
}

function renderPlate(r: Row, spec: CreatureSpec): void {
  const fp = footprintHtml(spec.footprintCells);
  const family = familyOf(r);
  $("plate").innerHTML = `
    <div class="kicker">${esc(TYPE_RU[r.type] ?? r.type)}${family && !IGNORED_FAMILIES.has(family.toLowerCase()) ? ` · ${esc(family)}` : ""}</div>
    <h2>${esc(r.name)}</h2>
    <p class="sub">${esc(SIZE_RU[spec.size] ?? spec.size)} · опасность ${fmtCr(r.cr)}</p>
    <div class="rule"></div>
    <dl class="facts">
      <dt>Скорость</dt><dd>${esc(speedText(r))}</dd>
      <dt>Занимает</dt><dd>${fp.text}${fp.icon}</dd>
      <dt>Высота модели</dt><dd>${viewer.modelHeight.toFixed(1).replace(".", ",")} м</dd>
      <dt>Силуэт</dt><dd>${esc(PLAN_RU[spec.plan] ?? spec.plan)}</dd>
    </dl>
    <div class="rule"></div>
    <div class="kicker" style="margin-bottom:6px">Источники</div>
    <div class="tags">${r.sources.map((s) => `<span class="tag">${esc(s)}</span>`).join("")}</div>`;
}

function show(i: number, dir: number, silent = false): void {
  const n = state.filtered.length;
  if (!n) {
    $("plate").innerHTML = "";
    $("pagelabel").textContent = "";
    return;
  }
  state.index = Math.max(0, Math.min(n - 1, i));
  const row = state.filtered[state.index]!;
  const spec = deriveCreatureSpec(row);
  viewer.setCreature(spec);
  renderPlate(row, spec);

  ($("prev") as HTMLButtonElement).disabled = state.index === 0;
  ($("next") as HTMLButtonElement).disabled = state.index === n - 1;
  $("pagelabel").textContent = `Страница ${state.index + 1} из ${n}`;
  ($("goto") as HTMLInputElement).max = String(n);
  ($("goto") as HTMLInputElement).value = "";
  ($("goto") as HTMLInputElement).placeholder = String(state.index + 1);

  document.querySelectorAll<HTMLElement>(".entry[aria-current]").forEach((e) => e.removeAttribute("aria-current"));
  const cur = $("list").querySelector<HTMLElement>(`.entry[data-i="${state.index}"]`);
  cur?.setAttribute("aria-current", "true");
  if (!silent) cur?.scrollIntoView({ block: "nearest" });
  else cur?.scrollIntoView({ block: "center" });

  try { history.replaceState(null, "", `#${encodeURIComponent(row.slug)}`); } catch { /* file:// in some browsers */ }
  document.title = `${row.name} · Бестиарий 3D`;

  const page = $("page");
  page.classList.remove("turn-next", "turn-prev");
  if (dir !== 0) {
    void page.offsetWidth;
    page.classList.add(dir > 0 ? "turn-next" : "turn-prev");
  }
}

// ---------------------------------------------------------------------------
// wiring

$("prev").addEventListener("click", () => show(state.index - 1, -1));
$("next").addEventListener("click", () => show(state.index + 1, 1));
$("list").addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>(".entry");
  if (!btn) return;
  const i = Number(btn.dataset.i);
  show(i, i >= state.index ? 1 : -1);
  closeToc();
});
// Narrowing the list keeps you on the current creature when it still qualifies; a new order starts from its first page.
for (const id of ["f-type", "f-size", "f-family"]) $(id).addEventListener("change", () => applyFilters(state.filtered[state.index]?.slug));
$("f-sort").addEventListener("change", () => applyFilters());
let searchTimer = 0;
$("search").addEventListener("input", () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => applyFilters(state.filtered[state.index]?.slug), 120);
});
$("goto").addEventListener("keydown", (e) => {
  if ((e as KeyboardEvent).key !== "Enter") return;
  const v = Number(($("goto") as HTMLInputElement).value);
  if (Number.isFinite(v) && v >= 1) show(v - 1, v - 1 >= state.index ? 1 : -1);
});

const toggle = (id: string, on: (v: boolean) => void) => {
  const el = $(id);
  el.addEventListener("click", () => {
    const next = el.getAttribute("aria-pressed") !== "true";
    el.setAttribute("aria-pressed", String(next));
    on(next);
  });
};
toggle("t-rotate", (v) => { viewer.autoRotate = v; });
toggle("t-anim", (v) => { viewer.animate = v; });
toggle("t-human", (v) => viewer.setShowHuman(v));
$("t-anim").setAttribute("aria-pressed", String(viewer.animate));

const openToc = () => { $("index").classList.add("open"); $("scrim").classList.add("open"); };
const closeToc = () => { $("index").classList.remove("open"); $("scrim").classList.remove("open"); };
$("toc").addEventListener("click", openToc);
$("scrim").addEventListener("click", closeToc);

window.addEventListener("keydown", (e) => {
  const target = e.target as HTMLElement;
  const typing = target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA";
  if (e.key === "/" && !typing) { e.preventDefault(); $("search").focus(); return; }
  if (e.key === "Escape") { (document.activeElement as HTMLElement | null)?.blur(); closeToc(); return; }
  if (typing) return;
  const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "PageDown" ? 10 : e.key === "PageUp" ? -10 : 0;
  if (step) { e.preventDefault(); show(state.index + step, step > 0 ? 1 : -1); }
  else if (e.key === "Home") { e.preventDefault(); show(0, -1); }
  else if (e.key === "End") { e.preventDefault(); show(state.filtered.length - 1, 1); }
});

setTimeout(() => $("hint").classList.add("gone"), 6000);
$("stage").addEventListener("pointerdown", () => $("hint").classList.add("gone"), { once: true });

// Start on the page named in the URL hash, else the first creature.
applyFilters(decodeURIComponent(location.hash.slice(1)));
