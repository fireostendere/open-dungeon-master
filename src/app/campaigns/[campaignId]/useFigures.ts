"use client";

import { useEffect, useReducer } from "react";
import { peekFigure, requestFigure, type FigureSprite } from "@/lib/battlemap/figure-sprite";
import type { FigureKind } from "@/lib/battlemap/figures";

// The miniatures for the tokens on a board, drawn on demand.
//
// Returns a lookup for one token: its picture once it exists, null while it
// is still being drawn or cannot be (no WebGL, a failed model), and the board
// keeps that piece's plain coin until then. Nothing here decides which
// creature a token is; that is the bestiary's reading of its name
// (src/lib/battlemap/figures.ts).

type Wanted = { kind: string; name: string };

const isFigure = (kind: string): kind is FigureKind => kind === "enemy" || kind === "npc";

export function useFigures(tokens: Wanted[], enabled: boolean): (token: Wanted) => FigureSprite | null {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  // The names on the board, as one string, so the effect below only runs
  // when a creature is added or renamed and not on every move.
  const wanted = enabled
    ? [...new Set(tokens.filter((t) => isFigure(t.kind)).map((t) => `${t.kind}\u0000${t.name}`))].sort().join("\u0001")
    : "";
  useEffect(() => {
    if (!wanted) return;
    let alive = true;
    for (const entry of wanted.split("\u0001")) {
      const [kind, name] = entry.split("\u0000");
      if (peekFigure(kind as FigureKind, name) === undefined) {
        void requestFigure(kind as FigureKind, name).then(() => {
          if (alive) rerender();
        });
      }
    }
    return () => {
      alive = false;
    };
  }, [wanted]);
  return (token) => (enabled && isFigure(token.kind) ? (peekFigure(token.kind, token.name) ?? null) : null);
}
