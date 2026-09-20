export type DndPlayMode = "full" | "yolo";
export type DndRuntimeSource = "internal" | "custom-opencode" | "external";
export function explicitYoloRequested(options?: { requested?: boolean | string; env?: Record<string, string | undefined> }): boolean;
export function resolveDndPlayMode(options?: { source?: DndRuntimeSource | string; requested?: boolean | string; env?: Record<string, string | undefined> }): DndPlayMode;
export function isYoloMode(options?: { source?: DndRuntimeSource | string; requested?: boolean | string; env?: Record<string, string | undefined> }): boolean;
