import { resolveDndPlayMode } from "../shared/dnd-play-mode.mjs";
import {
  YOLO_ENGINE_ACTIONS,
  YOLO_GAME_TOOL_NAME,
} from "../shared/dnd-game-facade.mjs";

export const NARRATOR_YOLO_ACTIONS = new Set(YOLO_ENGINE_ACTIONS);

function compactOperation(action) {
  const fields = (action.fields ?? []).map(field => ({
    name: field.name,
    ...(field.required ? { required: true } : {}),
    ...(field.kind ? { kind: field.kind } : {}),
  }));
  return {
    name: action.name,
    ...(action.label ? { label: action.label } : {}),
    ...(action.summary ? { summary: action.summary } : {}),
    ...(fields.length ? { fields } : {}),
  };
}

export function resolveNarratorPlayMode(adapter, { requested, env = process.env } = {}) {
  return resolveDndPlayMode({
    source: adapter?.runtimeSource === "custom-opencode" ? "custom-opencode" : "external",
    requested,
    env,
  });
}

export function filterNarratorCatalog(groups, mode) {
  const operations = groups.flatMap(group =>
    (group.actions ?? group.entries ?? [])
      .filter(action => mode !== "yolo" || NARRATOR_YOLO_ACTIONS.has(action.name))
      .map(compactOperation)
  );

  return [{
    category: "engine",
    label: "Game engine",
    actions: [{
      name: YOLO_GAME_TOOL_NAME,
      label: "Game",
      summary: "Single façade over authoritative dice, combat, world and persistent state. Choose one operation from operations and pass {action, args}.",
      operations,
    }],
  }];
}

export function narratorModeGuidance(mode) {
  const facade = [
    "The public engine surface is one action named game. Invoke it as action=game with args={action:<operation name>,args:<operation fields>}.",
    "The available engine operations are listed under game.operations. If a field is unclear, catalog that operation name, not game.",
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
