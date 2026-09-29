"use client";

// Someone else's roll, told in one small plate under the header: who, what,
// the total and how it went. Non-blocking; it leaves by itself after a few
// seconds (counted only while the page is actually visible) or on a tap.

import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { FxIcon } from "./icons";
import type { RollActor, RollIcon } from "./roll-context";

export type RollToastItem = {
  id: string;
  actor: RollActor | null;
  ownerLabel: string;
  kindLabel: string;
  icon: RollIcon;
  action: string;
  target: string | null;
  expression: string;
  /** Null for a roll whose number this seat may not see. */
  total: number | null;
  verdict: string | null;
  tone: "gold" | "crimson" | "steel";
  hidden: boolean;
};

const HOLD_MS = 3800;

function Toast({ item, onDone, closeLabel }: { item: RollToastItem; onDone: (id: string) => void; closeLabel: string }) {
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  useEffect(() => {
    let timer = 0;
    const arm = () => {
      window.clearTimeout(timer);
      if (!document.hidden) timer = window.setTimeout(() => done.current(item.id), HOLD_MS);
    };
    arm();
    document.addEventListener("visibilitychange", arm);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", arm);
    };
  }, [item.id]);

  const actor = item.actor;
  return (
    <button
      type="button"
      className={cn("fx-toast", `fx-toast--${item.tone}`, actor && `fx-toast--${actor.kind}`)}
      onClick={() => onDone(item.id)}
      aria-label={closeLabel}
    >
      <span className="fx-toast__avatar" aria-hidden="true">
        {actor?.portraitUrl ? (
          // Portraits are local /uploads files; next/image adds nothing here.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={actor.portraitUrl} alt="" />
        ) : actor?.kind === "enemy" || actor?.kind === "dm" ? (
          <FxIcon name={actor.kind === "dm" ? "crown" : "skull"} size={18} />
        ) : (
          (actor?.name ?? "?").slice(0, 1)
        )}
      </span>
      <span className="fx-toast__body">
        <span className="fx-toast__who">
          <b>{actor?.name ?? item.ownerLabel}</b>
          <span className="fx-toast__owner">{item.ownerLabel}</span>
        </span>
        <span className="fx-toast__what">
          <FxIcon name={item.icon} size={13} />
          <span>
            {item.kindLabel}
            {item.action ? `: ${item.action}` : ""}
            {item.target ? ` → ${item.target}` : ""}
          </span>
        </span>
      </span>
      <span className="fx-toast__result">
        <span className="fx-toast__total">{item.total ?? "?"}</span>
        {item.verdict ? <span className="fx-toast__verdict">{item.verdict}</span> : <span className="fx-toast__expr">{item.expression}</span>}
      </span>
    </button>
  );
}

export function RollToasts({
  items,
  onDone,
  label,
  closeLabel,
}: {
  items: RollToastItem[];
  onDone: (id: string) => void;
  label: string;
  closeLabel: string;
}) {
  if (!items.length) return null;
  return (
    <div className="fx-layer fx-toasts" role="log" aria-live="polite" aria-label={label}>
      {items.map((item) => (
        <Toast key={item.id} item={item} onDone={onDone} closeLabel={closeLabel} />
      ))}
    </div>
  );
}
