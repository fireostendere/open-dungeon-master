import { resolveDndPlayMode } from "../src/lib/dm/play-mode.mjs";

export const NARRATOR_YOLO_ACTIONS = new Set([
  "start_encounter",
  "add_enemies",
  "pc_attack",
  "enemy_attack",
  "damage_enemy",
  "cast_at_enemy",
  "cast_at_player",
  "cast_buff",
  "aoe_damage",
  "split_damage",
  "set_enemy_condition",
  "clear_enemy_condition",
  "enemy_flees",
  "take_action",
  "use_reaction",
  "end_turn",
  "end_encounter",
  "move_token",
  "apply_damage",
  "heal",
  "stabilize",
  "modify_gold",
  "grant_item",
  "remove_item",
  "use_item",
  "purchase",
  "use_resource",
  "set_condition",
  "clear_condition",
  "use_spell_slot",
  "take_rest",
  "move_party",
  "request_roll",
  "send_whisper",
  "record_event",
]);

export function resolveNarratorPlayMode(adapter, { requested, env = process.env } = {}) {
  return resolveDndPlayMode({
    source: adapter?.runtimeSource === "custom-opencode" ? "custom-opencode" : "external",
    requested,
    env,
  });
}

export function filterNarratorCatalog(groups, mode) {
  if (mode !== "yolo") return groups;
  return groups
    .map(group => ({
      ...group,
      actions: (group.actions ?? []).filter(action => NARRATOR_YOLO_ACTIONS.has(action.name)),
    }))
    .filter(group => group.actions.length);
}

export function narratorModeGuidance(mode) {
  if (mode !== "yolo") return "";
  return [
    "YOLO table mode is active.",
    "Prioritize fun, momentum, player agency and memorable consequences over exhaustive procedure.",
    "Do not roll for routine actions, harmless flavor, ordinary conversation, or outcomes whose failure would only waste time.",
    "Use one authoritative engine action only when uncertainty and meaningful stakes justify it.",
    "Prefer fail-forward consequences to dead ends.",
    "Avoid bookkeeping tools unless persistent state truly changes.",
    "Keep narration compact and do not request a separate writer pass.",
  ].join(" ");
}
