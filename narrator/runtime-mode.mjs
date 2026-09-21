import { resolveDndPlayMode } from "../shared/dnd-play-mode.mjs";
import {
  YOLO_ENGINE_ACTIONS,
  YOLO_GAME_TOOL_NAME,
  YOLO_SPATIAL_ACTIONS,
} from "../shared/dnd-game-facade.mjs";

export const NARRATOR_YOLO_ACTIONS = new Set(YOLO_ENGINE_ACTIONS);
export const NARRATOR_YOLO_SPATIAL_ACTIONS = new Set(YOLO_SPATIAL_ACTIONS);

function yoloActionAllowed(name, spatialEnabled) {
  if (NARRATOR_YOLO_SPATIAL_ACTIONS.has(name)) {
    return spatialEnabled ? name !== "location_enable" : name === "location_enable";
  }
  return NARRATOR_YOLO_ACTIONS.has(name);
}

function compactOperation(action) {
  // The operation name is enough for routing. Parameter detail is fetched
  // lazily through narrator.catalog only when the referee needs it.
  return { name: action.name };
}

export function resolveNarratorPlayMode(adapter, { requested, env = process.env } = {}) {
  return resolveDndPlayMode({
    source: adapter?.runtimeSource === "custom-opencode" ? "custom-opencode" : "external",
    requested,
    env,
  });
}

export function filterNarratorCatalog(groups, mode, { spatialEnabled = false } = {}) {
  const operations = groups.flatMap(group =>
    (group.actions ?? group.entries ?? [])
      .filter(action => mode !== "yolo" || yoloActionAllowed(action.name, spatialEnabled))
      .map(compactOperation)
  );

  return [{
    actions: [{
      name: YOLO_GAME_TOOL_NAME,
      operations,
    }],
  }];
}

export function narratorModeGuidance(mode, { spatialEnabled = false } = {}) {
  const facade = [
    "The public engine surface is one action named game. Invoke it as action=game with args={action:<operation name>,args:<operation fields>}.",
    "The available engine operations are listed under game.operations. If a field is unclear, catalog that operation name, not game.",
    spatialEnabled
      ? "Location privacy is active. Keep room-scoped player input in its room: use location_narrate for room prose and the other offered location_* operations for movement, observation, perception, stealth and room state. Use location_disable only when the table is abandoning private-room play."
      : "Location privacy is off. location_enable is the only spatial operation offered; use it only when the table explicitly wants private-room play, not merely because characters separate in the fiction.",
  ];
  if (mode !== "yolo") return facade.join(" ");
  return [
    ...facade,
    "YOLO table mode is active.",
    "Prioritize fun, momentum, player agency and memorable consequences over exhaustive procedure.",
    "Do not roll for routine actions, harmless flavor, ordinary conversation, or outcomes whose failure would only waste time.",
    "Use one authoritative engine operation only when uncertainty and meaningful stakes justify it.",
    "Prefer fail-forward consequences to dead ends.",
    "Avoid bookkeeping operations unless persistent state truly changes.",
    "Keep narration compact and do not request a separate writer pass.",
  ].join(" ");
}
