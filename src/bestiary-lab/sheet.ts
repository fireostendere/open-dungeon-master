// QA contact sheet: renders many creatures side by side in one canvas so a
// headless screenshot shows what the generator produces. Dev tool only, see
// scripts/bestiary-contact-sheet.mjs.
import {
  ACESFilmicToneMapping, Color, DirectionalLight, HemisphereLight, PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderer,
  CircleGeometry, Mesh, MeshBasicMaterial, GridHelper,
} from "three";
import { buildCreature, deriveCreatureSpec, type CreatureInput } from "../lib/bestiary3d";

declare global {
  interface Window {
    __ROWS__: CreatureInput[];
    __OPTS__: { cols: number; cell: number; time: number; yaw: number; grid: boolean };
    __DONE__?: boolean;
  }
}

const rows = window.__ROWS__;
const { cols, cell, time, yaw, grid } = window.__OPTS__;
const nrows = Math.ceil(rows.length / cols);
const canvas = document.createElement("canvas");
document.body.appendChild(canvas);
const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(cols * cell, nrows * cell);
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.setScissorTest(true);
renderer.setClearColor(new Color("#1c1a24"));

const scene = new Scene();
scene.add(new HemisphereLight("#dfe8ff", "#3a3040", 1.5));
const sun = new DirectionalLight("#fff3dd", 2.6);
sun.position.set(3, 6, 4);
scene.add(sun);
const rim = new DirectionalLight("#8ab4ff", 1.1);
rim.position.set(-4, 3, -5);
scene.add(rim);
const floor = new Mesh(new CircleGeometry(1, 40), new MeshBasicMaterial({ color: "#2b2836" }));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);
if (grid) scene.add(new GridHelper(20, 40, "#3a3648", "#2f2c3a"));

const camera = new PerspectiveCamera(32, 1, 0.05, 500);

rows.forEach((row, i) => {
  const spec = deriveCreatureSpec(row);
  const model = buildCreature(spec);
  model.update(time);
  model.root.rotation.y = yaw;
  scene.add(model.root);
  const size = model.size;
  const span = Math.max(size.x, size.z, size.y * 0.9);
  floor.scale.setScalar(span * 0.75);
  const dist = span * 2.3 + 0.3;
  camera.position.set(0, size.y * 0.55 + span * 0.25, dist);
  camera.lookAt(0, size.y * 0.45, 0);
  camera.aspect = 1;
  camera.updateProjectionMatrix();
  const cx = (i % cols) * cell;
  const cy = (nrows - 1 - Math.floor(i / cols)) * cell;
  renderer.setViewport(cx, cy, cell, cell);
  renderer.setScissor(cx, cy, cell, cell);
  renderer.render(scene, camera);
  scene.remove(model.root);
  model.dispose();

  const label = document.createElement("div");
  label.className = "label";
  label.style.left = `${cx}px`;
  label.style.top = `${Math.floor(i / cols) * cell}px`;
  label.style.width = `${cell}px`;
  label.textContent = `${row.name} · ${spec.plan}/${spec.look}`;
  document.body.appendChild(label);
});
window.__DONE__ = true;
