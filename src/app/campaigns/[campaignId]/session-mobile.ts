/** Presentation only. Never decides whether a game action is permitted. */
export const SESSION_MOBILE_QUERY = "(max-width: 1023px)";

export function keyboardIsOpen({
  editing, baselineHeight, visibleHeight, scale = 1,
}: { editing: boolean; baselineHeight: number; visibleHeight: number; scale?: number }): boolean {
  // Browser chrome and pinch zoom are not a software keyboard.
  return editing && Math.abs(scale - 1) < 0.05 && baselineHeight - visibleHeight > 120;
}

export function composerHeight(scrollHeight: number, viewportHeight: number): number {
  return Math.min(Math.max(32, scrollHeight), Math.max(64, Math.min(144, viewportHeight * 0.25)));
}

/** Fixed destinations, not a horizontally scrolling list of every feature. */
export function mobileTabIds<T extends string>(available: readonly T[]): T[] {
  const preferred = ["party", "battle", "chat"];
  return preferred.filter(id => available.includes(id as T)) as T[];
}

/** A phone's Return inserts a line; sending is explicit. Never submit IME text. */
export function shouldSubmitComposerKey({ key, shift, modifier, composing, mobile }: {
  key: string; shift: boolean; modifier: boolean; composing: boolean; mobile: boolean;
}): boolean {
  return key === "Enter" && !composing && !shift && (!mobile || modifier);
}
