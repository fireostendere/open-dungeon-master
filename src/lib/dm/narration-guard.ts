// Player-visible text from the external narrator is shown verbatim. The model
// also talks to its operator in its own session, and more than once it put
// that side of the conversation into the campaign: seq numbers, tool names,
// "(ooc) the turn stays on hold", "the engine did not apply it", even a
// scene titled after the operator's debug question. This check runs before a
// narrator write is admitted, so a leak is refused with nothing written and
// the model rewrites the text as prose. Deliberately high-precision: it knows
// the protocol's own vocabulary, not English or Russian in general, and it
// leaves the confirmed mechanics lines the DM style uses alone
// ("*(Атака: **23** против КД 11 — ПОПАДАНИЕ!)*", "**[Медицина: 21]**").

type Rule = { label: string; pattern: RegExp };

const RULES: Rule[] = [
  // Cursor and receipt fields of the narrator protocol.
  { label: "protocol field", pattern: /\b(?:expected|current|after|next|known|committed|latest)Seq\b|\b(?:commandId|timelineEpoch|readAfter|releaseFloor|passTurn|completeTurn|turnCompletion|hasMore|pageCursor|nextCursor|expectedVersion|stateDelta|turnLock|receiptId)\b/ },
  { label: "sequence number", pattern: /\bseq\s*[:=#№]?\s*\d+/i },
  { label: "internal id field", pattern: /\b(?:campaign|character|enemy|targetEnemy|message|ask|turn|roll|pendingRoll|encounter|user|room)Id\b/ },
  // snake_case identifiers are tool and operation names (request_roll,
  // end_turn, odm_narrator, release_floor...), never story words.
  { label: "tool name", pattern: /(?<![\p{L}\p{N}_])[a-z][a-z0-9]*(?:_[a-z0-9]+)+(?![\p{L}\p{N}_])/u },
  { label: "tool name", pattern: /\bnarrator\.[a-z_]+\b|\binvoke\s*\(/ },
  { label: "JSON or code", pattern: /```|\{\s*"[A-Za-z_]+"\s*:/ },
  { label: "raw id", pattern: /(?<!\[roll:)\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i },
  { label: "debug tag", pattern: /\[(?:debug|dev|trace|internal|meta|operator|оператор|отладка|dbg)\]|^\s*(?:DEBUG|TODO|FIXME)\b/im },
  { label: "OOC status note", pattern: /^\s*\(ooc\)/i },
  // What the table must never hear about the machinery.
  { label: "engine talk", pattern: /(?<![\p{L}])(?:MCP|ODM|JSON|API)(?![\p{L}])|квитанц|сервер\s+(?:обработал|принял|вернул|отклонил|не\s+принял)|движ(?:ок|ка|ку|ком|ке)\s+(?:не\s+)?(?:применил|обработал|принял|вернул|отклонил|разрешил|позволяет|посчитал|засчитал)|\bthe\s+engine\s+(?:rejected|refused|returned|applied|resolved|processed|did\s+not)/iu },
  { label: "turn bookkeeping", pattern: /(?<![\p{L}])ход\s+(?:\p{L}+\s+)?(?:передан|принят|завершён|завершен|не\s+продвинут|продвинут)(?![\p{L}])|на\s+удержании|(?<![\p{L}])turn\s+(?:passed|handed\s+off|advanced|is\s+(?:held|on\s+hold))(?![\p{L}])/iu },
];

/** Labels of every kind of technical/meta content found in the text. */
export function technicalLeaks(text: string, tableTalk = false): string[] {
  const found = new Set<string>();
  for (const rule of RULES) {
    if (tableTalk && (rule.label === "OOC status note" || rule.label === "turn bookkeeping")) continue;
    if (rule.pattern.test(text)) found.add(rule.label);
  }
  return [...found];
}

export class NarrationGuardError extends Error {
  readonly labels: string[];
  constructor(field: string, labels: string[]) {
    super(`Player-visible ${field} refused before anything was written (the campaign seq is unchanged): it contains technical or meta content [${labels.join(", ")}]. Use in-world prose for narration, or plain player-facing explanations through send_whisper/send_ooc. Raw technical details belong only in your operator reply. Then resend with the same expectedSeq.`);
    this.labels = labels;
  }
}

export function assertPlayerFacingText(text: unknown, field: string, tableTalk = false): void {
  if (typeof text !== "string" || !text) return;
  const labels = technicalLeaks(text, tableTalk);
  if (labels.length) throw new NarrationGuardError(field, labels);
}

// Engine actions whose text reaches players, and which of their fields.
const PLAYER_FACING_ARGS: Record<string, string[]> = {
  send_whisper: ["message"],
  send_ooc: ["message"],
  request_player_input: ["prompt"],
  request_roll: ["reason"],
  location_narrate: ["content"],
  location_propagate: ["content"],
  location_perceive: ["content"],
  location_stealth_resolve: ["perceivedText"],
};

export function assertPlayerFacingArgs(action: string, args: Record<string, unknown>): void {
  for (const field of PLAYER_FACING_ARGS[action] ?? []) assertPlayerFacingText(args[field], `${action}.${field}`, action === "send_whisper" || action === "send_ooc");
}
