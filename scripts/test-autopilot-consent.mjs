import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
register("./lib/register-alias.mjs", import.meta.url);
const { mayChangeAutopilot } = await import("../src/lib/autopilot-policy.ts");

test("only the player may enable MCP autopilot for their character", () => {
  assert.equal(mayChangeAutopilot({ actorUserId: "p", targetUserId: "p", enable: true, isLead: false, isDm: false }), true);
  assert.equal(mayChangeAutopilot({ actorUserId: "lead", targetUserId: "p", enable: true, isLead: true, isDm: false }), false);
  assert.equal(mayChangeAutopilot({ actorUserId: "dm", targetUserId: "p", enable: true, isLead: false, isDm: true }), false);
});

test("player, lead or DM may disable an enabled autopilot", () => {
  assert.equal(mayChangeAutopilot({ actorUserId: "p", targetUserId: "p", enable: false, isLead: false, isDm: false }), true);
  assert.equal(mayChangeAutopilot({ actorUserId: "lead", targetUserId: "p", enable: false, isLead: true, isDm: false }), true);
  assert.equal(mayChangeAutopilot({ actorUserId: "dm", targetUserId: "p", enable: false, isLead: false, isDm: true }), true);
  assert.equal(mayChangeAutopilot({ actorUserId: "x", targetUserId: "p", enable: false, isLead: false, isDm: false }), false);
});
