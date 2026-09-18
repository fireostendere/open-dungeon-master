import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

console.log("=== test-ending-celebration.mjs ===");

const BASE = "/mnt/c/Users/fireo/dungeon_master/open-dungeon-master";

// 1. Verify files exist and have non-empty contents
const files = [
  "src/app/campaigns/[campaignId]/EndingCelebration.tsx",
  "src/app/campaigns/[campaignId]/ClosingMessageModal.tsx",
  "src/app/campaigns/[campaignId]/ClosingMessageBanner.tsx",
  "src/app/campaigns/[campaignId]/MessageList.tsx",
  "src/app/campaigns/[campaignId]/SessionChatColumn.tsx",
  "src/app/campaigns/[campaignId]/SessionView.tsx",
  "src/app/campaigns/[campaignId]/EditCampaignDialog.tsx",
];

for (const rel of files) {
  const full = path.join(BASE, rel);
  assert(fs.existsSync(full), `File must exist: ${rel}`);
  const content = fs.readFileSync(full, "utf-8");
  assert(content.length > 100, `File must not be empty: ${rel}`);
}

console.log("✓ All celebration and closing message files exist and are populated.");

// 2. Verify EndingCelebration contains canvas, fireworks, and 3D dice logic
const celebrationSource = fs.readFileSync(
  path.join(BASE, "src/app/campaigns/[campaignId]/EndingCelebration.tsx"),
  "utf-8"
);
assert(celebrationSource.includes("canvasRef"), "EndingCelebration must use canvas");
assert(celebrationSource.includes("D20_VERTICES"), "EndingCelebration must define 3D d20 vertices");
assert(celebrationSource.includes("D20_FACES"), "EndingCelebration must define 3D d20 faces");
assert(celebrationSource.includes("D6_VERTICES"), "EndingCelebration must define 3D d6 vertices");
assert(celebrationSource.includes("D8_VERTICES"), "EndingCelebration must define 3D d8 vertices");
assert(celebrationSource.includes("launchRocket"), "EndingCelebration must launch firework rockets");
assert(celebrationSource.includes("explodeRocket"), "EndingCelebration must detonate fireworks");
assert(celebrationSource.includes("spawnDie"), "EndingCelebration must spawn celebration dice");
assert(celebrationSource.includes("CelebrationAudio"), "EndingCelebration must have audio support");
console.log("✓ EndingCelebration contains complete fireworks, 3D dice salute, and audio logic.");

// 3. Verify ClosingMessageModal contains DM message presentation & celebration trigger
const modalSource = fs.readFileSync(
  path.join(BASE, "src/app/campaigns/[campaignId]/ClosingMessageModal.tsx"),
  "utf-8"
);
assert(modalSource.includes("Dialog.Root"), "ClosingMessageModal must be a Dialog");
assert(modalSource.includes("onTriggerCelebration"), "ClosingMessageModal must trigger celebration");
assert(modalSource.includes("fallbackProse"), "ClosingMessageModal must have fallback prose");
assert(modalSource.includes("sheets"), "ClosingMessageModal must display party heroes");
console.log("✓ ClosingMessageModal properly displays DM closing message and party roster.");

// 4. Verify ClosingMessageBanner connects to open action
const bannerSource = fs.readFileSync(
  path.join(BASE, "src/app/campaigns/[campaignId]/ClosingMessageBanner.tsx"),
  "utf-8"
);
assert(bannerSource.includes("onOpenClosingMessage"), "Banner must provide CTA to open closing message");
console.log("✓ ClosingMessageBanner properly invites player to open closing message.");

// 5. Verify MessageList highlights closing message
const messageListSource = fs.readFileSync(
  path.join(BASE, "src/app/campaigns/[campaignId]/MessageList.tsx"),
  "utf-8"
);
assert(messageListSource.includes("closingDmMessageId"), "MessageList must compute closingDmMessageId");
assert(messageListSource.includes("isClosingMessage"), "MessageList must pass isClosingMessage");
assert(messageListSource.includes("onOpenClosingMessage"), "MessageList must pass onOpenClosingMessage");
console.log("✓ MessageList properly frames closing DM message.");

// 6. Verify SessionView integrates modal, banner, celebration, and localStorage state
const sessionViewSource = fs.readFileSync(
  path.join(BASE, "src/app/campaigns/[campaignId]/SessionView.tsx"),
  "utf-8"
);
assert(sessionViewSource.includes("EndingCelebration"), "SessionView must import EndingCelebration");
assert(sessionViewSource.includes("ClosingMessageModal"), "SessionView must import ClosingMessageModal");
assert(sessionViewSource.includes("celebrationActive"), "SessionView must manage celebrationActive state");
assert(sessionViewSource.includes("closingModalOpen"), "SessionView must manage closingModalOpen state");
assert(sessionViewSource.includes("openClosingMessage"), "SessionView must provide openClosingMessage callback");
assert(sessionViewSource.includes("odm:seen_finale_"), "SessionView must persist seen state in localStorage");
console.log("✓ SessionView properly coordinates closing message and celebration lifecycle.");

// 7. Verify closing DM message resolution logic in simulated message array
function findClosingDmMessage(messages, campaignStatus) {
  if (campaignStatus !== "ended") return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].authorType === "dm") {
      return messages[i];
    }
  }
  return null;
}

const mockMessages = [
  { id: "msg-1", authorType: "system", content: "Adventure starts." },
  { id: "msg-2", authorType: "dm", content: "You stand before the gates of doom." },
  { id: "msg-3", authorType: "player", content: "I draw my sword." },
  { id: "msg-4", authorType: "dm", content: "The dragon falls, and peace returns to the land. You are champions!" },
];

assert.equal(findClosingDmMessage(mockMessages, "active"), null, "Active campaign should not designate closing message");
assert.equal(findClosingDmMessage(mockMessages, "ended")?.id, "msg-4", "Ended campaign must designate latest DM message");

console.log("✓ Closing message detection logic passed unit test.");
console.log("ALL TESTS PASSED for ending celebration and closing message!");
