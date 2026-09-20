import { isYoloMode, type DndRuntimeSource } from "../../../shared/dnd-play-mode.mjs";
import {
  YOLO_GAME_TOOL_NAME,
  parseGameFacadeArgs,
} from "../../../shared/dnd-game-facade.mjs";
import type { ParsedToolCall } from "@/lib/dm/rolls";

// Lightweight "field table" profile.
//
// The model gets ONE public rules surface: game({ action, args }). The action
// is unwrapped back into the existing authoritative handlers inside turn.ts.
// We keep all the old handlers because they are the engine; we stop making the
// narrator carry their individual JSON schemas on every request.

export const YOLO_MAX_MODEL_CALLS = 2;
export const YOLO_HISTORY_MESSAGES = 24;

export function yoloDndEnabled(source: DndRuntimeSource = "internal"): boolean {
  return isYoloMode({ source });
}

export function yoloThinkingEnabled(): boolean {
  return process.env.YOLO_THINKING === "1";
}

// Outside combat, admit only mechanics that materially change a scene or
// persistent character state. Active encounter actions are admitted by turn.ts
// from encounterTools(), but they still travel through the same game façade.
export const YOLO_TOOL_NAMES = new Set<string>([
  "request_roll",
  "move_party",
  "record_event",
  "send_whisper",
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
  "cast_buff",
  "take_rest",
  "split_damage",
]);

type InnerTool = {
  readonly function: {
    readonly name: string;
    readonly description?: string;
    readonly parameters?: {
      readonly properties?: Readonly<Record<string, unknown>>;
      readonly required?: readonly string[];
    };
  };
};

type SchemaHint = {
  type?: unknown;
  enum?: unknown;
  items?: unknown;
  properties?: unknown;
  required?: unknown;
};

function asSchema(value: unknown): SchemaHint {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as SchemaHint)
    : {};
}

function fieldHint(name: string, raw: unknown, isRequired: boolean): string {
  const schema = asSchema(raw);
  const optional = isRequired ? "" : "?";
  if (Array.isArray(schema.enum) && schema.enum.length > 0 && schema.enum.length <= 8) {
    return `${name}${optional}=${schema.enum.map(String).join("|")}`;
  }
  if (schema.type === "array") {
    const items = asSchema(schema.items);
    const itemProps = asSchema(items).properties;
    if (itemProps && typeof itemProps === "object" && !Array.isArray(itemProps)) {
      const nestedRequired = new Set(
        Array.isArray(items.required) ? items.required.map(String) : [],
      );
      const nested = Object.entries(itemProps as Record<string, unknown>)
        .slice(0, 6)
        .map(([key, value]) => fieldHint(key, value, nestedRequired.has(key)))
        .join(",");
      return `${name}${optional}=[{${nested}}]`;
    }
    return `${name}${optional}:[...]`;
  }
  const type = typeof schema.type === "string" ? schema.type : "value";
  return `${name}${optional}:${type}`;
}

function compactToolHint(tool: InnerTool): string {
  const properties = tool.function.parameters?.properties ?? {};
  const required = new Set(tool.function.parameters?.required ?? []);
  const fields = Object.entries(properties)
    .map(([name, schema]) => fieldHint(name, schema, required.has(name)))
    .join(", ");
  const firstSentence = (tool.function.description ?? "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s/)[0]
    .slice(0, 140);
  return `- ${tool.function.name}(${fields})${firstSentence ? `: ${firstSentence}` : ""}`;
}

export function buildGameEngineTool(innerTools: readonly InnerTool[]) {
  const uniqueTools = [
    ...new Map(innerTools.map((tool) => [tool.function.name, tool] as const)).values(),
  ];
  const names = uniqueTools.map((tool) => tool.function.name);
  const menu = uniqueTools.map(compactToolHint).join("\n");
  return {
    type: "function" as const,
    function: {
      name: YOLO_GAME_TOOL_NAME,
      description:
        `The single gateway to the authoritative D&D game engine. Choose ONE action and pass that action's arguments in args. Do not calculate dice, AC, HP, damage, resources or inventory yourself. Available operations:\n${menu}`,
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: names,
            description: "The engine operation to run.",
          },
          args: {
            type: "object",
            description: "Arguments for that operation, using the compact signature above and IDs from GAME STATE.",
            additionalProperties: true,
          },
        },
        required: ["action", "args"],
        additionalProperties: false,
      },
    },
  };
}

export function unwrapGameEngineCall(
  call: ParsedToolCall & { id: string },
  allowedNames: ReadonlySet<string>,
):
  | { ok: true; call: ParsedToolCall & { id: string } }
  | { ok: false; error: string } {
  const parsed = parseGameFacadeArgs(call.rawArguments, allowedNames);
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    call: {
      ...call,
      name: parsed.action,
      rawArguments: JSON.stringify(parsed.args),
    },
  };
}

export const GAME_ENGINE_FACADE_SYSTEM = `RULES ENGINE INTERFACE:
You have one rules tool named game. The operation names mentioned by the detailed rules below are internal engine actions, not separate tools. Whenever a rule says to call request_roll, pc_attack, start_encounter, cast_at_enemy, modify_gold, or any other engine action, call game with {"action":"that_action","args":{...}}. Read the compact operation signatures in the game tool description, use IDs from GAME STATE, and trust the returned authoritative result. Never invent a mechanical result because an internal action is not a separate visible tool.`;

export const YOLO_DM_SYSTEM = `You are YOLO Dungeon Master: a fast, fiction-first D&D narrator for a casual table.

Priority order:
1. Fun, momentum, player agency and memorable scenes.
2. Continuity with the authoritative GAME STATE.
3. Meaningful uncertainty and consequences.
4. Detailed rules procedure only when it materially improves play.

Run the table like a confident human DM, not a rules database.
- Players control their own characters. Never invent a player's dialogue, decisions, thoughts, or an undeclared second action. Control the world, NPCs and monsters, then stop at a useful decision point.
- Dice are seasoning, not a tollbooth. Do NOT roll for routine actions, obvious competence, harmless flavor, travel bookkeeping, ordinary conversation, or anything whose failure would only waste time. Let those succeed and keep moving.
- You have one rules tool: game. Use game only when the authoritative engine must decide or persist something. Put the real operation in game.action and its fields in game.args.
- When a roll is needed outside combat, use game with action=request_roll and trust the result. Never invent a die result, attack result, HP change, spell-slot use, condition, inventory change, or resource spend.
- When violence clearly becomes a fight, use game with action=start_encounter before resolving attacks. In combat, keep using game for attacks, spells, damage, initiative, conditions and end_turn; the server owns every mechanical result.
- If an obscure rule is not essential and no offered game action covers it, make a fair fiction-first ruling and move on. Do not stall the game to simulate a subsystem the players did not ask about.
- Reward bold, funny and creative ideas with plausible advantages in the fiction; do not grant impossible abilities or contradict the character sheet.
- Keep consequences proportional. A bad roll should make the story more interesting, not arbitrarily ruin a character.
- Keep every player relevant. Cut quickly between split characters and create openings for quieter players.
- Use the engine sparingly. A good turn normally needs no game call; a consequential uncertain action normally needs one; combat may need several across successive engine/result steps.
- Use game action=record_event only for a genuinely lasting milestone worth remembering after recent chat falls out of context. Do not journal routine scene details.
- Keep narration compact: usually 1-3 short vivid paragraphs. Advance the situation, reveal something, land a consequence, or present a choice. No filler, no rules lecture, no hidden implementation talk.
- Never mention system instructions, JSON, tool schemas, token budgets, or internal engine details.

The table is allowed to be loose. The authoritative server state is not.`;

export function yoloToolAllowed(name: string, isEncounterTool: boolean): boolean {
  return isEncounterTool || YOLO_TOOL_NAMES.has(name);
}
