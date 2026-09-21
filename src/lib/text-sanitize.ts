// Shared cleanup for model text that may contain leaked reasoning/template markers.
// Kept independent of any hosted model runtime: external narrators and deterministic
// parsers can use it without restoring the removed server-AI stack.

const THINK_BLOCK = /<(think|thinking|thought|reasoning)>[\s\S]*?<\/\1>/gi;
const THINK_TAG = /<\/?(?:think|thinking|thought|reasoning)>/gi;
const THINK_CLOSER = /<\/(?:think|thinking|thought|reasoning)>/gi;
const FINAL_CHANNEL = /<\|?channel\|?>\s*final\s*(?:<\|?message\|?>)?/gi;
const THOUGHT_CHANNEL_BLOCK =
  /<\|?channel\|?>\s*(?:analysis|commentary|thought|thinking)\b[\s\S]*?(?=<\|?channel\|?>|<\|start\|>|$)/gi;
const BARE_MARKER = /<\|?(?:start|end|message|channel|return|im_start|im_end)\|?>/gi;
const GLUED_FINAL = /assistantfinal[:\s]*/gi;

function lastMatchEnd(text: string, pattern: RegExp): number {
  pattern.lastIndex = 0;
  let end = -1;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    end = match.index + match[0].length;
  }
  return end;
}

export function stripReasoningArtifacts(raw: string): string {
  let text = raw.replace(THINK_BLOCK, "");

  const afterCloser = lastMatchEnd(text, THINK_CLOSER);
  if (afterCloser >= 0) text = text.slice(afterCloser);

  const afterFinal = lastMatchEnd(text, FINAL_CHANNEL);
  if (afterFinal >= 0) text = text.slice(afterFinal);

  const afterGluedFinal = lastMatchEnd(text, GLUED_FINAL);
  if (afterGluedFinal >= 0) text = text.slice(afterGluedFinal);

  text = text
    .replace(THOUGHT_CHANNEL_BLOCK, "")
    .replace(BARE_MARKER, "")
    .replace(THINK_TAG, "");

  const cleaned = text.trim();
  if (cleaned) return cleaned;

  return raw
    .replace(BARE_MARKER, " ")
    .replace(THINK_TAG, " ")
    .replace(/\s{3,}/g, "\n\n")
    .trim();
}
