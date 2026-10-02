"use client";

/* Uploaded local portraits are already small; preserve them in the PNG-compatible viewer. */
/* eslint-disable @next/next/no-img-element */

import * as Dialog from "@radix-ui/react-dialog";
import { Anchor, Castle, Church, Compass, Diamond, Flag, Focus, House, Landmark, Loader2, LocateFixed, MapPin, Maximize2, Minus, Mountain, Pencil, Plus, Search, ScrollText, Tent, Trees, Users, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { skinForGenre, type XY } from "@/lib/overworld/logic";
import type { OverworldBrush } from "@/lib/overworld/paint";
import {
  featureAt,
  type LabelSize,
  type OverworldSize,
  type PathKind,
} from "@/lib/overworld/features";
import { PromptDialog } from "@/components/ui/PromptDialog";
import { OverworldAuthoring } from "@/app/campaigns/[campaignId]/OverworldAuthoring";
import {
  askCopy,
  FileTools,
  importAzgaarFiles,
  LabelTools,
  LineTools,
  ModeBar,
  PaintTools,
  TileLegend,
  type OverworldAsk,
  type OverworldMode,
} from "@/app/campaigns/[campaignId]/OverworldTools";
import {
  drawOverworld,
  saveOverworldPng,
  OVERWORLD_TILE as TILE,
  type AtlasMaterials,
  type OverworldData,
} from "@/app/campaigns/[campaignId]/overworldDraw";
import { useOverworldView } from "@/app/campaigns/[campaignId]/useOverworldView";
import { useI18n } from "@/lib/i18n/context";
import { localeText } from "@/lib/i18n/locale-text";
import { atlasQuests, atlasRoute, isQuestPin, layoutAtlasMarkers, locationKind } from "@/lib/overworld/atlas";
import { atlasTerrain, BIOME_MATERIALS, landmarkForLocation, landmarkSprite, materialAt, TERRAIN_ASSETS } from "@/lib/overworld/cartography";
import styles from "./worldAtlas.module.css";

const PLACE_ICONS = { settlement: House, dungeon: Mountain, fort: Castle, ruin: Landmark, shrine: Church, mountain: Mountain, forest: Trees, camp: Tent, port: Anchor, neutral: MapPin };

// The overworld region map: seeded terrain canvas (or a picture in its
// place), known locations as anchors with routes from the connections
// graph, roads, rivers and borders, labels, a pulsing party marker, and
// lead-placed pins. Pan with drag, zoom with the wheel or a pinch.
//
// Whoever steers the story also authors it: pins, the party marker, dragging
// a place to where it belongs, renaming it, painting the ground, drawing
// lines and words over it, and the dials the terrain is rolled under
// (OverworldAuthoring). Everything else is read-only.

type Stranded = Array<{ id: string; name: string }>;

export function OverworldPanel({
  campaignId,
  genre,
  steersStory,
  title,
  viewerUserId,
}: {
  campaignId: string;
  genre: string;
  steersStory: boolean;
  title?: string;
  viewerUserId?: string;
}) {
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: { loading: "Charting the region…", holding: (name: string) => `Holding ${name}. Tap where it belongs.`, rename: "Rename it", erase: "Tap a line, a label or a pin to take it off the map.", help: "Drag to explore · Scroll to zoom · Arrow keys to pan", error: "Could not update the map.", atlas: "World atlas", live: "Live", reconnecting: "Reconnecting…", tools: "Map studio", expand: "Expand map", close: "Close map", search: "Find a place…", places: "Places", objectives: "Quests", party: "Party", follow: "Follow the party", fit: "Show the whole region", zoomIn: "Zoom in", zoomOut: "Zoom out", north: "N", here: "You are here", known: "Known place", visited: "Discovered", target: "Track objective", untrack: "Stop tracking", unknownTarget: "Destination not specified", bind: "Quest destination", noQuests: "No open quests. Objectives appear here when recorded in the journal.", noPlaces: "The world awaits", emptyHint: "Places and routes appear as the adventure unfolds.", route: "Known route", noRoute: "Route not yet charted", connections: "Passages", mapNotes: "Places, characters and objectives follow the game.", explore: "Explore", studioHint: "Edit terrain, place locations, or upload your own artwork.", back: "Back to the party", partyUnknown: "Position not recorded", location: "Location", locate: "Show on the map" },
    ru: { loading: "Проявляем карту…", holding: (name: string) => `Вы держите: ${name}. Нажмите там, где ему место.`, rename: "Переименовать", erase: "Нажмите на линию, подпись или метку, чтобы убрать её с карты.", help: "Тяните, чтобы исследовать · Колесо — масштаб · Стрелки — перемещение", error: "Не удалось обновить карту.", atlas: "Атлас мира", live: "В игре", reconnecting: "Восстанавливаем связь…", tools: "Мастерская карты", expand: "Развернуть карту", close: "Закрыть карту", search: "Найти место…", places: "Места", objectives: "Квесты", party: "Отряд", follow: "Следить за отрядом", fit: "Показать весь регион", zoomIn: "Приблизить", zoomOut: "Отдалить", north: "С", here: "Вы здесь", known: "Известное место", visited: "Открыто", target: "Отслеживать цель", untrack: "Снять отслеживание", unknownTarget: "Место цели пока не указано", bind: "Место цели квеста", noQuests: "Открытых квестов пока нет. Цели появятся здесь из журнала приключения.", noPlaces: "Мир ждёт открытия", emptyHint: "Места и пути появятся по ходу приключения.", route: "Известный путь", noRoute: "Путь ещё не разведан", connections: "Переходы", mapNotes: "Места, герои и цели меняются вместе с игрой.", explore: "Исследовать", studioHint: "Меняйте рельеф, размещайте локации или загружайте свой рисунок.", back: "К отряду", partyUnknown: "Положение не записано", location: "Локация", locate: "Показать на карте" },
  });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [surface, setSurface] = useState<HTMLDivElement | null>(null);
  const attachSurface = useCallback((element: HTMLDivElement | null) => {
    containerRef.current = element;
    setSurface(element);
  }, []);
  const [data, setData] = useState<OverworldData | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<OverworldMode>("look");
  const [brush, setBrush] = useState<OverworldBrush>("plains");
  const [brushRadius, setBrushRadius] = useState(1);
  // Named after the paint, not after the failure: these are places the DM
  // just put under water or under a peak. The server reports them and moves
  // nothing, because a lighthouse on a reef is a decision.
  const [stranded, setStranded] = useState<Stranded>([]);
  const [held, setHeld] = useState<string | null>(null);
  const [asking, setAsking] = useState<OverworldAsk | null>(null);
  const [regenBusy, setRegenBusy] = useState(false);
  // A line being drawn: its kind, its points so far, and the name it will
  // carry when finished.
  const [pathKind, setPathKind] = useState<PathKind>("road");
  const [pending, setPending] = useState<XY[]>([]);
  const [pathLabel, setPathLabel] = useState("");
  const [labelSize, setLabelSize] = useState<LabelSize>("small");
  // The backdrop image, keyed by the path it was loaded from, so a picture
  // taken away or replaced never draws for a frame under the wrong path.
  const [backdrop, setBackdrop] = useState<{ path: string; image: HTMLImageElement } | null>(null);
  const [materials, setMaterials] = useState<AtlasMaterials | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState("");
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [studio, setStudio] = useState(false);
  const [section, setSection] = useState<"places" | "objectives" | "party">("objectives");
  const [selected, setSelected] = useState<string | null>(null);
  const [tracked, setTracked] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [followParty, setFollowParty] = useState(true);
  const [connected, setConnected] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0, dpr: 1 });
  const { view, fit, down, move, up, zoomBy, focus, pan } = useOverworldView(containerRef, !loading, surface);

  useEffect(() => {
    const controller = new AbortController();
    async function watch() {
      let etag = "";
      while (!controller.signal.aborted) {
        try {
          const response = await fetch(`/api/campaigns/${campaignId}/overworld?waitMs=20000`, {
            signal: controller.signal, cache: "no-store",
            headers: { ...(etag ? { "If-None-Match": etag } : {}), ...(viewerUserId ? { "X-ODM-Expected-User": viewerUserId } : {}) },
          });
          if (response.status === 304) { setConnected(true); continue; }
          if (!response.ok) {
            if ([401, 403, 404, 409].includes(response.status)) {
              setData(null); setLoading(false); setConnected(false); setError(copy.error); return;
            }
            throw new Error("Map unavailable");
          }
          const payload = await response.json() as OverworldData;
          if (controller.signal.aborted) return;
          etag = response.headers.get("etag") ?? "";
          setData(payload); setLoading(false); setConnected(true); setError("");
          // A proxy without ETags must not turn this into a busy loop.
          if (!etag) await new Promise(resolve => setTimeout(resolve, 2000));
        } catch {
          if (controller.signal.aborted) return;
          setConnected(false); setLoading(false); setError(copy.error);
          await new Promise(resolve => setTimeout(resolve, 4000));
        }
      }
    }
    void watch();
    return () => controller.abort();
  }, [campaignId, copy.error, viewerUserId]);

  const backdropPath = data?.map.backdropPath ?? "";
  useEffect(() => {
    if (!backdropPath) {
      return;
    }
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (!cancelled) {
        setBackdrop({ path: backdropPath, image });
      }
    };
    image.src = backdropPath;
    return () => {
      cancelled = true;
    };
  }, [backdropPath]);
  const backdropImage = backdrop && backdrop.path === backdropPath ? backdrop.image : null;
  const materialGrid = data?.map.materialGrid ?? (data ? atlasTerrain(data.map, data.locations).materialGrid : "");
  const materialKey = [...new Set([...Object.values(BIOME_MATERIALS), ...[...materialGrid].map((_, index) => materialAt(materialGrid, index))])].sort().join(",");
  useEffect(() => {
    let cancelled = false;
    const loaded: AtlasMaterials = {};
    void Promise.all(materialKey.split(",").map(name => new Promise<void>(resolve => {
      const kind = name as keyof AtlasMaterials;
      const image = new Image();
      image.onload = () => { loaded[kind] = image; resolve(); };
      image.onerror = () => resolve();
      image.src = TERRAIN_ASSETS[kind];
    }))).then(() => { if (!cancelled) setMaterials(loaded); });
    return () => { cancelled = true; };
  }, [materialKey]);

  // Terrain redraws only with map or camera changes. CSS animates markers.
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!data) { context.restore(); return; }
    context.scale(canvasSize.dpr, canvasSize.dpr);
    context.translate(view.x, view.y);
    context.scale(view.zoom, view.zoom);
    drawOverworld(context, data, {
      genre,
      pulse: 0,
      selectedLocationId: held,
      backdrop: backdropImage,
      pending: pending.length ? { kind: pathKind, points: pending } : null,
      markers: false,
      materials: ["high_fantasy", "dark_fantasy", "horror"].includes(genre) ? materials : null,
    });
    context.restore();
  }, [backdropImage, canvasSize.dpr, data, genre, held, materials, pathKind, pending, view]);

  useEffect(() => {
    draw();
  }, [draw, canvasSize]);

  // Size the canvas to its container; fit the map on first data and again
  // whenever the map changed size underneath the view.
  const mapWidth = data?.map.width, mapHeight = data?.map.height;
  useEffect(() => {
    const container = surface;
    const canvas = canvasRef.current;
    if (!container || !canvas || !mapWidth || !mapHeight) {
      return;
    }
    const resize = () => {
      const width = container.clientWidth, height = container.clientHeight;
      if (!width || !height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      setCanvasSize({ width, height, dpr });
      fit(container, mapWidth * TILE, mapHeight * TILE, true);
      if (!expanded) zoomBy(2.4);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [mapWidth, mapHeight, expanded, surface, fit, zoomBy]);

  const current = data?.locations.find(location => location.isCurrent);
  const partyPlaces = [...new Set(data?.party?.map(character => character.locationId).filter((id): id is string => Boolean(id)))];
  const originId = current?.id ?? (partyPlaces.length === 1 ? partyPlaces[0] : null);
  const partyAnchor = data?.locations.find(location => location.id === originId)?.anchor ?? (partyPlaces.length <= 1 ? data?.map.partyXy : null) ?? null;
  const partyX = partyAnchor?.x, partyY = partyAnchor?.y;
  useEffect(() => {
    if (followParty && partyX !== undefined && partyY !== undefined && canvasSize.width) focus((partyX + 0.5) * TILE, (partyY + 0.5) * TILE);
  }, [followParty, partyX, partyY, canvasSize.width, canvasSize.height, view.zoom, focus]);

  // Returns the payload as well as storing it, because a paint answers with
  // more than the new map: it names the places it left in the sea.
  async function patch(body: Record<string, unknown>) {
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/overworld`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError((payload as { error?: string }).error ?? copy.error);
        return null;
      }
      setData(payload);
      return payload as OverworldData & { stranded?: Stranded };
    } catch {
      setError(copy.error);
      return null;
    }
  }

  // Canvas pixels to map tiles, or null outside the grid.
  function tileAt(clientX: number, clientY: number): XY | null {
    const canvas = canvasRef.current;
    if (!canvas || !data) {
      return null;
    }
    const rect = containerRef.current?.getBoundingClientRect() ?? canvas.getBoundingClientRect();
    const x = Math.floor((clientX - rect.left - view.x) / view.zoom / TILE);
    const y = Math.floor((clientY - rect.top - view.y) / view.zoom / TILE);
    return x >= 0 && y >= 0 && x < data.map.width && y < data.map.height ? { x, y } : null;
  }

  // The place whose marker sits under this tile, if any.
  function locationAt(at: XY) {
    return (
      data?.locations.find(
        (location) =>
          location.anchor &&
          Math.abs(location.anchor.x - at.x) <= 1 &&
          Math.abs(location.anchor.y - at.y) <= 1,
      ) ?? null
    );
  }

  async function erase(at: XY) {
    if (!data) {
      return;
    }
    const hit = featureAt(data.map.paths, data.map.labels, at);
    if (hit && "label" in hit) {
      await patch({ labels: data.map.labels.filter((label) => label.id !== hit.label.id) });
      return;
    }
    if (hit && "path" in hit) {
      await patch({ paths: data.map.paths.filter((path) => path.id !== hit.path.id) });
      return;
    }
    const pin = data.map.pins.find(
      (entry) => !isQuestPin(entry) && Math.abs(entry.x - at.x) <= 1 && Math.abs(entry.y - at.y) <= 1,
    );
    if (pin) {
      await patch({ pins: data.map.pins.filter((entry) => entry.id !== pin.id) });
    }
  }

  async function handleClick(clientX: number, clientY: number) {
    const at = tileAt(clientX, clientY);
    if (!at || !data) {
      return;
    }
    switch (mode) {
      case "pin":
      case "label":
        // The words are asked for in the app's own dialog; the answer lands
        // in the PromptDialog below.
        setAsking({ kind: mode, at });
        return;
      case "party":
        await patch({ partyXy: at });
        setMode("look");
        return;
      case "paint": {
        // One tile per tap. A tap already reaches every tile; the radius is
        // what makes it practical on a big grid.
        const payload = await patch({
          strokes: [{ x: at.x, y: at.y, brush, radius: brushRadius }],
        });
        setStranded(payload?.stranded ?? []);
        return;
      }
      case "place":
        // First tap picks a marker up, second puts it down.
        if (held) {
          await patch({ anchor: { locationId: held, x: at.x, y: at.y } });
          setHeld(null);
          return;
        }
        setHeld(locationAt(at)?.id ?? null);
        return;
      case "line":
        setPending((current) => [...current, at]);
        return;
      case "erase":
        await erase(at);
        return;
      default:
        return;
    }
  }

  async function finishPath() {
    if (!data || pending.length < 2) {
      return;
    }
    const saved = await patch({
      paths: [...data.map.paths, { kind: pathKind, points: pending, label: pathLabel.trim() }],
    });
    if (saved) {
      setPending([]);
      setPathLabel("");
    }
  }

  function changeMode(next: OverworldMode) {
    setMode(next);
    setHeld(null);
    setStranded([]);
    setPending([]);
  }

  async function answer(value: string) {
    const ask = asking;
    setAsking(null);
    if (!ask || !data) {
      return;
    }
    if (ask.kind === "pin") {
      await patch({
        pins: [...data.map.pins, { id: "", x: ask.at.x, y: ask.at.y, label: value.slice(0, 60) }],
      });
      setMode("look");
      return;
    }
    if (ask.kind === "label") {
      if (value.trim()) {
        await patch({
          labels: [...data.map.labels, { x: ask.at.x, y: ask.at.y, text: value.trim(), size: labelSize }],
        });
      }
      return;
    }
    if (value.trim()) {
      await patch({ rename: { locationId: ask.locationId, name: value.trim() } });
      setHeld(null);
    }
  }

  async function regenerate() {
    setRegenBusy(true);
    try {
      await patch({ regenerate: true });
    } finally {
      setRegenBusy(false);
    }
  }

  async function exportPng() {
    if (!data) {
      return;
    }
    setExporting(true);
    try {
      const failure = await saveOverworldPng(data, { genre, backdrop: backdropImage, materials: ["high_fantasy", "dark_fantasy", "horror"].includes(genre) ? materials : null });
      if (failure) {
        setError(failure);
      }
    } finally {
      setExporting(false);
    }
  }

  async function importAzgaar(files: string[], size: OverworldSize) {
    setImporting(true);
    setImportNote("");
    setError("");
    try {
      const result = await importAzgaarFiles<OverworldData>(campaignId, files, size);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setData(result.data);
      setImportNote(result.note);
    } finally {
      setImporting(false);
    }
  }

  const skin = data ? skinForGenre(genre) : null;
  const heldName = data?.locations.find((entry) => entry.id === held)?.name ?? "";
  const ask = askCopy(asking, labelSize, heldName, locale);
  const quests = data ? atlasQuests(data.quests ?? [], data.locations, data.map.pins) : [];
  const activeQuest = quests.find(quest => quest.id === tracked);
  const chosen = data?.locations.find(location => location.id === selected) ?? current;
  const route = data ? atlasRoute(data.locations, originId ?? null, activeQuest?.locationId ?? null) : [];
  const places = data?.locations.filter(location => location.name.toLowerCase().includes(search.toLowerCase())) ?? [];
  const point = (at: XY) => ({ x: view.x + (at.x + 0.5) * TILE * view.zoom, y: view.y + (at.y + 0.5) * TILE * view.zoom });
  const routePoints = route.map(id => data?.locations.find(location => location.id === id)?.anchor).filter((at): at is XY => Boolean(at)).map(point);
  const detailed = view.zoom >= 0.8;
  const labelBounds = (data?.map.labels ?? []).map(label => {
    const at = point(label), size = label.size === "large" ? 20 : 11;
    const width = label.text.length * size * 0.7 * view.zoom, height = size * 1.5 * view.zoom;
    return { x: at.x - width / 2, y: at.y - height, width, height };
  });
  for (const path of data?.map.paths ?? []) if (path.label && path.points.length) {
    const at = point(path.points[Math.floor(path.points.length / 2)]);
    labelBounds.push({ x: at.x, y: at.y - 18 * view.zoom, width: path.label.length * 7 * view.zoom, height: 18 * view.zoom });
  }
  for (const pin of data?.map.pins.filter(pin => !isQuestPin(pin)) ?? []) {
    const at = point(pin), width = Math.min(120, pin.label.length * 6) + 24;
    labelBounds.push({ x: at.x - width / 2, y: at.y - 13, width, height: 26 });
  }
  if (data?.map.partyXy) {
    const at = point(data.map.partyXy);
    labelBounds.push({ x: at.x - 70, y: at.y - 13, width: 140, height: 26 });
  }
  const groups = layoutAtlasMarkers((data?.locations ?? []).filter(location => location.anchor).map(location => {
    const partyCount = (data?.party ?? []).filter(character => character.locationId === location.id).length;
    return { ...point(location.anchor!), id: location.id, name: location.name, partyCount,
      priority: location.isCurrent ? 1000 : partyCount ? 800 : activeQuest?.locationId === location.id ? 600 : chosen?.id === location.id ? 550 : location.visited ? 200 : 100 };
  }), canvasSize.width, canvasSize.height, detailed, labelBounds);
  const partyLocation = current ?? data?.locations.find(location => location.id === originId);

  function showParty() {
    setFollowParty(true);
    if (view.zoom < 0.9) zoomBy(0.9 / view.zoom);
    if (partyAnchor) focus((partyAnchor.x + 0.5) * TILE, (partyAnchor.y + 0.5) * TILE);
  }

  function showLocation(id: string) {
    const location = data?.locations.find(entry => entry.id === id);
    setSelected(id);
    if (location?.anchor) {
      setFollowParty(false);
      if (view.zoom < 0.9) zoomBy(0.9 / view.zoom);
      focus((location.anchor.x + 0.5) * TILE, (location.anchor.y + 0.5) * TILE);
    }
  }

  async function bindQuest(id: string, locationId: string) {
    if (!data) return;
    const quest = quests.find(entry => entry.id === id);
    const location = data.locations.find(entry => entry.id === locationId);
    const liveIds = new Set(quests.map(entry => entry.id));
    const pins = data.map.pins.filter(pin => !isQuestPin(pin) || (liveIds.has(pin.id.split("@")[0]) && !pin.id.startsWith(`${id}@`)));
    pins.push({ id: `${id}@${locationId || "unplaced"}`, x: location?.anchor?.x ?? 0, y: location?.anchor?.y ?? 0, label: quest?.text.slice(0, 60) ?? "" });
    await patch({ pins });
  }

  const content = (
    <section className={cn(styles.atlas, expanded && styles.expanded)} aria-label={copy.atlas}>
      <header className={styles.header}>
        <div className={styles.title}><Compass size={22} aria-hidden="true" /><div><span>{copy.atlas}</span><h3>{title || copy.explore}</h3></div></div>
        <div className={styles.actions}>
          {steersStory ? <button type="button" onClick={() => { setStudio(value => !value); changeMode("look"); }} aria-label={copy.tools} title={copy.tools} aria-pressed={studio}><Pencil size={16} /></button> : null}
          <button type="button" onClick={() => setExpanded(value => !value)} aria-label={expanded ? copy.close : copy.expand} title={expanded ? copy.close : copy.expand}>{expanded ? <X size={18} /> : <Maximize2 size={17} />}</button>
        </div>
      </header>
      <div className={styles.layout}>
        <div className={styles.mapColumn}>
          <div ref={attachSurface} className={cn(styles.viewport, mode !== "look" && styles.editing)} data-tour="region-canvas"
            tabIndex={0} role="group" aria-label={`${copy.atlas}. ${copy.help}`}
            onKeyDown={event => {
              if (event.target !== event.currentTarget) return;
              const delta = { ArrowLeft: [50, 0], ArrowRight: [-50, 0], ArrowUp: [0, 50], ArrowDown: [0, -50] }[event.key];
              if (delta) { event.preventDefault(); setFollowParty(false); pan(delta[0], delta[1]); }
              if (event.key === "+" || event.key === "=") { event.preventDefault(); zoomBy(1.3); }
              if (event.key === "-") { event.preventDefault(); zoomBy(1 / 1.3); }
            }}
            onPointerDown={event => {
              if (mode !== "look") { void handleClick(event.clientX, event.clientY); return; }
              setFollowParty(false); down(event);
            }} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
            <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
            <div className={styles.paper} aria-hidden="true" />
            <div className={styles.mist} aria-hidden="true" />
            <div className={styles.vignette} aria-hidden="true" />
            {routePoints.length > 1 ? <svg className={styles.route} aria-hidden="true"><polyline points={routePoints.map(at => `${at.x},${at.y}`).join(" ")} /></svg> : null}
            <svg className={styles.callouts} aria-hidden="true">{groups.filter(group => group.label).map(group => {
              const { marker, label } = group;
              return <line key={marker.id} x1={marker.x} y1={marker.y} x2={marker.x + label!.x} y2={marker.y + label!.y} />;
            })}</svg>
            <div className={styles.markers}>
              {groups.map(group => {
                const location = data!.locations.find(entry => entry.id === group.marker.id)!;
                const at = group.marker, Icon = PLACE_ICONS[locationKind(location)];
                const asset = detailed && group.members.length === 1 ? landmarkForLocation(location) : null;
                const groupQuests = quests.filter(quest => group.members.some(member => member.id === quest.locationId));
                const groupParty = group.members.reduce((sum, member) => sum + member.partyCount, 0);
                const names = group.members.map(member => member.name).join(" · ");
                return <button key={location.id} type="button" className={cn(styles.placeMarker, location.visited && styles.discovered, chosen?.id === location.id && styles.selected, location.isCurrent && styles.current)}
                  style={{ left: at.x, top: at.y, pointerEvents: mode === "look" || mode === "place" ? "auto" : "none" }}
                  aria-label={`${names} · ${location.isCurrent ? copy.here : location.visited ? copy.visited : copy.known}${groupParty ? ` · ${copy.party}: ${groupParty}` : ""}`}
                  title={names} onPointerDown={event => event.stopPropagation()}
                  onClick={() => {
                    if (mode === "place") { setHeld(location.id); return; }
                    setSelected(location.id);
                    if (group.members.length > 1) { setFollowParty(false); zoomBy(Math.max(1.7, 0.9 / view.zoom)); focus((location.anchor!.x + 0.5) * TILE, (location.anchor!.y + 0.5) * TILE); setSection("places"); setSearch(""); }
                  }}>
                  <span className={cn(styles.placeBadge, asset && styles.illustrated)}>
                    {asset ? <span className={styles.landmarkArt} style={landmarkSprite(asset)} aria-hidden="true" /> : null}
                    <Icon size={asset ? 12 : 20} strokeWidth={1.5} />
                  </span>
                  {group.members.length > 1 ? <span className={styles.clusterCount}>+{group.members.length - 1}</span> : null}
                  {groupParty && (!detailed || group.members.length > 1) ? <span className={styles.partyCount}><Users size={12} />{groupParty}</span> : null}
                  {groupQuests.length ? <span className={cn(styles.questBadge, groupQuests.some(quest => quest.id === tracked) && styles.tracked)} title={groupQuests.map(quest => quest.text).join(" · ")}><Diamond size={18} /><b>{groupQuests.length > 1 ? groupQuests.length : "!"}</b></span> : null}
                  {group.label ? <span className={styles.placeName} style={{ left: `calc(50% + ${group.label.x}px)`, top: `calc(50% + ${group.label.y}px)`, width: group.label.width, height: group.label.height }}>
                    <span>{location.name}</span>{location.isCurrent ? <small>{copy.here}</small> : groupParty ? <small>{copy.party} · {groupParty}</small> : null}
                  </span> : null}
                </button>;
              })}
              {detailed ? (data?.party ?? []).map(character => {
                const location = data?.locations.find(entry => entry.id === character.locationId);
                const group = groups.find(entry => entry.marker.id === location?.id && entry.members.length === 1);
                if (!group) return null;
                const anchor = location?.anchor ?? (data?.scope !== "spatial" ? data?.map.partyXy : null);
                if (!anchor) return null;
                const at = point(anchor), siblings = data?.party?.filter(entry => entry.locationId === character.locationId).slice(0, 3) ?? [];
                if (!siblings.some(entry => entry.id === character.id)) return null;
                const offset = (siblings.findIndex(entry => entry.id === character.id) - (siblings.length - 1) / 2) * 31;
                return <button type="button" key={character.id} className={styles.characterMarker} style={{ left: at.x + offset, top: at.y + 47, pointerEvents: mode === "look" ? "auto" : "none" }}
                  aria-label={`${character.name} · ${location?.name ?? copy.partyUnknown}`} title={character.name}
                  onPointerDown={event => event.stopPropagation()} onClick={() => { setSection("party"); setSelected(character.locationId); }}>
                  {character.portraitUrl ? <img src={character.portraitUrl} alt="" /> : <span>{character.name.slice(0, 1)}</span>}
                </button>;
              }) : null}
              {detailed ? groups.filter(group => group.members.length === 1 && group.marker.partyCount > 3).map(group => <button key={`party:${group.marker.id}`} type="button" className={styles.partyMore} style={{ left: group.marker.x + 60, top: group.marker.y + 47 }}
                aria-label={`${copy.party} · ${group.marker.partyCount}`} title={`${copy.party} · ${group.marker.partyCount}`} onPointerDown={event => event.stopPropagation()} onClick={() => setSection("party")}>+{group.marker.partyCount - 3}</button>) : null}
              {data?.map.pins.filter(pin => !isQuestPin(pin)).map(pin => {
                const at = point(pin);
                return <span key={pin.id} className={styles.pin} style={{ left: at.x, top: at.y }}><Flag size={18} /><span>{pin.label}</span></span>;
              })}
              {data?.map.partyXy ? <span className={styles.pin} style={{ left: point(data.map.partyXy).x, top: point(data.map.partyXy).y }} title={locale === "ru" ? "Метка отряда" : "Party annotation"}><Users size={20} /><span>{locale === "ru" ? "Метка отряда" : "Party annotation"}</span></span> : null}
            </div>
            <div className={styles.hud}><span>{activeQuest ? copy.target : copy.explore}</span><strong>{activeQuest?.text.split(":")[0] ?? title ?? copy.atlas}</strong>
              <button type="button" className={styles.partyLocator} onPointerDown={event => event.stopPropagation()} onClick={() => { setSection("party"); showParty(); }} title={copy.back}>
                <LocateFixed size={14} /><span>{copy.party} · {partyLocation?.name ?? (partyPlaces.length > 1 ? locale === "ru" ? "В разных местах" : "Split party" : copy.partyUnknown)}</span>
              </button>
            </div>
            <div className={styles.compass} aria-hidden="true"><span>{copy.north}</span><Compass size={56} strokeWidth={0.7} /></div>
            <div className={styles.mapControls} onPointerDown={event => event.stopPropagation()}>
              <button type="button" onClick={() => zoomBy(1.3)} aria-label={copy.zoomIn} title={copy.zoomIn}><Plus size={18} /></button>
              <button type="button" onClick={() => zoomBy(1 / 1.3)} aria-label={copy.zoomOut} title={copy.zoomOut}><Minus size={18} /></button>
              <i />
              <button type="button" onClick={() => { setFollowParty(false); if (containerRef.current && data) fit(containerRef.current, data.map.width * TILE, data.map.height * TILE, true); }} aria-label={copy.fit} title={copy.fit}><Focus size={18} /></button>
              <button type="button" onClick={showParty} aria-pressed={followParty} disabled={!partyAnchor} aria-label={copy.follow} title={copy.follow}><LocateFixed size={18} /></button>
            </div>
            <div className={styles.live} role="status"><i data-connected={connected} />{connected ? copy.live : loading ? copy.loading : copy.reconnecting}</div>
            {loading || !data?.locations.length ? <div className={styles.empty}>
              {loading ? <Loader2 className="animate-spin" size={28} /> : <Compass size={36} strokeWidth={1} />}
              <strong>{loading ? copy.loading : copy.noPlaces}</strong><p>{loading ? "" : copy.emptyHint}</p>
            </div> : null}
          </div>
          <div className={styles.mapFooter}><MapPin size={13} aria-hidden="true" /><span>{copy.mapNotes}</span></div>
          {chosen ? <div className={styles.locationCard}>
            <div><span>{chosen.isCurrent ? copy.here : chosen.visited ? copy.visited : copy.known}</span><h4>{chosen.name}</h4></div>
            <button type="button" aria-label={`${copy.locate}: ${chosen.name}`} title={copy.locate} onClick={() => showLocation(chosen.id)}><LocateFixed size={18} /></button>
            {chosen.layoutDescription ? <p>{chosen.layoutDescription}</p> : null}
            {chosen.connections.length ? <div className={styles.exits}>{chosen.connections.map(name => {
              const target = data?.locations.find(location => location.name.toLowerCase() === name.toLowerCase());
              return target ? <button type="button" key={name} onClick={() => showLocation(target.id)}><MapPin size={11} />{name}</button> : <span key={name}>{name}</span>;
            })}</div> : null}
          </div> : null}
        </div>
        <aside className={styles.journal} aria-label={copy.objectives}>
          <nav className={styles.tabs} aria-label={copy.atlas}>
            {(["objectives", "places", "party"] as const).map(tab => {
              const Icon = tab === "objectives" ? ScrollText : tab === "places" ? Compass : Users;
              return <button key={tab} type="button" onClick={() => setSection(tab)} aria-pressed={section === tab}><Icon size={14} />{copy[tab]}<span>{tab === "objectives" ? quests.length : tab === "places" ? data?.locations.length ?? 0 : data?.party?.length ?? 0}</span></button>;
            })}
          </nav>
          {section === "places" ? <>
            <label className={styles.search}><Search size={15} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder={copy.search} aria-label={copy.search} /></label>
            <div className={styles.entries}>{places.map(location => {
              const Icon = PLACE_ICONS[locationKind(location)];
              return <button key={location.id} type="button" className={cn(styles.placeEntry, chosen?.id === location.id && styles.activeEntry)} onClick={() => showLocation(location.id)}><Icon size={20} strokeWidth={1.3} /><div><strong>{location.name}</strong><span>{location.isCurrent ? copy.here : location.visited ? copy.visited : copy.known}</span></div>{location.isCurrent ? <LocateFixed size={14} /> : null}</button>;
            })}</div>
          </> : section === "objectives" ? <div className={styles.entries}>
            {quests.length ? quests.map(quest => {
              const target = data?.locations.find(location => location.id === quest.locationId);
              const name = quest.text.includes(":") ? quest.text.slice(0, quest.text.indexOf(":")) : quest.text;
              const goal = quest.text.includes(":") ? quest.text.slice(quest.text.indexOf(":") + 1).trim() : "";
              return <div key={quest.id} className={cn(styles.questCard, tracked === quest.id && styles.activeEntry)}>
                <button type="button" className={styles.questHeading} aria-label={`${tracked === quest.id ? copy.untrack : copy.target}: ${name}`} aria-pressed={tracked === quest.id} onClick={() => { setTracked(tracked === quest.id ? null : quest.id); if (quest.locationId) showLocation(quest.locationId); }}><Diamond size={19} /><strong>{name}</strong></button>
                {goal ? <p>{goal}</p> : null}
                <span className={styles.destination}><MapPin size={12} />{target?.name ?? copy.unknownTarget}</span>
                {tracked === quest.id && target ? <span className={styles.routeHint}>{route.length ? `${copy.route}: ${route.map(id => data?.locations.find(location => location.id === id)?.name).join(" → ")}` : copy.noRoute}</span> : null}
                {steersStory ? <select aria-label={`${copy.bind}: ${name}`} value={quest.locationId ?? ""} onChange={event => void bindQuest(quest.id, event.target.value)}><option value="">{copy.unknownTarget}</option>{data?.locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select> : null}
              </div>;
            }) : <p className={styles.noEntries}><ScrollText size={24} strokeWidth={1} />{copy.noQuests}</p>}
          </div> : <div className={styles.entries}>{(data?.party ?? []).map(character => {
            const location = data?.locations.find(entry => entry.id === character.locationId);
            return <button type="button" key={character.id} className={styles.partyEntry} onClick={() => { if (character.locationId) showLocation(character.locationId); }} disabled={!location?.anchor}>
              <span className={styles.partyPortrait}>{character.portraitUrl ? <img src={character.portraitUrl} alt="" /> : character.name.slice(0, 1)}</span><div><strong>{character.name}</strong><span>{location?.name ?? copy.partyUnknown}</span></div><MapPin size={14} />
            </button>;
          })}</div>}
        </aside>
      </div>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {steersStory && studio && data ? <div className={styles.studio}>
          <h4><Pencil size={15} />{copy.tools}</h4><p>{copy.studioHint}</p>
          {data.map.terrainConflicts?.length ? <p role="status">{locale === "ru" ? "Проверьте совмещённые места и берег: " : "Check overlapping places and shores: "}{data.map.terrainConflicts.map(id => data.locations.find(location => location.id === id)?.name).filter(Boolean).join(", ")}</p> : null}
          {skin && !backdropImage ? <TileLegend skin={skin} /> : null}
          <ModeBar
            mode={mode}
            onMode={changeMode}
            partyPlaced={Boolean(data.map.partyXy)}
            onPartyTransit={() => void patch({ partyXy: null })}
            pinsCount={data.map.pins.filter(pin => !isQuestPin(pin)).length}
            onClearPins={() => void patch({ pins: data.map.pins.filter(isQuestPin) })}
            regenBusy={regenBusy}
            onRegenerate={() => void regenerate()}
          />
          {held ? (
            <p className="flex items-center gap-2 text-[11px] text-amber-200">
              {copy.holding(heldName)}
              {data.scope !== "spatial" ? <button
                type="button"
                onClick={() => setAsking({ kind: "rename", locationId: held })}
                className="rounded border border-stone-700 px-1.5 py-0.5 text-stone-400 hover:bg-stone-900"
              >
                {copy.rename}
              </button> : null}
            </p>
          ) : null}
          {mode === "paint" && skin ? (
            <PaintTools
              skin={skin}
              brush={brush}
              onBrush={setBrush}
              radius={brushRadius}
              onRadius={setBrushRadius}
              stranded={stranded}
            />
          ) : null}
          {mode === "line" ? (
            <LineTools
              kind={pathKind}
              onKind={setPathKind}
              pendingCount={pending.length}
              label={pathLabel}
              onLabel={setPathLabel}
              onFinish={() => void finishPath()}
              onUndo={() => setPending((current) => current.slice(0, -1))}
              onCancel={() => setPending([])}
            />
          ) : null}
          {mode === "label" ? <LabelTools size={labelSize} onSize={setLabelSize} /> : null}
          {mode === "erase" ? (
            <p className="text-[11px] text-stone-500">{copy.erase}</p>
          ) : null}
          <FileTools
            backdropPath={data.map.backdropPath}
            onBackdrop={(path) => void patch({ backdropPath: path })}
            onExport={() => void exportPng()}
            exporting={exporting}
            onImport={(files, size) => void importAzgaar(files, size)}
            importing={importing}
            importNote={importNote}
            mapSize={{ width: data.map.width, height: data.map.height }}
          />
          <OverworldAuthoring campaignId={campaignId} data={data} onData={setData} />
      </div> : null}
      <footer className={styles.help}>{copy.help}</footer>
    </section>
  );

  return <>
      {!expanded ? content : null}
      <Dialog.Root open={expanded} onOpenChange={setExpanded}>
        <Dialog.Portal><Dialog.Overlay className={styles.overlay} />
          <Dialog.Content className={styles.dialog} aria-describedby={undefined}>
            <Dialog.Title className={styles.srOnly}>{copy.atlas}</Dialog.Title>
            {expanded ? content : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <PromptDialog
        open={asking !== null}
        onOpenChange={(open) => {
          if (!open) {
            setAsking(null);
          }
        }}
        title={ask.title}
        label={ask.label}
        defaultValue={ask.defaultValue}
        maxLength={ask.maxLength}
        allowEmpty={ask.allowEmpty}
        submitLabel={ask.submitLabel}
        onSubmit={(value) => void answer(value)}
      />
  </>;
}
