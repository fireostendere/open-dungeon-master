"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { constrainAtlasView } from "@/lib/overworld/atlas";

// Pan, wheel zoom and two-finger pinch for the region canvas, lifted out of
// OverworldPanel so the panel has room for what a tap means. The hook owns
// the view transform and nothing else: the panel decides whether a pointer
// is looking or doing, and hands the looking here.

export type MapView = { x: number; y: number; zoom: number };

export function useOverworldView(canvasRef: RefObject<HTMLElement | null>, ready: boolean, surface?: HTMLElement | null) {
  const [view, setView] = useState<MapView>({ x: 0, y: 0, zoom: 1 });
  const mapSize = useRef<{ width: number; height: number } | null>(null);
  const limit = useCallback((next: MapView) => {
    const canvas = canvasRef.current;
    return canvas && mapSize.current ? constrainAtlasView(next, { width: canvas.clientWidth, height: canvas.clientHeight }, mapSize.current) : next;
  }, [canvasRef]);
  const zoomAt = useCallback((current: MapView, ratio: number, x: number, y: number, dx = 0, dy = 0) => {
    const zoom = limit({ ...current, zoom: current.zoom * ratio }).zoom;
    const scale = zoom / current.zoom;
    return limit({ zoom, x: x - (x - current.x) * scale + dx, y: y - (y - current.y) * scale + dy });
  }, [limit]);
  const dragRef = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  // Active pointers by id, for two-finger pinch zoom on touch screens.
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ dist: number; mid: { x: number; y: number } } | null>(null);

  // Wheel zoom needs a native non-passive listener: React's onWheel is
  // passive, so it cannot preventDefault and the whole side panel scrolls
  // under the cursor. Attached once the canvas exists.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !ready) {
      return;
    }
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const pointX = event.clientX - rect.left;
      const pointY = event.clientY - rect.top;
      setView(current => zoomAt(current, event.deltaY < 0 ? 1.15 : 0.87, pointX, pointY));
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [canvasRef, ready, surface, zoomAt]);

  // Fits the whole map into the canvas: on the first draw, and again when
  // the map changed size under the view (a reroll at another size, an
  // import), because a view fitted to the old grid shows a corner of the
  // new one.
  const fit = useCallback(
    (canvas: HTMLElement, mapWidth: number, mapHeight: number, force = false) => {
      // Dialogs briefly mount at zero size. Never turn that transition into
      // a zero zoom and infinite coordinates on the next zoom gesture.
      if (!canvas.clientWidth || !canvas.clientHeight || mapWidth <= 0 || mapHeight <= 0) return;
      mapSize.current = { width: mapWidth, height: mapHeight };
      setView((current) => {
        if (!force && (current.x || current.y)) {
          return current;
        }
        const zoom = Math.min(canvas.clientWidth / mapWidth, canvas.clientHeight / mapHeight);
        return {
          zoom,
          x: (canvas.clientWidth - mapWidth * zoom) / 2,
          y: (canvas.clientHeight - mapHeight * zoom) / 2,
        };
      });
    },
    [],
  );

  function down(event: PointerEvent<HTMLElement>) {
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
    if (pointersRef.current.size === 2) {
      // Second finger down: the drag becomes a pinch.
      dragRef.current = null;
      const [a, b] = [...pointersRef.current.values()];
      pinchRef.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      };
    } else if (pointersRef.current.size === 1) {
      dragRef.current = { x: view.x, y: view.y, startX: event.clientX, startY: event.clientY };
    }
  }

  function move(event: PointerEvent<HTMLElement>) {
    if (!pointersRef.current.has(event.pointerId)) {
      return;
    }
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pinch = pinchRef.current;
    if (pinch && pointersRef.current.size >= 2) {
      const [a, b] = [...pointersRef.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const canvas = canvasRef.current;
      if (!canvas || dist < 1) {
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const midX = mid.x - rect.left;
      const midY = mid.y - rect.top;
      const ratio = dist / pinch.dist;
      setView(current => zoomAt(current, ratio, midX, midY, mid.x - pinch.mid.x, mid.y - pinch.mid.y));
      pinchRef.current = { dist, mid };
      return;
    }
    const drag = dragRef.current;
    if (drag) {
      setView((current) => limit({
        ...current,
        x: drag.x + event.clientX - drag.startX,
        y: drag.y + event.clientY - drag.startY,
      }));
    }
  }

  function up(event: PointerEvent<HTMLElement>) {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) {
      pinchRef.current = null;
    }
    dragRef.current = null;
  }

  const zoomBy = useCallback((ratio: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const x = canvas.clientWidth / 2, y = canvas.clientHeight / 2;
    setView(current => zoomAt(current, ratio, x, y));
  }, [canvasRef, zoomAt]);

  const focus = useCallback((x: number, y: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setView(current => limit({ ...current, x: canvas.clientWidth / 2 - x * current.zoom, y: canvas.clientHeight / 2 - y * current.zoom }));
  }, [canvasRef, limit]);

  const pan = useCallback((x: number, y: number) => {
    setView(current => limit({ ...current, x: current.x + x, y: current.y + y }));
  }, [limit]);

  return { view, fit, down, move, up, zoomBy, focus, pan };
}
