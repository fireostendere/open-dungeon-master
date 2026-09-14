// Lightweight mock for @modelcontextprotocol/server and @modelcontextprotocol/node
// Used when verifying MCP tool contracts in environments where mcp/node_modules is not installed.

export class McpServer {
  constructor(info = {}) {
    this.serverInfo = info;
    this._registeredTools = {};
    this._registeredResources = {};
    this._registeredPrompts = {};
  }

  registerTool(name, config, handler) {
    this._registeredTools[name] = { name, config, handler };
    return this;
  }

  registerResource(name, uri, metadata, readHandler) {
    this._registeredResources[name] = { name, uri, metadata, readHandler };
    return this;
  }

  registerPrompt(name, config, handler) {
    this._registeredPrompts[name] = { name, config, handler };
    return this;
  }
}

export function createMcpHandler() {
  return () => {};
}

export async function serveStdio() {
  return {};
}

export function toNodeHandler() {
  return (...args) => {
    const res = args[1];
    if (res?.writeHead) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
    }
  };
}
