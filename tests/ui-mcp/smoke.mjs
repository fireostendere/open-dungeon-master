import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const fixture = createServer((_, response) => {
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end('<button aria-label="Save" onclick="document.querySelector(\'[role=status]\').hidden=false">Save</button><p role="status" aria-label="Saved" hidden>Saved</p>');
});
await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${fixture.address().port}`;
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["server.mjs"],
  env: { ...process.env, ODM_UI_TEST_BASE_URL: baseUrl },
  stderr: "inherit",
});
const client = new Client({ name: "odm-ui-test-mcp-smoke", version: "0.1.0" });

function assertToolOk(result) {
  assert.notEqual(result.isError, true, result.content?.map((item) => item.text).filter(Boolean).join("\n"));
  return result;
}

try {
  await client.connect(transport);
  assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name), ["ui_open", "ui_find", "ui_action", "ui_assert"]);
  assertToolOk(await client.callTool({ name: "ui_open", arguments: { path: "/" } }));
  const found = assertToolOk(await client.callTool({ name: "ui_find", arguments: { role: "button", name: "Save" } }));
  assert.equal(found.structuredContent.count, 1);
  assert.equal(assertToolOk(await client.callTool({ name: "ui_action", arguments: { handle: found.structuredContent.matches[0].handle, action: "click" } })).structuredContent.ok, true);
  assert.equal(assertToolOk(await client.callTool({ name: "ui_assert", arguments: { target: { role: "status", name: "Saved" }, condition: "visible" } })).structuredContent.ok, true);
  console.log("UI MCP smoke passed");
} finally {
  await client.close();
  await new Promise((resolve) => fixture.close(resolve));
}
