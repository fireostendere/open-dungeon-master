export const YOLO_GAME_TOOL_NAME: "game";
export const YOLO_ENGINE_ACTIONS: readonly string[];

export type GameFacadeParseResult =
  | { ok: true; action: string; args: Record<string, unknown> }
  | { ok: false; error: string };

export function parseGameFacadeArgs(
  raw: unknown,
  allowedActions?: Iterable<string>,
): GameFacadeParseResult;
