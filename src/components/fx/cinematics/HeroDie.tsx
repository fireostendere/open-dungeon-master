"use client";

import { useEffect, useRef } from "react";
import type { DicePaletteId } from "@/lib/fx/dice/atlas";
import type { DieOutcome, DiceStage, ThrowSide } from "@/lib/fx/dice/stage";
import type { DieKind } from "@/lib/fx/dice/geometry";
import { sfxDieClack } from "@/lib/fx/sound";

export type HeroThrow = {
  /** Changes to throw again (e.g. "drop more dice"). */
  key: number;
  dice: { kind: DieKind; value: number; palette: DicePaletteId }[];
  outcome: DieOutcome;
  from?: ThrowSide;
};

/**
 * A 3D die (or a handful) thrown into a box on the page: the finale's last
 * roll lands on 20 or 1. Framed to `box`, a fraction of the viewport.
 */
export function HeroDie({
  throwSpec,
  box = { x: 0.3, y: 0.08, w: 0.4, h: 0.42 },
  reducedMotion = false,
  onLanded,
}: {
  throwSpec: HeroThrow;
  box?: { x: number; y: number; w: number; h: number };
  reducedMotion?: boolean;
  onLanded?: (screen: { x: number; y: number; r: number } | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<DiceStage | null>(null);
  const specRef = useRef(throwSpec);
  const landedRef = useRef(onLanded);
  useEffect(() => {
    specRef.current = throwSpec;
    landedRef.current = onLanded;
  });

  const layout = () => {
    const W = window.innerWidth;
    const H = window.innerHeight;
    stageRef.current?.resize();
    stageRef.current?.setLayout({ x: box.x * W, y: box.y * H, width: box.w * W, height: box.h * H });
  };
  const layoutRef = useRef(layout);
  useEffect(() => {
    layoutRef.current = layout;
  });

  const throwNow = () => {
    const stage = stageRef.current;
    const spec = specRef.current;
    if (!stage) return;
    void stage.throw(spec.dice, { from: spec.from ?? "top" }).then(() => {
      spec.dice.forEach((_, i) => stage.setOutcome(i, spec.outcome));
      landedRef.current?.(stage.project(0));
    });
  };
  const throwRef = useRef(throwNow);
  useEffect(() => {
    throwRef.current = throwNow;
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const mod = await import("@/lib/fx/dice/stage");
      if (cancelled || !canvasRef.current || !mod.webglAvailable()) return;
      const stage = await mod.DiceStage.create(canvasRef.current, {
        reducedMotion,
        minExtent: { hx: 1.25, hz: 0.9 },
        onImpact: (s) => sfxDieClack(s),
      });
      if (cancelled) {
        stage.dispose();
        return;
      }
      stageRef.current = stage;
      layoutRef.current();
      throwRef.current();
    })();
    const onResize = () => layoutRef.current();
    window.addEventListener("resize", onResize);
    return () => {
      cancelled = true;
      window.removeEventListener("resize", onResize);
      stageRef.current?.dispose();
      stageRef.current = null;
    };
  }, [reducedMotion]);

  useEffect(() => {
    if (throwSpec.key > 0) throwRef.current();
  }, [throwSpec.key]);

  return <canvas ref={canvasRef} className="fx-canvas" />;
}
