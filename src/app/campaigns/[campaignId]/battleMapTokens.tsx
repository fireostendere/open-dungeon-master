import type { ReactNode } from "react";
import type { MapStyle } from "@/lib/battlemap/map-style";
import type { TokenKind } from "@/lib/battlemap/types";
import { cn } from "@/lib/cn";

// The body of a token in the painted styles: a coloured base, a shaded face
// and a highlight, so a piece reads as a raised miniature on the board and
// not as a flat dot. What is drawn on the face (portrait, initial, the
// downed cross, hit points) stays with BattleMapGrid, which also decides
// which colour the rim takes; this only paints the disc.
//
// The classic style keeps its own flat drawing in BattleMapGrid, unchanged.

export type PaintedStyle = Exclude<MapStyle, "classic">;

type Skin = {
  // Face gradient, lit at the top: [light, dark].
  face: Record<TokenKind | "down", [string, string]>;
  // The base ring when nothing more important (held, mine, downed) applies.
  rim: Record<TokenKind, string>;
  // A pale disc behind the base, for a busy or light board.
  halo: string | null;
  // The outline round the base.
  edge: string;
};

const DARK_FACES: Skin["face"] = {
  pc: ["#5a6d90", "#212a3f"],
  enemy: ["#9a3030", "#3b0e0e"],
  npc: ["#2a8079", "#0d302e"],
  prop: ["#94733f", "#4a3420"],
  down: ["#6b6660", "#2b2825"],
};

const SKINS: Record<PaintedStyle, Skin> = {
  flagstone: {
    face: DARK_FACES,
    rim: { pc: "#8fb0e0", enemy: "#f0524f", npc: "#3fd3c1", prop: "#b8ab94" },
    halo: null,
    edge: "#000",
  },
  torchlit: {
    face: DARK_FACES,
    rim: { pc: "#8fb0e0", enemy: "#f0524f", npc: "#3fd3c1", prop: "#b8ab94" },
    halo: null,
    edge: "#000",
  },
  parchment: {
    face: {
      pc: ["#56698f", "#26314a"],
      enemy: ["#a83a34", "#4a1310"],
      npc: ["#33897c", "#123a34"],
      prop: ["#9c7a45", "#54391f"],
      down: ["#8a8378", "#3a352e"],
    },
    rim: { pc: "#2b3a5c", enemy: "#5c1712", npc: "#164a42", prop: "#4a3218" },
    halo: "#f6edd3",
    edge: "#1c130a",
  },
  blueprint: {
    face: {
      pc: ["#18456d", "#0a2540"],
      enemy: ["#6b1d33", "#2f0b17"],
      npc: ["#2c5a1a", "#132a0b"],
      prop: ["#3b4b5e", "#1a2530"],
      down: ["#3d4652", "#1a1f26"],
    },
    rim: { pc: "#38bdf8", enemy: "#fb7185", npc: "#a3e635", prop: "#94a3b8" },
    halo: null,
    edge: "#02070d",
  },
};

const KINDS: Array<TokenKind | "down"> = ["pc", "enemy", "npc", "prop", "down"];

export function tokenDefs(uid: string, style: PaintedStyle): ReactNode {
  const skin = SKINS[style];
  return KINDS.map((kind) => (
    <radialGradient key={kind} id={`${uid}-tk-${kind}`} cx="0.35" cy="0.3" r="0.9">
      <stop offset="0%" stopColor={skin.face[kind][0]} />
      <stop offset="100%" stopColor={skin.face[kind][1]} />
    </radialGradient>
  ));
}

export function TokenBody({
  style,
  uid,
  kind,
  down,
  cx,
  cy,
  ring,
  hidden,
  emphasis,
}: {
  style: PaintedStyle;
  uid: string;
  kind: TokenKind;
  down: boolean;
  cx: number;
  cy: number;
  // A colour that beats the kind's own: held, the player's own, downed.
  ring: string | null;
  hidden: boolean;
  // The piece whose turn it is, or the one being held.
  emphasis: boolean;
}) {
  const skin = SKINS[style];
  const rim = down ? "#57534e" : (ring ?? skin.rim[kind]);
  const face = `url(#${uid}-tk-${down ? "down" : kind})`;
  const dash = hidden ? "3 2" : undefined;
  return (
    <>
      {skin.halo ? <circle cx={cx} cy={cy} r={17} fill={skin.halo} opacity={0.8} /> : null}
      {emphasis ? (
        <circle
          cx={cx}
          cy={cy}
          r={17.5}
          fill="none"
          stroke="#fbbf24"
          strokeWidth={2}
          strokeOpacity={0.95}
          className={cn("animate-pulse")}
        />
      ) : null}
      {kind === "prop" ? (
        <>
          <rect x={cx - 12} y={cy - 12} width={24} height={24} rx={3.5} fill={rim} stroke={skin.edge} strokeOpacity={0.65} strokeDasharray={dash} />
          <rect x={cx - 9.5} y={cy - 9.5} width={19} height={19} rx={2} fill={face} />
          <path
            d={`M${cx - 9.5} ${cy - 3}h19M${cx - 9.5} ${cy + 3.5}h19`}
            stroke="#000"
            strokeOpacity={0.3}
            strokeWidth={1}
            fill="none"
          />
          <rect x={cx - 9.5} y={cy - 9.5} width={19} height={19} rx={2} fill="none" stroke="#fff" strokeOpacity={0.18} />
        </>
      ) : (
        <>
          <circle cx={cx} cy={cy} r={14.5} fill={rim} stroke={skin.edge} strokeOpacity={0.65} strokeWidth={1} strokeDasharray={dash} />
          <circle cx={cx} cy={cy} r={12} fill={face} />
          <circle cx={cx} cy={cy} r={12} fill="none" stroke="#fff" strokeOpacity={0.2} strokeWidth={1} />
          <path
            d={`M${cx - 8} ${cy - 3.5}a9 9 0 0 1 10-6`}
            fill="none"
            stroke="#fff"
            strokeOpacity={0.3}
            strokeWidth={1.6}
            strokeLinecap="round"
          />
        </>
      )}
    </>
  );
}
