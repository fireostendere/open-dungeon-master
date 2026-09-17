import { isOocMessage } from "@/lib/campaign-types";

export type PlayerMessageKind = "say" | "do" | "ooc";

/** Display projection only: never rewrite the stored transcript or action payload. */
export function parsePlayerMessage(content: string): { kind: PlayerMessageKind; text: string } {
  const value = content.trim();
  if (isOocMessage({ content: value })) {
    return { kind: "ooc", text: value.replace(/^\s*\(ooc\)\s*/i, "") };
  }
  for (const [open, close] of [["\"", "\""], ["«", "»"], ["“", "”"]]) {
    if (value.length >= 2 && value.startsWith(open) && value.endsWith(close)) {
      return { kind: "say", text: value.slice(1, -1).trim() };
    }
  }
  for (const marker of ["**", "*"]) {
    if (value.length >= marker.length * 2 && value.startsWith(marker) && value.endsWith(marker)) {
      return { kind: "do", text: value.slice(marker.length, -marker.length).trim() };
    }
  }
  return { kind: "do", text: value };
}
