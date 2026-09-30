// Turns a 3D bestiary model into a small transparent picture the battle map
// can stand on a base: the miniature.
//
// Client only, and lazy. three.js and the bestiary (about 5k lines of model
// builders) are imported the first time a board with figures is shown, not
// with the page, and one renderer serves every figure. Each creature is drawn
// once, in turn, one per animation frame so a board with a dozen kinds of
// monster never stalls a phone, and the picture is kept for the session.
//
// It never throws at a caller. A device with no WebGL, a lost context or a
// model that will not build all come back as null, and the board keeps its
// plain coin for that piece.

import type { CreatureInput } from "@/lib/bestiary3d/spec";
import { figureInput, figureKey, figureScale, type FigureKind } from "@/lib/battlemap/figures";

export type FigureSprite = {
  url: string;
  // How large it draws next to a medium creature (figureScale).
  scale: number;
};

// Square, in pixels. Big enough to stay sharp at the map's highest zoom on a
// dense phone screen, small enough that a dozen fit in memory.
const SPRITE_PX = 256;
// Camera looks down at the model from the front, like a person leaning over a
// table at a miniature.
const PITCH_DEGREES = 32;

const cache = new Map<string, FigureSprite | null>();
const pending = new Map<string, Promise<FigureSprite | null>>();
let queue: Promise<unknown> = Promise.resolve();
let unavailable = false;

type Kit = {
  render: (input: CreatureInput) => FigureSprite | null;
};
let kit: Promise<Kit | null> | null = null;

async function loadKit(): Promise<Kit | null> {
  try {
    const [three, bestiary] = await Promise.all([import("three"), import("@/lib/bestiary3d")]);
    const canvas = document.createElement("canvas");
    canvas.width = SPRITE_PX;
    canvas.height = SPRITE_PX;
    const renderer = new three.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(SPRITE_PX, SPRITE_PX, false);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = three.SRGBColorSpace;
    renderer.toneMapping = three.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    const scene = new three.Scene();
    scene.add(new three.HemisphereLight("#dfe8ff", "#3a3040", 1.5));
    const sun = new three.DirectionalLight("#fff3dd", 2.6);
    sun.position.set(3, 6, 4);
    scene.add(sun);
    const rim = new three.DirectionalLight("#8ab4ff", 1.1);
    rim.position.set(-4, 3, -5);
    scene.add(rim);

    const camera = new three.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    const pitch = (PITCH_DEGREES * Math.PI) / 180;
    const corners = Array.from({ length: 8 }, () => new three.Vector3());

    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      unavailable = true;
    });

    return {
      render(input) {
        const spec = bestiary.deriveCreatureSpec(input);
        const model = bestiary.buildCreature(spec);
        try {
          // A still frame a little way into the idle loop, so limbs are not
          // in the rest pose every creature starts from.
          model.update(0.35);
          scene.add(model.root);
          model.root.updateMatrixWorld(true);
          const box = new three.Box3().setFromObject(model.root);
          const center = box.getCenter(new three.Vector3());
          camera.position.set(center.x, center.y + Math.sin(pitch) * 60, center.z + Math.cos(pitch) * 60);
          camera.lookAt(center);
          camera.updateMatrixWorld(true);

          // The model's box in the camera's own frame, to frame it tightly with
          // its feet on the bottom edge.
          let minX = Infinity;
          let maxX = -Infinity;
          let minY = Infinity;
          let maxY = -Infinity;
          for (let i = 0; i < 8; i += 1) {
            corners[i].set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
            corners[i].applyMatrix4(camera.matrixWorldInverse);
            minX = Math.min(minX, corners[i].x);
            maxX = Math.max(maxX, corners[i].x);
            minY = Math.min(minY, corners[i].y);
            maxY = Math.max(maxY, corners[i].y);
          }
          const side = Math.max(maxX - minX, maxY - minY) * 1.1;
          const midX = (minX + maxX) / 2;
          camera.left = midX - side / 2;
          camera.right = midX + side / 2;
          camera.bottom = minY - side * 0.05;
          camera.top = camera.bottom + side;
          camera.updateProjectionMatrix();

          renderer.render(scene, camera);
          const url = canvas.toDataURL("image/png");
          if (!url.startsWith("data:image/png")) return null;
          return { url, scale: figureScale(spec.size) };
        } finally {
          scene.remove(model.root);
          model.dispose();
        }
      },
    };
  } catch {
    return null;
  }
}

function drawOne(key: string, input: CreatureInput): Promise<FigureSprite | null> {
  const run = async (): Promise<FigureSprite | null> => {
    if (unavailable) return null;
    kit ??= loadKit();
    const ready = await kit;
    if (!ready) {
      unavailable = true;
      return null;
    }
    // One picture per frame, so a busy board stays smooth.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    try {
      return ready.render(input);
    } catch {
      return null;
    }
  };
  const result = queue.then(run, run);
  queue = result.catch(() => null);
  return result.then((sprite) => {
    cache.set(key, sprite);
    pending.delete(key);
    return sprite;
  });
}

// The picture for a creature, or null when it cannot be made. Repeated calls
// for the same creature share one drawing.
export function requestFigure(kind: FigureKind, name: string): Promise<FigureSprite | null> {
  const key = figureKey(kind, name);
  if (cache.has(key)) return Promise.resolve(cache.get(key) ?? null);
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  const promise = drawOne(key, figureInput(kind, name));
  pending.set(key, promise);
  return promise;
}

// What is already drawn, without asking for anything.
export function peekFigure(kind: FigureKind, name: string): FigureSprite | null | undefined {
  return cache.get(figureKey(kind, name));
}
