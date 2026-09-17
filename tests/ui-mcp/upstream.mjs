import { createRequire } from "node:module";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const require = createRequire(import.meta.url);

export function extractCurrentUrl(text) {
  const currentTab = text.split("\n").find((line) => /^\s*-\s*\d+:\s*\(current\)(?:\s|$)/.test(line)) || "";
  const urls = currentTab.match(/https?:\/\/[^\s)\]}]+/g) || [];
  if (!urls.length) throw new Error("Playwright did not report an active tab URL");
  return urls.at(-1);
}

export class PlaywrightUpstream {
  async start() {
    const cli = path.join(path.dirname(require.resolve("@playwright/mcp/package.json")), "cli.js");
    const args = [cli, "--headless", "--isolated", "--image-responses", "omit", "--snapshot-mode", "none"];
    const allowedOrigin = new URL(process.env.ODM_UI_TEST_BASE_URL || "http://127.0.0.1:3005").origin;
    args.push("--browser", process.env.ODM_UI_TEST_BROWSER || "chrome", "--allowed-origins", allowedOrigin);
    this.transport = new StdioClientTransport({ command: process.execPath, args, stderr: "ignore" });
    this.client = new Client({ name: "odm-ui-test-mcp", version: "0.1.0" });
    try {
      await this.client.connect(this.transport);
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  async call(name, args) { return this.client.callTool({ name, arguments: args }); }
  async currentUrl() { return extractCurrentUrl((await this.call("browser_tabs", { action: "list" })).content?.filter((item) => item.type === "text").map((item) => item.text).join("\n") || ""); }
  async close() {
    const client = this.client;
    const transport = this.transport;
    this.client = undefined;
    this.transport = undefined;
    try {
      await client?.close();
    } finally {
      await transport?.close().catch(() => undefined);
    }
  }
}
