"use client";

import { Headphones, Maximize2, Minimize2, X } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { VoicePanel } from "./VoicePanel";
import type { VoicePanelProps } from "./VoicePanelControls";
import { headerButtonClass } from "./headerButton";
import { useI18n } from "@/lib/i18n/context";
import { localeText } from "@/lib/i18n/locale-text";
import { voiceCopy } from "./voice-copy";
import s from "./VoiceCall.module.css";
const noSubscribe = () => () => {};

// The call stays in one React position. Closing, resizing or expanding this
// dialog never recreates the microphone, controller or WebRTC transports.
export function VoiceDock(props: VoicePanelProps) {
  const { locale } = useI18n(); const copy = localeText(locale, voiceCopy);
  const [open, setOpen] = useState(false), [expanded, setExpanded] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null), panelRef = useRef<HTMLDivElement>(null), closeRef = useRef<HTMLButtonElement>(null);
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);
  const close = () => { setOpen(false); buttonRef.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => closeRef.current?.focus());
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); buttonRef.current?.focus(); return; }
      if (event.key !== "Tab") return;
      const focusable = [...(panelRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex]:not([tabindex='-1'])") ?? [])]
        .filter(element => element.getClientRects().length > 0 && element.tabIndex >= 0);
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || !panelRef.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !panelRef.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("keydown", keydown); };
  }, [open]);
  const onCall = Boolean(props.roster?.some(peer => peer.userId === props.meUserId));
  const count = props.roster?.length ?? 0;
  return <>
    <button ref={buttonRef} type="button" onClick={() => setOpen(value => !value)} aria-label={copy.title}
      title={copy.title} aria-haspopup="dialog" aria-expanded={open} data-tour="header-voice"
      className={headerButtonClass(open, "relative flex items-center gap-1.5 md:px-2.5")}>
      <Headphones className="size-4" /><span className="hidden text-sm md:inline">{copy.title}</span>
      {count ? <span className={s.count}>{count}</span> : null}{onCall ? <span className={s.dot} style={{ background: "#76d7a5" }} /> : null}
    </button>
    {mounted ? createPortal(<div hidden={!open} className={s.dockLayer}>
      <div className={s.dockBackdrop} aria-hidden="true" onPointerDown={close} />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label={copy.title} className={`${s.dockPanel} ${expanded ? s.dockExpanded : ""}`}>
        <div className={s.dockTitlebar}><span>{copy.closeKeepsCall}</span><div className={s.buttonRow}>
          <button type="button" className={s.iconButton} title={expanded ? copy.collapse : copy.expand} aria-label={expanded ? copy.collapse : copy.expand}
            onClick={() => setExpanded(value => !value)}>{expanded ? <Minimize2 /> : <Maximize2 />}</button>
          <button ref={closeRef} type="button" className={s.iconButton} title={copy.close} aria-label={copy.close} onClick={close}><X /></button>
        </div></div>
        <VoicePanel {...props} visible={open} compact={false} />
      </div>
    </div>, document.body) : null}
  </>;
}
