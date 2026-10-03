"use client";

import { useInlineText } from "@/lib/i18n/inline-text";
import { useI18n } from "@/lib/i18n/context";
import { memo, useEffect, useId, useMemo, useRef } from "react";
import { cn } from "@/lib/cn";
import {
  buildCells,
  PALETTES,
  shade,
  TILE,
} from "@/app/campaigns/[campaignId]/battleMapCells";
import { buildPaintedCells } from "@/app/campaigns/[campaignId]/battleMapStyles";
import { TokenBody } from "@/app/campaigns/[campaignId]/battleMapTokens";
import { MapControls, useMapCamera } from "@/app/campaigns/[campaignId]/useMapCamera";
import { DEFAULT_MAP_STYLE, MAP_TILT_HOST_STYLE, mapTiltBand, mapTiltStyle, type MapStyle } from "@/lib/battlemap/map-style";
import { useFxSettings } from "@/lib/fx/prefs";
import { backdropRect } from "@/lib/battlemap/backdrop";
import type { PlayerMapView } from "@/lib/battlemap/view";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { conditionIconKey, iconCandidates } from "@/lib/icons";

// Pure SVG renderer for a player's fogged battle-map view, themed by the
// environment the generator picked. All game rules live server-side; this
// only draws what the projection says and reports tile clicks upward.
//
// Terrain is drawn in layers so richer detail (beveled walls, cast shadows,
// layered water, a fractal-noise grain pass) never leaks past the fog: the
// projection blanks unexplored tiles to " ", so neighbour lookups below stop
// cleanly at explored edges.
//
// The look is a per-device choice (src/lib/battlemap/map-style.ts). The
// classic style is the flat tile layer below; the others paint whole regions
// (battleMapStyles.tsx). They read the same projection and draw the same
// fog, so which one is worn changes nothing about what anyone can see.
//
// Everything above the terrain is an overlay the parent hands down: a
// measured template, a drag ruler, live pings, the token the DM has picked
// up. The grid draws them and reports clicks; it decides nothing.

export type MapOverlay = {
  // Tile indexes covered by a measured area (src/lib/battlemap/template.ts).
  template?: number[];
  // The drag ruler: the path a move would take and what it would cost.
  ruler?: { path: Array<{ x: number; y: number }>; label: string; overBudget: boolean } | null;
  // Somebody pointing at a tile. Ephemeral, so these arrive and expire.
  pings?: Array<{ x: number; y: number; by: string; at: number }>;
  // The token the DM is holding, waiting for a tile to put it on.
  selectedTokenId?: string | null;
};

// Memoized: the session view re-renders on every SSE event (including each
// streamed narration token), and rebuilding width*height SVG cells each
// time is Firefox's slowest path. The click handler routes through a ref so
// the parent's inline closure never invalidates the memo.
// The painted condition badges a token wears: the first two distinct
// paintings among its conditions, so a tile never fills with badges.
function conditionBadges(conditions: string[] | undefined): string[] {
  const paths = (conditions ?? []).flatMap((condition) => iconCandidates({ kind: "condition", key: conditionIconKey(condition) }));
  return [...new Set(paths)].slice(0, 2);
}

export const BattleMapGrid = memo(
  function BattleMapGrid({
    view,
    sheets,
    onTileClick,
    onTileHover,
    onTokenClick,
    everyTileClickable = false,
    overlay,
    mapStyle = DEFAULT_MAP_STYLE,
    tilt = false,
    expanded = false,
    conditions,
  }: {
    view: PlayerMapView;
    sheets: CharacterSheet[];
    // Conditions by token refId (a sheet or an enemy id), as the viewer was
    // already sent them on the party and encounter panels. Painted as small
    // badges on the token; a condition with no painting gets none.
    conditions?: Map<string, string[]>;
    onTileClick?: (x: number, y: number) => void;
    onTileHover?: (x: number, y: number | null) => void;
    onTokenClick?: (tokenId: string) => void;
    // Players may only click where they can walk, so the reachable overlay
    // is the whole clickable surface. A DM placing a token needs the rest of
    // the board too, which is what this turns on.
    everyTileClickable?: boolean;
    overlay?: MapOverlay;
    mapStyle?: MapStyle;
    // The table leans a little toward the viewer (map-style.ts).
    tilt?: boolean;
    // The map has a screen to itself (the enlarged view): on a phone it fills
    // the screen, and the wheel zooms without a modifier key.
    expanded?: boolean;
  }) {
  const uiText = useInlineText();
  const { locale } = useI18n();
    const clickRef = useRef(onTileClick);
    const hoverRef = useRef(onTileHover);
    const tokenRef = useRef(onTokenClick);
    useEffect(() => {
      clickRef.current = onTileClick;
      hoverRef.current = onTileHover;
      tokenRef.current = onTokenClick;
    });
    // Touch has no hover, so the ruler and range previews the mouse gets for
    // free would never appear on a phone. Instead the first tap on a tile IS
    // the preview: it feeds the hover handler (the walk, its cost in feet, a
    // held piece's route) and commits nothing, and the second tap on the
    // same tile is the one that goes through. Only taps take this route, and
    // only when a hover handler is wired at all, so mouse and pen clicks and
    // every preview-less mode (pointing, placing, measuring) keep their
    // one-step feel.
    const pointerTypeRef = useRef("");
    const touchPreviewRef = useRef<{ x: number; y: number } | null>(null);
    // A new board must not inherit the old one's pending confirm tap.
    useEffect(() => {
      touchPreviewRef.current = null;
    }, [view.mapId]);
    const { width, height } = view;
    const palette = PALETTES[view.theme] ?? PALETTES.field;
    const portraitsByRef = new Map(
      sheets.filter((sheet) => sheet.portrait).map((sheet) => [sheet.id, sheet.portrait!.url]),
    );
    const currentName = view.currentTurnName.toLowerCase();

    // Ids are per instance: the panel and its enlarged dialog can both be
    // mounted, and a gradient or clip defined in a hidden copy does not
    // resolve in the visible one.
    const uid = `bm${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
    const { reducedMotion: calm, compact } = useFxSettings();

    // The window onto the board: zoom, and pan with a finger. It starts on the
    // player's own piece, or on whoever's turn it is.
    const focusToken =
      view.tokens.find((token) => token.id === view.myTokenId) ??
      view.tokens.find((token) => !token.down && currentName !== "" && token.name.toLowerCase() === currentName);
    const focus = focusToken ? { x: focusToken.x * TILE + TILE / 2, y: focusToken.y * TILE + TILE / 2 } : null;
    const camera = useMapCamera({
      mapId: view.mapId,
      W: width * TILE,
      H: height * TILE,
      tile: TILE,
      compact,
      focus,
      turnKey: `${view.mapId}:${view.round}:${view.currentTurnName}`,
      wheelZoom: expanded,
    });
    // A tilted board leaves an empty band above its far edge, which the
    // window takes back. Not on a phone: its window is tall and the band
    // would eat a fifth of it.
    const tilted = tilt && !compact;
    const band = tilted && camera.box.w > 0 ? mapTiltBand(camera.box.h / camera.box.w) : 0;
    const controlLabels = {
      zoomIn: uiText("zoomIn"),
      zoomOut: uiText("zoomOut"),
      fit: uiText("fitTheWholeMap"),
      locate: locale === "ru" ? "К моей фигуре" : "Centre on my piece",
    };

    // The terrain/fog/reachable cell layer only changes when the view
    // projection itself changes; token/light layers below stay cheap.
    const layers = useMemo(
      () =>
        mapStyle === "classic"
          ? { defs: null, cells: buildCells(view, palette) }
          : buildPaintedCells(view, palette, mapStyle, uid, calm),
      [view, palette, mapStyle, uid, calm],
    );
    const cells = layers.cells;
    const classic = mapStyle === "classic";

    // A transparent grid that makes every tile a click and hover target.
    // It sits UNDER the tokens so that clicking a figure still reaches the
    // figure, which is the whole point of picking one up.
    const catcher = useMemo(() => {
      if (!everyTileClickable) {
        return null;
      }
      const rects: React.ReactNode[] = [];
      for (let idx = 0; idx < width * height; idx += 1) {
        const x = idx % width;
        const y = Math.floor(idx / width);
        rects.push(
          <rect
            key={`hit-${idx}`}
            x={x * TILE}
            y={y * TILE}
            width={TILE}
            height={TILE}
            fill="transparent"
            className="cursor-crosshair"
            data-tile-x={x}
            data-tile-y={y}
          />,
        );
      }
      return <g>{rects}</g>;
    }, [everyTileClickable, width, height]);

    // Delegated tile clicks: the memoized cell layer carries data attributes
    // instead of per-rect closures, so cells never rebuild for a new handler.
    function readTile(event: React.MouseEvent<SVGSVGElement>) {
      const target = event.target as SVGElement;
      const x = target.dataset?.tileX;
      const y = target.dataset?.tileY;
      // A token is a group of shapes: the click lands on one of them, and the
      // id is on the group.
      const tokenId = (target.closest?.("[data-token-id]") as SVGElement | null)?.dataset?.tokenId;
      return x !== undefined && y !== undefined
        ? { x: Number(x), y: Number(y), tokenId }
        : { x: null, y: null, tokenId };
    }

    function handleSvgClick(event: React.MouseEvent<SVGSVGElement>) {
      const { x, y, tokenId } = readTile(event);
      if (tokenId) {
        tokenRef.current?.(tokenId);
        return;
      }
      if (x === null || y === null) {
        return;
      }
      // First tap previews, second commits; see the refs above. Browsers
      // fire compatibility mouse events on a tap, but not reliably, so the
      // hover handler is called here rather than trusted to have run.
      if (pointerTypeRef.current === "touch" && hoverRef.current) {
        const previewed = touchPreviewRef.current;
        if (!previewed || previewed.x !== x || previewed.y !== y) {
          touchPreviewRef.current = { x, y };
          hoverRef.current(x, y);
          return;
        }
        touchPreviewRef.current = null;
      }
      clickRef.current?.(x, y);
    }

    function handleSvgMove(event: React.MouseEvent<SVGSVGElement>) {
      if (!hoverRef.current) {
        return;
      }
      const { x, y } = readTile(event);
      if (x === null || y === null) {
        hoverRef.current(0, null);
        return;
      }
      hoverRef.current(x, y);
    }

    return (
      <div style={MAP_TILT_HOST_STYLE}>
        <div
          ref={camera.wrapRef}
          // On a phone the window is tall and the board is big inside it;
          // on a desk it is the board's own shape. Either way a finger moves
          // it, so the page must not scroll under one. Tilted, the window is
          // pulled up over whatever sits above it (the header's buttons), so
          // only the board and its controls take a press, not the empty band.
          className={cn(
            "relative w-full touch-none select-none",
            expanded ? "max-md:h-[calc(100dvh-6rem)]" : "max-md:h-[62dvh]",
            band && "pointer-events-none *:pointer-events-auto",
          )}
          style={{ aspectRatio: `${width} / ${height}`, marginTop: band ? `${(-band).toFixed(2)}cqw` : undefined }}
          {...camera.handlers}
        >
      <svg
        viewBox={camera.viewBox}
        className="absolute inset-0 h-full w-full select-none rounded-lg border border-stone-800 bg-stone-950"
        // The SVG's own overflow does not hold back what its blurred layers
        // spill past the window (Chrome), and zoomed in that is a strip of
        // map over whatever sits above it. The clip does, and keeps the corners.
        style={{ clipPath: "inset(0 round 0.5rem)", ...(tilted ? mapTiltStyle() : {}) }}
        role="img"
        aria-label={uiText("battleMap")}
        onClick={handleSvgClick}
        onPointerDown={(event) => {
          pointerTypeRef.current = event.pointerType;
        }}
        onMouseMove={onTileHover ? handleSvgMove : undefined}
        onMouseLeave={onTileHover ? () => hoverRef.current?.(0, null) : undefined}
      >
        <defs>
          <radialGradient id="mapvignette">
            <stop offset="55%" stopColor="#000" stopOpacity={0} />
            <stop offset="100%" stopColor="#000" stopOpacity={0.45} />
          </radialGradient>
          {layers.defs}
          {/* Condition badges: the painting is scaled up inside a disc, as
              GameIcon does, so its wide margin is cropped away. */}
          <clipPath id={`${uid}-badge`} clipPathUnits="objectBoundingBox">
            <circle cx={0.5} cy={0.5} r={0.3} />
          </clipPath>
          {/* The terrain stops at the board's edge: its glows and soft shadows must
              not spill into the empty space a zoomed-out window shows round it. */}
          <clipPath id={`${uid}-map`}>
            <rect x={0} y={0} width={width * TILE} height={height * TILE} />
          </clipPath>
          {classic ? (
            <>
              <radialGradient id="torchglow">
                <stop offset="0%" stopColor="#fbbf24" stopOpacity={0.3} />
                <stop offset="70%" stopColor="#f59e0b" stopOpacity={0.1} />
                <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
              </radialGradient>
              {/* Fractal grain overlaid on terrain for a hand-laid surface. */}
              <filter id={`grain-${view.theme}`} x="0" y="0" width="100%" height="100%">
                <feTurbulence
                  type="fractalNoise"
                  baseFrequency="0.9"
                  numOctaves={2}
                  seed={7}
                  stitchTiles="stitch"
                  result="n"
                />
                <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.5 0" />
              </filter>
              <linearGradient id={`water-${view.theme}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={shade(palette.water, 26)} />
                <stop offset="100%" stopColor={shade(palette.water, -18)} />
              </linearGradient>
              <linearGradient id="castN" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#000" stopOpacity={0.5} />
                <stop offset="100%" stopColor="#000" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="castW" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#000" stopOpacity={0.42} />
                <stop offset="100%" stopColor="#000" stopOpacity={0} />
              </linearGradient>
            </>
          ) : null}
          {view.tokens.map((token) =>
            portraitsByRef.has(token.refId) ? (
              <clipPath key={`clip-${token.id}`} id={`token-clip-${token.id}`}>
                <circle
                  cx={token.x * TILE + TILE / 2}
                  cy={token.y * TILE + TILE / 2}
                  r={TILE / 2 - 4}
                />
              </clipPath>
            ) : null,
          )}
        </defs>
        {/* The picture under the grid, drawn first so every terrain cell,
            every fog square and every token lands on top of it. Unexplored
            tiles are opaque, so the art is covered exactly where the fog
            covers the terrain (src/lib/battlemap/backdrop.ts). */}
        {view.backdrop ? (
          <image
            href={view.backdrop.path}
            {...backdropRect(view.backdrop.transform, width, height, TILE)}
            opacity={view.backdrop.transform.opacity}
            preserveAspectRatio="none"
            pointerEvents="none"
          />
        ) : null}
        <g clipPath={`url(#${uid}-map)`}>{cells}</g>
        {/* The DM's overlay, the annotated picture, in the backdrop's
            register. Only the DM's projection carries it. */}
        {view.overlayPath ? (
          <image
            href={view.overlayPath}
            {...(view.backdrop
              ? backdropRect(view.backdrop.transform, width, height, TILE)
              : { x: 0, y: 0, width: width * TILE, height: height * TILE })}
            opacity={0.85}
            preserveAspectRatio="none"
            pointerEvents="none"
          />
        ) : null}
        {catcher}
        {(classic ? view.lights : []).map((light, index) => (
          <circle
            key={`light-${index}`}
            cx={light.x * TILE + TILE / 2}
            cy={light.y * TILE + TILE / 2}
            r={light.radius * TILE}
            fill="url(#torchglow)"
            pointerEvents="none"
          />
        ))}
        {view.tokens.map((token) => {
          const cx = token.x * TILE + TILE / 2;
          const cy = token.y * TILE + TILE / 2;
          const portrait = portraitsByRef.get(token.refId);
          const isCurrent =
            !token.down && currentName !== "" && token.name.toLowerCase() === currentName;
          const held = overlay?.selectedTokenId === token.id;
          const ring = token.down
            ? "#57534e"
            : held
              ? "#fbbf24"
              : token.mine
                ? "#fbbf24"
                : RING_BY_KIND[token.kind];
          const hp = view.tokenHp?.[token.id];
          return (
            <g
              key={token.id}
              // Tokens only take clicks where somebody upstream wants them:
              // for a player the map is a floor to walk on, not a set of
              // pieces to pick up.
              pointerEvents={onTokenClick ? "auto" : "none"}
              data-token-id={onTokenClick ? token.id : undefined}
              className={cn(onTokenClick && "cursor-pointer")}
              opacity={token.down ? 0.75 : token.hidden ? 0.55 : 1}
            >
              <title>{token.name}</title>
              <ellipse
                cx={cx}
                cy={cy + TILE / 2 - 5}
                rx={TILE / 2.6}
                ry={3.5}
                fill="#000"
                opacity={0.35}
                pointerEvents="none"
              />
              {!classic ? (
                <TokenBody
                  style={mapStyle}
                  uid={uid}
                  kind={token.kind}
                  down={token.down}
                  cx={cx}
                  cy={cy}
                  ring={held || token.mine ? "#fbbf24" : null}
                  hidden={token.hidden}
                  emphasis={isCurrent || held}
                />
              ) : token.kind === "prop" ? (
                // A prop is a thing, not a person, so it is not a circle.
                <rect
                  x={cx - TILE / 2 + 4}
                  y={cy - TILE / 2 + 4}
                  width={TILE - 8}
                  height={TILE - 8}
                  rx={3}
                  fill="#221d18"
                  stroke={ring}
                  strokeWidth={1.5}
                  strokeDasharray={token.hidden ? "3 2" : undefined}
                />
              ) : (
                <circle
                  cx={cx}
                  cy={cy}
                  r={TILE / 2 - 3}
                  fill={FILL_BY_KIND[token.kind]}
                  stroke={ring}
                  strokeWidth={token.mine || isCurrent || held ? 2.5 : 1.5}
                  strokeDasharray={token.hidden ? "3 2" : undefined}
                  className={cn((isCurrent || held) && "animate-pulse")}
                />
              )}
              {portrait ? (
                <image
                  href={portrait}
                  x={token.x * TILE + 4}
                  y={token.y * TILE + 4}
                  width={TILE - 8}
                  height={TILE - 8}
                  preserveAspectRatio="xMidYMid slice"
                  clipPath={`url(#token-clip-${token.id})`}
                  opacity={token.down ? 0.45 : 1}
                />
              ) : (
                <text
                  x={cx}
                  y={cy + 4.5}
                  textAnchor="middle"
                  fontSize={13}
                  fontWeight={700}
                  fill={token.down ? "#a8a29e" : token.kind === "enemy" ? "#fca5a5" : "#e7e5e4"}
                  {...(classic ? {} : { stroke: "#000", strokeOpacity: 0.55, strokeWidth: 2.5, paintOrder: "stroke" })}
                >
                  {token.name.charAt(0).toUpperCase()}
                </text>
              )}
              {token.down ? (
                <text
                  x={cx}
                  y={cy + 5}
                  textAnchor="middle"
                  fontSize={15}
                  fontWeight={700}
                  fill="#ef4444"
                  pointerEvents="none"
                >
                  ✕
                </text>
              ) : null}
              {/* Real hit points, DM projection only: the server sends
                  tokenHp to nobody else (src/lib/battlemap/view.ts). */}
              {hp && hp.max > 0 ? (
                <g pointerEvents="none">
                  <rect
                    x={cx - TILE / 2 + 4}
                    y={cy + TILE / 2 - 6}
                    width={TILE - 8}
                    height={3}
                    rx={1.5}
                    fill="#0c0a09"
                    opacity={0.85}
                  />
                  <rect
                    x={cx - TILE / 2 + 4}
                    y={cy + TILE / 2 - 6}
                    width={Math.max(0, Math.min(1, hp.current / hp.max)) * (TILE - 8)}
                    height={3}
                    rx={1.5}
                    fill={hp.current / hp.max > 0.5 ? "#4ade80" : hp.current / hp.max > 0.25 ? "#facc15" : "#ef4444"}
                  />
                </g>
              ) : null}
              {conditionBadges(conditions?.get(token.refId)).map((src, index) => {
                const bx = cx - TILE / 2 + 6 + index * 12;
                const by = cy - TILE / 2 + 6;
                return (
                  <g key={src} pointerEvents="none">
                    <circle cx={bx} cy={by} r={6.5} fill="#1d1712" stroke="#b45309" strokeWidth={0.75} />
                    <image href={src} x={bx - 10} y={by - 10} width={20} height={20} clipPath={`url(#${uid}-badge)`} />
                  </g>
                );
              })}
              {token.hidden ? (
                <text
                  x={cx + TILE / 2 - 5}
                  y={cy - TILE / 2 + 9}
                  textAnchor="middle"
                  fontSize={9}
                  fill="#fbbf24"
                  pointerEvents="none"
                >
                  ●
                </text>
              ) : null}
            </g>
          );
        })}
        {/* The scene layer (src/lib/battlemap/scene.ts): labels where the
            projection allows them, and for the DM the state of every shut
            door, as a badge on the door glyph they alone still see. */}
        {view.labels.map((label) => (
          <g key={`label-${label.x}-${label.y}`} pointerEvents="none">
            <circle
              cx={label.x * TILE + TILE / 2}
              cy={label.y * TILE + TILE / 2}
              r={3}
              fill={label.dmOnly ? "#a78bfa" : "#fbbf24"}
            />
            <text
              x={label.x * TILE + TILE / 2}
              y={label.y * TILE + TILE / 2 - 6}
              textAnchor="middle"
              fontSize={11}
              fill={label.dmOnly ? "#c4b5fd" : "#fde68a"}
              stroke="#000"
              strokeWidth={3}
              paintOrder="stroke"
              style={{ fontFamily: "sans-serif" }}
            >
              {label.text}
            </text>
          </g>
        ))}
        {view.doors
          ? Object.entries(view.doors).map(([key, state]) => {
              const [dx, dy] = key.split(",").map(Number);
              return (
                <g key={`door-${key}`} pointerEvents="none">
                  <rect
                    x={dx * TILE + TILE * 0.55}
                    y={dy * TILE + TILE * 0.05}
                    width={TILE * 0.4}
                    height={TILE * 0.4}
                    rx={2}
                    fill={state === "locked" ? "#f59e0b" : "#a78bfa"}
                  />
                  <text
                    x={dx * TILE + TILE * 0.75}
                    y={dy * TILE + TILE * 0.25 + 4}
                    textAnchor="middle"
                    fontSize={10}
                    fontWeight="bold"
                    fill="#0c0a09"
                    style={{ fontFamily: "sans-serif" }}
                  >
                    {state === "locked" ? "L" : "S"}
                  </text>
                </g>
              );
            })
          : null}
        {/* Measured area. Drawn above the tokens so the DM can see who is
            standing in it without hunting for the outline. */}
        {overlay?.template?.length ? (
          <g pointerEvents="none">
            {overlay.template.map((idx) => (
              <rect
                key={`tpl-${idx}`}
                x={(idx % width) * TILE}
                y={Math.floor(idx / width) * TILE}
                width={TILE}
                height={TILE}
                fill="#f97316"
                opacity={0.26}
                stroke="#fb923c"
                strokeOpacity={0.5}
              />
            ))}
          </g>
        ) : null}
        {/* The drag ruler: the path a move would actually take, and its cost
            in feet, measured with the same pathfinder the server enforces. */}
        {overlay?.ruler && overlay.ruler.path.length ? (
          <g pointerEvents="none">
            <polyline
              points={overlay.ruler.path
                .map((step) => `${step.x * TILE + TILE / 2},${step.y * TILE + TILE / 2}`)
                .join(" ")}
              fill="none"
              stroke={overlay.ruler.overBudget ? "#ef4444" : "#fbbf24"}
              strokeWidth={2}
              strokeDasharray="5 3"
              strokeLinejoin="round"
            />
            {(() => {
              const last = overlay.ruler.path[overlay.ruler.path.length - 1];
              return (
                <>
                  <rect
                    x={last.x * TILE - 6}
                    y={last.y * TILE - 14}
                    width={44}
                    height={14}
                    rx={3}
                    fill="#0c0a09"
                    opacity={0.85}
                  />
                  <text
                    x={last.x * TILE + 16}
                    y={last.y * TILE - 4}
                    textAnchor="middle"
                    fontSize={10}
                    fontWeight={600}
                    fill={overlay.ruler.overBudget ? "#fca5a5" : "#fcd34d"}
                  >
                    {overlay.ruler.label}
                  </text>
                </>
              );
            })()}
          </g>
        ) : null}
        {/* Somebody pointing. The ring expands and fades on its own, so a
            ping needs no state beyond the moment it arrived. */}
        {overlay?.pings?.map((ping) => (
          <g key={`ping-${ping.at}-${ping.x}-${ping.y}`} pointerEvents="none">
            <circle
              cx={ping.x * TILE + TILE / 2}
              cy={ping.y * TILE + TILE / 2}
              r={TILE * 0.9}
              fill="none"
              stroke="#fbbf24"
              strokeWidth={2.5}
              className="animate-ping"
            />
            <text
              x={ping.x * TILE + TILE / 2}
              y={ping.y * TILE - 4}
              textAnchor="middle"
              fontSize={10}
              fontWeight={600}
              fill="#fcd34d"
            >
              {ping.by}
            </text>
          </g>
        ))}
        <rect
          x={0}
          y={0}
          width={width * TILE}
          height={height * TILE}
          fill="url(#mapvignette)"
          pointerEvents="none"
        />
      </svg>
          <MapControls
            camera={camera}
            canLocate={Boolean(focus)}
            top={band ? `calc(${band.toFixed(2)}cqw + 0.5rem)` : "0.5rem"}
            labels={controlLabels}
          />
        </div>
      </div>
    );
  },
  (prev, next) =>
    prev.view === next.view &&
    prev.sheets === next.sheets &&
    // The overlay is compared by reference, so a parent that rebuilds it
    // every render would defeat the memo. BattleMapPanel memoizes it.
    prev.overlay === next.overlay &&
    prev.everyTileClickable === next.everyTileClickable &&
    prev.mapStyle === next.mapStyle &&
    prev.tilt === next.tilt &&
    prev.expanded === next.expanded &&
    // Only presence matters; the handlers themselves are read through refs.
    (prev.onTileClick === undefined) === (next.onTileClick === undefined) &&
    (prev.onTileHover === undefined) === (next.onTileHover === undefined) &&
    (prev.onTokenClick === undefined) === (next.onTokenClick === undefined),
);

// Token colours by what the piece is. Props and NPCs are visibly not
// combatants, because the fastest way to misread a board is to think the
// barrel is a monster.
const RING_BY_KIND: Record<string, string> = {
  pc: "#78716c",
  enemy: "#dc2626",
  npc: "#38bdf8",
  prop: "#a8a29e",
};

const FILL_BY_KIND: Record<string, string> = {
  pc: "#1c1917",
  enemy: "#450a0a",
  npc: "#0c1a24",
  prop: "#221d18",
};

