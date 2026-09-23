import type { CampaignKind } from "@/lib/workshop/kind";

export type SessionUser = {
  id: string;
  username: string;
  avatar?: { url: string } | null;
  isAdmin?: boolean;
  mustChangePassword?: boolean;
  // Set while the account is scheduled for deletion; the header banner
  // offers to keep it until then.
  deletionDueAt?: string | null;
};

export type CampaignStatus = "lobby" | "active" | "ended";

export const CAMPAIGN_DIFFICULTIES = ["easy", "normal", "hard", "deadly"] as const;
export type CampaignDifficulty = (typeof CAMPAIGN_DIFFICULTIES)[number];

// A bare "normal" in a dropdown says nothing about what changes. Difficulty
// is not a damage multiplier: it rides into the DM's own briefing
// (src/lib/dm/setup.ts) and steers how hard it builds encounters and how
// often it lets a bad roll actually hurt. Every rule underneath stays 5e.
export const CAMPAIGN_DIFFICULTY_HINTS: Record<CampaignDifficulty, string> = {
  easy: "Fights lean easy and the story forgives mistakes. Good for a first table.",
  normal: "Encounters built to the book. A careless party can still lose someone.",
  hard: "Bigger fights, fewer second chances, resources that actually run out.",
  deadly: "Assumes you want to lose characters. Plan retreats and bring spares.",
};

export type CampaignSummary = {
  id: string;
  title: string;
  description: string;
  // 'campaign' plays; 'workshop' is a DM's prep space that reuses the same
  // row and the same content tables but never runs a turn. The rules live in
  // src/lib/workshop/kind.ts.
  kind: CampaignKind;
  status: CampaignStatus;
  inviteCode: string;
  maxPlayers: number;
  startingLevel: number;
  difficulty: CampaignDifficulty;
  theme: string;
  ownerUserId: string;
  // The player who steers the story and fixes stats when the AI DM errs.
  // Defaults to the owner; transferable.
  leadUserId: string;
  // Human-DM mode: the member running the game, and an optional co-DM.
  // Null on both means the AI runs it. What each seat may see and do is
  // decided in src/lib/dm/viewer.ts, never by comparing ids at a call site.
  dmUserId: string | null;
  assistantDmUserId: string | null;
  playerCount: number;
  role: "owner" | "player";
  // Cover art for the campaign tile and hero: an uploaded or painted image
  // under /uploads/, or null for the themed placeholder
  // (src/components/CampaignCover.tsx). On the summary rather than the full
  // campaign because the home screen and the shells list it without opening
  // the table.
  cover: CampaignCover | null;
  // The setting this table plays in, denormalized off gameSettings for the
  // same reason cover is here: a campaign with no painted cover draws the
  // plate for its genre, and the home screen picks that without opening the
  // table. Read through src/lib/placeholders.ts, never compared by hand.
  genre: string;
  createdAt: string;
  updatedAt: string;
};

export type CampaignCover = { id: string; url: string };

// What a player is doing when they hit send. Shared by the composer and the
// routes on purpose: this used to live in Composer.tsx while the actions
// route re-declared its own narrower enum, so the two could drift, and a
// mode the server did not recognise fell through to "do" silently.
//
// "lead" is labelled "Direct" and posts to /lead-note; do/say/ooc post to /actions.
// "ask" posts to the separate Ask queue and never becomes a story action.
// "narrate" is the DM seat's only authoring mode and posts to /dm/narrate.
export const INPUT_KINDS = ["do", "say", "ooc", "ask", "lead", "narrate"] as const;
export type InputKind = (typeof INPUT_KINDS)[number];

// The modes that do not consume the floor: table talk, Ask and lead directions
// work during a hold, a spotlight, another player's initiative turn, and
// while the DM is narrating.
// The DM is never subject to the floor they control, so "narrate" joins the
// exempt set alongside table talk and lead directions.
export const FLOOR_EXEMPT_KINDS: readonly InputKind[] = ["ooc", "ask", "lead", "narrate"];

export function isFloorExempt(kind: InputKind): boolean {
  return FLOOR_EXEMPT_KINDS.includes(kind);
}

// Marks table talk messages that should not be visible to external AI narrators
// or trigger DM narration.
export const OOC_MESSAGE_PREFIX = "(ooc) ";

export function isOocMessage(message: { content?: string } | null | undefined): boolean {
  return typeof message?.content === "string" && /^\s*\(ooc\)/i.test(message.content);
}

// Marks system messages the party lead injected to steer the story; the DM
// prompt reframes them as authoritative table direction and the client
// styles them as a lead note.
export const LEAD_NOTE_PREFIX = "[Party lead direction] ";

// Marks the system message a halted DM turn writes. The client pairs it with
// the message's dmTurnId to offer the lead a retry of that exact turn.
export const DM_HALTED_PREFIX = "The DM ran into a problem: ";

// Marks the system message announcing a mid-game joiner's new character.
// The lead's "new adventurer" banner derives from it: shown until a DM
// message lands after it (the DM had its "next natural moment").
export const JOIN_NOTE_PREFIX = "[New adventurer] ";

// The latest join announcement the DM has not yet narrated past, if any.
// Pure so tests can drive it; seq comparison decides "answered".
export function latestUnintroducedJoin<
  T extends { authorType: string; content: string; seq: number },
>(messages: T[]): T | null {
  let joinNotice: T | null = null;
  for (const message of messages) {
    if (message.authorType === "system" && message.content.startsWith(JOIN_NOTE_PREFIX)) {
      joinNotice = message;
    }
  }
  if (!joinNotice) {
    return null;
  }
  const notice = joinNotice;
  return messages.some((message) => message.authorType === "dm" && message.seq > notice.seq)
    ? null
    : notice;
}

export type GlobalTurnActionUsage = {
  actionsCount: number; // 0 or 1
  phrasesCount: number; // 0 or 1
  lastActionKind?: "do" | "say";
  updatedAt: string;
};

export type GlobalTurnState = {
  roundNumber: number;
  // "waiting" is a hard gate: the round has not received its start trigger
  // yet, so player actions are not accepted or collected.
  // "active"/"quorum_delay" are the only collection phases.
  // "ready"/"resolving" are sealed and stay locked until MCP narration commits.
  phase: "waiting" | "active" | "quorum_delay" | "ready" | "resolving";
  startedAt: string | null;
  firstActionAt: string | null;
  deadlineAt: string | null;
  quorumReachedAt: string | null;
  actionsByCharacter: Record<string, GlobalTurnActionUsage>;
};

export type CampaignMember = {
  userId: string;
  username: string;
  avatar?: { url: string } | null;
  role: "owner" | "player";
  ready: boolean;
  useRealDice: boolean;
  // Muted by the party lead: reads along, cannot act, ask or side-chat.
  muted: boolean;
  // How many consecutive turns this player chooses to skip (0..99).
  skipTurnsCount: number;
  // External narrator actor may submit this player's global-turn intent.
  // This is only an opt-in state flag; the server never runs a model for it.
  autopilot: boolean;
  joinedAt: string;
};
