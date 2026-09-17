import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { UiController, registerTools } from "./index.mjs";
import { PlaywrightUpstream } from "./upstream.mjs";

const upstream = new PlaywrightUpstream();
let handle;
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  const results = await Promise.allSettled([handle?.close(), upstream.close()].filter(Boolean));
  for (const result of results) {
    if (result.status === "rejected") console.error("UI test MCP cleanup failed:", result.reason instanceof Error ? result.reason.message : String(result.reason));
  }
}

process.stdin.once("end", () => void close());
process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());

try {
  await upstream.start();
  if (!closing) {
    handle = serveStdio(() => {
      const server = new McpServer({ name: "odm-ui-test-mcp", version: "0.1.0" }, { capabilities: { tools: {} } });
      registerTools(server, new UiController(upstream));
      return server;
    }, {
      onerror: (error) => console.error("UI test MCP error:", error.message),
    });
  }
} catch (error) {
  await close();
  throw error;
}
