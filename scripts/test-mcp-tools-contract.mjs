// Verifies that the full MCP tools list (including odm_assets and odm_progress)
// is strictly registered after preload and cannot be dropped by future refactoring.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mcpNodeModules = path.join(root, "mcp", "node_modules");

function runSubprocess(code, { preload = true, env = {} } = {}) {
  const args = ["--import", "./scripts/lib/register-mcp-shim.mjs"];
  if (preload) {
    args.push("--import", "./mcp/external-tools-preload.mjs");
  }
  args.push("-e", code);

  const existingNodePath = process.env.NODE_PATH || "";
  const combinedNodePath = existingNodePath
    ? `${mcpNodeModules}${path.delimiter}${existingNodePath}`
    : mcpNodeModules;

  return spawnSync(process.execPath, args, {
    cwd: root,
    env: {
      ...process.env,
      NODE_PATH: combinedNodePath,
      ...env,
    },
    encoding: "utf8",
  });
}

// 1. Verify that all 12 tools are registered when preload is active
{
  const result = runSubprocess(`
    import {
      createVerifiedMcpServer,
      ALL_EXPECTED_MCP_TOOLS,
      BASE_MCP_TOOLS,
      PRELOAD_MCP_TOOLS,
      assertRegisteredTools,
      formatToolResult,
    } from "./mcp/server.mjs";
    import { z } from "zod";

    const server = createVerifiedMcpServer({ expectPreload: true });
    const registered = Object.keys(server._registeredTools || {}).sort();

    if (JSON.stringify(registered) !== JSON.stringify(ALL_EXPECTED_MCP_TOOLS)) {
      console.error("Mismatch: registered=" + JSON.stringify(registered) + " expected=" + JSON.stringify(ALL_EXPECTED_MCP_TOOLS));
      process.exit(1);
    }

    // Verify presence of critical tools
    for (const tool of PRELOAD_MCP_TOOLS) {
      if (!registered.includes(tool)) {
        console.error("Missing preload tool: " + tool);
        process.exit(2);
      }
    }

    // Verify operations schema on odm_assets
    const assetsTool = server._registeredTools["odm_assets"];
    if (!assetsTool) {
      console.error("odm_assets is not registered!");
      process.exit(3);
    }

    // Verify operations schema on odm_progress
    const progressTool = server._registeredTools["odm_progress"];
    if (!progressTool) {
      console.error("odm_progress is not registered!");
      process.exit(4);
    }

    // Verify odm_models is registered
    const modelsTool = server._registeredTools["odm_models"];
    if (!modelsTool) {
      console.error("odm_models is not registered!");
      process.exit(5);
    }

    const narratorTool = server._registeredTools["odm_narrator"];
    if (!narratorTool) {
      console.error("odm_narrator is not registered!");
      process.exit(6);
    }

    const campaignsTool = server._registeredTools["odm_campaigns"];
    const settingsTool = server._registeredTools["odm_campaign_settings"];
    const campaignJson = z.toJSONSchema(campaignsTool.config.inputSchema);
    const settingsJson = z.toJSONSchema(settingsTool.config.inputSchema);
    if (JSON.stringify(campaignJson.properties.gameSettings.properties.combatMode.enum) !== '["classical","jrpg"]' ||
      JSON.stringify(settingsJson.properties.patch.properties.unitSystem.enum) !== '["metric","imperial"]') {
      throw new Error("Campaign modes and units must be discoverable in tools/list schemas");
    }
    const validCampaign = campaignsTool.config.inputSchema.safeParse({
      operation: "create", gameSettings: { combatMode: "jrpg", futureSetting: true },
    });
    const validPatch = settingsTool.config.inputSchema.safeParse({
      operation: "game", campaignId: "11111111-1111-4111-8111-111111111111",
      patch: { combatMode: "classical", futureSetting: true },
    });
    if (!validCampaign.success || validCampaign.data.gameSettings.futureSetting !== true ||
      !validPatch.success || validPatch.data.patch.futureSetting !== true ||
      campaignsTool.config.inputSchema.safeParse({operation:"create",gameSettings:{combatMode:"freeform"}}).success ||
      settingsTool.config.inputSchema.safeParse({operation:"game",campaignId:"11111111-1111-4111-8111-111111111111",patch:{combatMode:"freeform"}}).success) {
      console.error("campaign combat mode MCP contract did not validate or preserve game settings");
      process.exit(8);
    }

    const validEpoch = "a".repeat(64);
    const narratorSchema = narratorTool.config.inputSchema;
    const parsedNarrator = narratorSchema.safeParse({
      operation: "read", campaignId: "11111111-1111-4111-8111-111111111111",
      commandId: "22222222-2222-4222-8222-222222222222", expectedVersion: 3,
      timelineEpoch: validEpoch, knownSections: { sheets: validEpoch },
      stateDelta: true, knownStateRevision: validEpoch,
    });
    const parsedAutopilot = narratorSchema.safeParse({
      operation: "autopilot_action",
      campaignId: "11111111-1111-4111-8111-111111111111",
      expectedSeq: 12,
      commandId: "22222222-2222-4222-8222-222222222222",
      timelineEpoch: validEpoch,
      characterId: "33333333-3333-4333-8333-333333333333",
      roundNumber: 4,
      kind: "do",
      content: "Hold the doorway.",
    });
    const parsedDelete = narratorSchema.safeParse({
      operation: "delete_message",
      campaignId: "11111111-1111-4111-8111-111111111111",
      expectedSeq: 12,
      commandId: "22222222-2222-4222-8222-222222222222",
      timelineEpoch: validEpoch,
      messageId: "44444444-4444-4444-8444-444444444444",
    });
    if (!parsedAutopilot.success || parsedAutopilot.data.characterId === undefined ||
        parsedAutopilot.data.roundNumber !== 4 || parsedAutopilot.data.kind !== "do") {
      console.error("odm_narrator autopilot_action schema is not discoverable");
      process.exit(11);
    }
    if (!parsedDelete.success || parsedDelete.data.messageId !== "44444444-4444-4444-8444-444444444444") {
      console.error("odm_narrator delete_message schema is not discoverable");
      process.exit(12);
    }

    if (!parsedNarrator.success || parsedNarrator.data.commandId === undefined ||
      parsedNarrator.data.expectedVersion !== 3 || parsedNarrator.data.timelineEpoch !== validEpoch ||
      parsedNarrator.data.stateDelta !== true || parsedNarrator.data.knownStateRevision !== validEpoch ||
      narratorSchema.safeParse({operation:"read", campaignId:"11111111-1111-4111-8111-111111111111", timelineEpoch:"bad"}).success ||
      narratorSchema.safeParse({operation:"read", campaignId:"11111111-1111-4111-8111-111111111111", knownSections:{sheets:"bad"}}).success ||
      narratorSchema.safeParse({operation:"read", campaignId:"11111111-1111-4111-8111-111111111111", stateDelta:true, knownStateRevision:"bad"}).success) {
      console.error("odm_narrator metadata schema did not preserve/reject contract fields");
      process.exit(7);
    }

    const wire = formatToolResult({ ok: true, nested: { value: 1 } });
    if (wire.structuredContent !== undefined || wire.content?.length !== 1 ||
        wire.content[0].text !== '{"ok":true,"nested":{"value":1}}') {
      console.error("default MCP result must be one compact text payload without structured duplication");
      process.exit(9);
    }
    const structured = formatToolResult({ ok: true }, { structured: true });
    if (!structured.structuredContent || structured.content?.length !== 1) {
      console.error("structured MCP result opt-in is broken");
      process.exit(10);
    }

    process.stdout.write(JSON.stringify({ ok: true, toolsCount: registered.length, registered }));
  `);

  assert.equal(
    result.status,
    0,
    `Preload test failed with status ${result.status}:\n${result.stderr || result.stdout}`
  );
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.toolsCount, 12);
  assert.ok(parsed.registered.includes("odm_assets"), "odm_assets must be registered");
  assert.ok(parsed.registered.includes("odm_progress"), "odm_progress must be registered");
  assert.ok(parsed.registered.includes("odm_models"), "odm_models must be registered");
  assert.ok(parsed.registered.includes("odm_narrator"), "odm_narrator must be registered");
  console.log("PASS mcp full tools contract with preload (12 tools verified)");
}

// 2. Verify that removing odm_assets or odm_progress throws contract violation
{
  const result = runSubprocess(`
    import { createVerifiedMcpServer, assertRegisteredTools } from "./mcp/server.mjs";

    const server = createVerifiedMcpServer({ expectPreload: true });

    // Simulate accidental deletion/omission of odm_assets
    delete server._registeredTools["odm_assets"];

    try {
      assertRegisteredTools(server, { expectPreload: true });
      console.error("Expected assertRegisteredTools to fail when odm_assets is missing!");
      process.exit(1);
    } catch (err) {
      if (!err.message.includes("odm_assets")) {
        console.error("Error message did not mention missing odm_assets: " + err.message);
        process.exit(2);
      }
    }

    // Simulate accidental deletion/omission of odm_progress
    delete server._registeredTools["odm_progress"];

    try {
      assertRegisteredTools(server, { expectPreload: true });
      console.error("Expected assertRegisteredTools to fail when odm_progress is missing!");
      process.exit(3);
    } catch (err) {
      if (!err.message.includes("odm_progress")) {
        console.error("Error message did not mention missing odm_progress: " + err.message);
        process.exit(4);
      }
    }

    process.stdout.write(JSON.stringify({ ok: true }));
  `);

  assert.equal(
    result.status,
    0,
    `Missing tool assertion test failed:\n${result.stderr || result.stdout}`
  );
  console.log("PASS contract violation triggers error if odm_assets or odm_progress dropped");
}

// 3. Verify server behavior without preload when ODM_MCP_REQUIRE_PRELOAD=0
{
  const result = runSubprocess(
    `
    import { createMcpServer, BASE_MCP_TOOLS, assertRegisteredTools } from "./mcp/server.mjs";

    const server = createMcpServer();
    const registered = Object.keys(server._registeredTools || {}).sort();

    // Verify all 10 base tools are registered
    assertRegisteredTools(server, { expectPreload: false });

    // Verify that expecting preload fails
    try {
      assertRegisteredTools(server, { expectPreload: true });
      process.exit(1);
    } catch (err) {
      if (!err.message.includes("odm_assets") || !err.message.includes("odm_progress")) {
        process.exit(2);
      }
    }

    process.stdout.write(JSON.stringify({ ok: true, baseCount: registered.length }));
  `,
    { preload: false, env: { ODM_MCP_REQUIRE_PRELOAD: "0" } }
  );

  assert.equal(
    result.status,
    0,
    `Without preload test failed:\n${result.stderr || result.stdout}`
  );
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.baseCount, 10);
  console.log("PASS base tools without preload correctly identified");
}

console.log("\nAll MCP tools contract tests passed.");
