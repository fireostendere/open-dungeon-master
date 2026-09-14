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

// 1. Verify that all 10 tools are registered when preload is active
{
  const result = runSubprocess(`
    import {
      createVerifiedMcpServer,
      ALL_EXPECTED_MCP_TOOLS,
      BASE_MCP_TOOLS,
      PRELOAD_MCP_TOOLS,
      assertRegisteredTools,
    } from "./mcp/server.mjs";

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

    process.stdout.write(JSON.stringify({ ok: true, toolsCount: registered.length, registered }));
  `);

  assert.equal(
    result.status,
    0,
    `Preload test failed with status ${result.status}:\n${result.stderr || result.stdout}`
  );
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.toolsCount, 10);
  assert.ok(parsed.registered.includes("odm_assets"), "odm_assets must be registered");
  assert.ok(parsed.registered.includes("odm_progress"), "odm_progress must be registered");
  console.log("PASS mcp full tools contract with preload (10 tools verified)");
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

    // Verify all 8 base tools are registered
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
  assert.equal(parsed.baseCount, 8);
  console.log("PASS base tools without preload correctly identified");
}

console.log("\nAll MCP tools contract tests passed.");
