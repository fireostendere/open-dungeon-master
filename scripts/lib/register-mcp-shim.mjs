// Module loader hook to resolve @modelcontextprotocol/* imports to mock-mcp-sdk.mjs
// when mcp/node_modules is not present.
import { register } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const mockSdkUrl = pathToFileURL(path.resolve(import.meta.dirname, "mock-mcp-sdk.mjs")).href;

export async function resolve(specifier, context, nextResolve) {
  if (
    specifier === "@modelcontextprotocol/server" ||
    specifier === "@modelcontextprotocol/server/stdio" ||
    specifier === "@modelcontextprotocol/node"
  ) {
    try {
      return await nextResolve(specifier, context);
    } catch {
      return {
        url: `${mockSdkUrl}?pkg=${encodeURIComponent(specifier)}`,
        shortCircuit: true,
      };
    }
  }
  return nextResolve(specifier, context);
}

register(import.meta.url);
