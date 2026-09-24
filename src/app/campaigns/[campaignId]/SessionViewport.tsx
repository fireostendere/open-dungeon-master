"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { keyboardIsOpen, SESSION_MOBILE_QUERY } from "./session-mobile";
import "./session-mobile.css";

function subscribeMobile(listener: () => void) {
  const query = window.matchMedia(SESSION_MOBILE_QUERY);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}
export function useSessionMobile() {
  return useSyncExternalStore(subscribeMobile, () => window.matchMedia(SESSION_MOBILE_QUERY).matches, () => false);
}

const ReadingContext = createContext<{ reading: boolean; setReading: (reading: boolean) => void }>({ reading: false, setReading: () => {} });
export const useSessionReading = () => useContext(ReadingContext);

/** A layout boundary, not another game state/store. The live session stays mounted. */
export function SessionViewport({ children }: { children: ReactNode }) {
  const { locale } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [reading, updateReading] = useState(false);
  const mobile = useSessionMobile();
  const setReading = useCallback((next: boolean) => {
    const scroll = rootRef.current?.querySelector<HTMLElement>('[data-testid="campaign-messages"]');
    const top = scroll?.scrollTop ?? 0;
    const atBottom = scroll ? scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 48 : false;
    if (next) returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    updateReading(next);
    requestAnimationFrame(() => {
      if (scroll?.isConnected) scroll.scrollTop = atBottom ? scroll.scrollHeight : top;
      if (!next && returnFocusRef.current?.isConnected && returnFocusRef.current.getClientRects().length) returnFocusRef.current.focus({ preventScroll: true });
    });
  }, []);
  const value = useMemo(() => ({ reading: reading && mobile, setReading }), [reading, mobile, setReading]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const viewport = window.visualViewport;
    const docStyle = document.documentElement.style;
    const previousHeight = docStyle.getPropertyValue("--odm-session-vh");
    const previousTop = docStyle.getPropertyValue("--odm-session-top");
    let frame = 0;
    let baseline = window.innerHeight;
    let width = window.innerWidth;
    const update = () => {
      frame = 0;
      const narrow = window.matchMedia(SESSION_MOBILE_QUERY).matches;
      const scale = viewport?.scale ?? 1;
      // Do not counteract the user's zoom/pan or freeze the desktop viewport.
      if (!narrow || Math.abs(scale - 1) >= 0.05) {
        docStyle.removeProperty("--odm-session-vh");
        docStyle.removeProperty("--odm-session-top");
        root.dataset.keyboardOpen = "false";
        return;
      }
      const active = document.activeElement;
      const editing = active instanceof HTMLElement && active.matches('textarea:not(:disabled), input:not(:disabled):not([type="range"]):not([type="checkbox"]):not([type="radio"]), [contenteditable="true"]');
      const height = Math.round(viewport?.height ?? window.innerHeight);
      if (width !== window.innerWidth) { width = window.innerWidth; baseline = window.innerHeight; }
      if (!editing) baseline = window.innerHeight;
      baseline = Math.max(baseline, window.innerHeight);
      root.dataset.keyboardOpen = String(keyboardIsOpen({ editing, baselineHeight: baseline, visibleHeight: height, scale }));
      docStyle.setProperty("--odm-session-vh", `${height}px`);
      docStyle.setProperty("--odm-session-top", `${Math.round(viewport?.offsetTop ?? 0)}px`);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    document.addEventListener("focusin", schedule);
    document.addEventListener("focusout", schedule);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("focusin", schedule);
      document.removeEventListener("focusout", schedule);
      if (previousHeight) docStyle.setProperty("--odm-session-vh", previousHeight); else docStyle.removeProperty("--odm-session-vh");
      if (previousTop) docStyle.setProperty("--odm-session-top", previousTop); else docStyle.removeProperty("--odm-session-top");
    };
  }, []);

  useEffect(() => {
    if (!value.reading) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setReading(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [value.reading, setReading]);

  return <ReadingContext.Provider value={value}>
    <div ref={rootRef} className="session-viewport" data-reading={value.reading}>
      {children}
      {value.reading ? <button type="button" className="session-reading-return" onClick={() => setReading(false)}>
        <ArrowLeft aria-hidden="true" className="size-4" />{locale === "ru" ? "К игре" : "Back to game"}
      </button> : null}
    </div>
  </ReadingContext.Provider>;
}
