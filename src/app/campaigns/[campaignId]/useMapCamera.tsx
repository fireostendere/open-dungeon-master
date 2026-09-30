"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from "react";
import { Maximize2, Minus, Plus, LocateFixed } from "lucide-react";
import {
  centred,
  clampCam,
  comfortZoom,
  inView,
  panBy,
  pinch,
  viewBoxOf,
  zoomAt,
  type Box,
  type Cam,
  type PinchStart,
  type Point,
} from "@/lib/battlemap/camera";

// Zoom and pan for the battle map, done with the fingers a phone has and the
// mouse and wheel a desktop has.
//
//   one finger / left button, dragged  moves the board
//   two fingers                        pinch to zoom, and drag with them
//   ctrl or cmd + wheel, trackpad pinch  zoom at the cursor (plain wheel too,
//                                      where the map has a screen to itself)
//   the buttons                        in, out, the whole board, my piece
//
// A tap that does not move is still a tap: it reaches the tile under the
// finger untouched, and a drag never turns into one, however short.
//
// The map stays crisp because the SVG's viewBox is what changes (see
// src/lib/battlemap/camera.ts), and nothing here knows a rule: it moves a
// window over a picture the server drew the fog on.

// Pixels a pointer may wander before a press becomes a drag; touch wobbles more.
const DRAG_SLOP = { mouse: 4, touch: 9 } as const;
const STEP = 1.4;

type Stored = Cam & { mapId: string };

type Gesture =
  | { kind: "pan"; from: Point; cam: Cam; moved: boolean; slop: number }
  | { kind: "pinch"; start: PinchStart };

export type MapCamera = {
  wrapRef: React.RefObject<HTMLDivElement | null>;
  box: Box;
  // The viewBox to give the SVG.
  viewBox: string;
  zoom: number;
  handlers: {
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onClickCapture: (event: ReactMouseEvent<HTMLDivElement>) => void;
  };
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  locate: () => void;
};

export function useMapCamera(input: {
  mapId: string;
  W: number;
  H: number;
  tile: number;
  // A phone-sized or touch-first screen: start zoomed in on the piece.
  compact: boolean;
  // The piece to start on and to find again: the player's own, or whoever's
  // turn it is. Map units.
  focus: Point | null;
  // Changes when a new turn starts; on a compact screen the board follows
  // the piece if it has left the window.
  turnKey: string;
  // The wheel zooms without a modifier key.
  wheelZoom: boolean;
}): MapCamera {
  const { mapId, W, H, tile, compact, focus, turnKey, wheelZoom } = input;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box>({ w: 0, h: 0 });
  const [stored, setStored] = useState<Stored | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      // The layout box, not the painted one: a tilted board is smaller on
      // screen and no smaller in layout.
      setBox((prev) => (prev.w === el.clientWidth && prev.h === el.clientHeight ? prev : { w: el.clientWidth || rect.width, h: el.clientHeight || rect.height }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const ready = box.w > 0 && box.h > 0;

  // A new board starts where a person wants to look: the whole thing on a
  // desk, close on their own piece on a phone. Adjusted while rendering, so
  // the first frame of the new board is already there.
  if (ready && stored?.mapId !== mapId) {
    const zoom = compact ? comfortZoom(box, W, H, tile) : 1;
    const start = compact && focus ? { zoom, cx: focus.x, cy: focus.y } : centred(W, H);
    setStored({ mapId, ...clampCam(start, box, W, H, tile) });
  }
  const cam: Cam | null = ready && stored?.mapId === mapId ? clampCam(stored, box, W, H, tile) : null;

  const commit = useCallback(
    (next: Cam) => {
      setStored({ mapId, ...next });
    },
    [mapId],
  );

  // What the handlers below read, kept current without re-subscribing them.
  const live = useRef({ cam, box, W, H, tile, focus, wheelZoom });
  useEffect(() => {
    live.current = { cam, box, W, H, tile, focus, wheelZoom };
  });

  // On a phone the board follows the piece when a new turn starts and it is
  // out of the window; in view, it stays put.
  useEffect(() => {
    const { cam: now, box: b, focus: f } = live.current;
    if (!compact || !f || !now || b.w === 0) return;
    if (!inView(now, f, b, W, H)) {
      setStored({ mapId, ...clampCam({ ...now, cx: f.x, cy: f.y }, b, W, H, tile) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per turn, not per move
  }, [turnKey]);

  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  // Set when a press turned into a drag or a pinch, so the click that ends
  // it is swallowed instead of moving a piece.
  const blockClick = useRef(false);

  const local = (clientX: number, clientY: number): Point => {
    const rect = wrapRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  };

  const startPinch = () => {
    const { cam: now } = live.current;
    const [a, b] = [...pointers.current.values()];
    if (!now || !a || !b) return;
    gesture.current = {
      kind: "pinch",
      start: { cam: now, mid: local((a.x + b.x) / 2, (a.y + b.y) / 2), dist: Math.hypot(a.x - b.x, a.y - b.y) },
    };
    blockClick.current = true;
  };

  const handlers: MapCamera["handlers"] = {
    onPointerDown(event) {
      // A control button handles its own press.
      if ((event.target as HTMLElement).closest?.("[data-map-control]")) return;
      if (pointers.current.size === 0) blockClick.current = false;
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.current.size === 2) {
        startPinch();
      } else if (pointers.current.size === 1 && live.current.cam) {
        gesture.current = {
          kind: "pan",
          from: { x: event.clientX, y: event.clientY },
          cam: live.current.cam,
          moved: false,
          slop: event.pointerType === "mouse" ? DRAG_SLOP.mouse : DRAG_SLOP.touch,
        };
      }
    },
    onPointerMove(event) {
      if (!pointers.current.has(event.pointerId)) return;
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const g = gesture.current;
      const { box: b, W: w, H: h, tile: t } = live.current;
      if (g?.kind === "pinch" && pointers.current.size >= 2) {
        const [a, c] = [...pointers.current.values()];
        commit(pinch(g.start, local((a.x + c.x) / 2, (a.y + c.y) / 2), Math.hypot(a.x - c.x, a.y - c.y), b, w, h, t));
      } else if (g?.kind === "pan") {
        const dx = event.clientX - g.from.x;
        const dy = event.clientY - g.from.y;
        if (!g.moved && Math.hypot(dx, dy) > g.slop) {
          g.moved = true;
          blockClick.current = true;
        }
        if (g.moved) commit(panBy(g.cam, dx, dy, b, w, h, t));
      }
    },
    onPointerUp(event) {
      pointers.current.delete(event.pointerId);
      // One finger left after a pinch carries on as a drag from where it is.
      if (pointers.current.size === 1 && live.current.cam) {
        const [rest] = [...pointers.current.values()];
        gesture.current = { kind: "pan", from: rest, cam: live.current.cam, moved: true, slop: DRAG_SLOP.touch };
      } else if (pointers.current.size === 0) {
        gesture.current = null;
      }
    },
    onPointerCancel(event) {
      pointers.current.delete(event.pointerId);
      if (pointers.current.size === 0) gesture.current = null;
      blockClick.current = true;
    },
    onClickCapture(event) {
      // A button is never the tail of a drag.
      if ((event.target as HTMLElement).closest?.("[data-map-control]")) return;
      if (blockClick.current) {
        event.stopPropagation();
        event.preventDefault();
        blockClick.current = false;
      }
    },
  };

  // The wheel is a listener of its own: React's is passive, and a passive
  // one cannot stop the page scrolling under the zoom.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      const { cam: now, box: b, W: w, H: h, tile: t, wheelZoom: plain } = live.current;
      if (!now || !(event.ctrlKey || event.metaKey || plain)) return;
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      // A trackpad pinch arrives as small ctrl-wheel steps; a mouse wheel as big ones.
      const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0018));
      commit(zoomAt(now, factor, { x: event.clientX - rect.left, y: event.clientY - rect.top }, b, w, h, t));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [commit]);

  const zoomBy = (factor: number) => {
    const { cam: now, box: b, W: w, H: h, tile: t } = live.current;
    if (now) commit(zoomAt(now, factor, { x: b.w / 2, y: b.h / 2 }, b, w, h, t));
  };

  return {
    wrapRef,
    box,
    viewBox: cam ? (() => { const v = viewBoxOf(cam, box, W, H); return `${v.x} ${v.y} ${v.w} ${v.h}`; })() : `0 0 ${W} ${H}`,
    zoom: cam?.zoom ?? 1,
    handlers,
    zoomIn: () => zoomBy(STEP),
    zoomOut: () => zoomBy(1 / STEP),
    fit: () => commit(centred(W, H)),
    locate: () => {
      const { cam: now, box: b, focus: f } = live.current;
      if (!now || !f) return;
      const zoom = Math.max(now.zoom, comfortZoom(b, W, H, tile, 40));
      commit(clampCam({ zoom, cx: f.x, cy: f.y }, b, W, H, tile));
    },
  };
}

// The four buttons over a corner of the map. Each takes its own press, so
// touching one never starts a drag underneath it.
export function MapControls({
  camera,
  canLocate,
  top,
  labels,
}: {
  camera: MapCamera;
  canLocate: boolean;
  // Pixels from the top of the window, to clear the empty band a tilted board leaves.
  top: string;
  labels: { zoomIn: string; zoomOut: string; fit: string; locate: string };
}) {
  const button = "flex size-9 items-center justify-center rounded-md border border-stone-600/70 bg-stone-950/85 text-stone-200 shadow-md backdrop-blur-sm hover:text-amber-200 active:bg-stone-800 max-md:size-11";
  const items = [
    { label: labels.zoomIn, icon: Plus, onClick: camera.zoomIn },
    { label: labels.zoomOut, icon: Minus, onClick: camera.zoomOut },
    { label: labels.fit, icon: Maximize2, onClick: camera.fit },
    ...(canLocate ? [{ label: labels.locate, icon: LocateFixed, onClick: camera.locate }] : []),
  ];
  return (
    <div className="absolute right-2 flex flex-col gap-1.5" style={{ top }}>
      {items.map(({ label, icon: Icon, onClick }) => (
        <button
          key={label}
          type="button"
          data-map-control
          aria-label={label}
          title={label}
          className={button}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onClick}
        >
          <Icon className="size-4 max-md:size-5" />
        </button>
      ))}
    </div>
  );
}
