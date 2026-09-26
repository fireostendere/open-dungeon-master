// Shared YOLO game-engine façade.
//
// The model sees one public action ("game"). The façade carries the selected
// engine operation and its ordinary argument object. Both the built-in DM and
// the external narrator unwrap it before they reach the existing adjudication
// handlers, so there is still exactly one authoritative rules implementation.
export const YOLO_GAME_TOOL_NAME = "game";

export const YOLO_ENGINE_ACTIONS = Object.freeze([
  "start_encounter",
  "add_enemies",
  "pc_attack",
  "combat_turn",
  "summon_pet",
  "pet_attack",
  "damage_pet",
  "dismiss_pet",
  "request_player_input",
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

// Spatial/location operations are available to the external narrator's YOLO
// façade only when the campaign state makes them relevant. They stay separate
// from YOLO_ENGINE_ACTIONS because the built-in server AI cannot own the human
// DM spatial seat.
export const YOLO_SPATIAL_ACTIONS = Object.freeze([
  "location_enable",
  "location_disable",
  "location_create_room",
  "location_link",
  "location_move",
  "location_narrate",
  "location_observe",
  "location_revoke",
  "location_propagate",
  "location_perceive",
  "location_stealth_resolve",
  "location_detect",
  "location_lose_detection",
  "location_set_floor",
]);

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

export function parseGameFacadeArgs(raw, allowedActions = YOLO_ENGINE_ACTIONS) {
  let outer = raw;
  if (typeof outer === "string") {
    try {
      outer = JSON.parse(outer || "{}");
    } catch {
      return { ok: false, error: "game expects a JSON object." };
    }
  }
  outer = objectValue(outer);
  if (!outer) return { ok: false, error: "game expects an object with action and args." };

  const action = typeof outer.action === "string" ? outer.action.trim() : "";
  if (!action) return { ok: false, error: "game.action is required." };

  const allowed = allowedActions instanceof Set ? allowedActions : new Set(allowedActions);
  if (!allowed.has(action)) {
    return { ok: false, error: `Engine action "${action}" is not available in this game mode.` };
  }

  let args = outer.args ?? outer.args_json ?? outer.argsJson ?? {};
  if (typeof args === "string") {
    try {
      args = JSON.parse(args || "{}");
    } catch {
      return { ok: false, error: `game.args for "${action}" must be a JSON object.` };
    }
  }
  args = objectValue(args);
  if (!args) return { ok: false, error: `game.args for "${action}" must be an object.` };

  return { ok: true, action, args };
}
