// The real odm_narrator MCP over stdio, backed by the lab database in-process.
// opencode spawns it, so the lab needs no listening socket.
console.log = console.error; // stdout carries MCP frames only
process.env.ODM_URL = 'http://odm-lab.local/api/internal/mcp';
const { campaignState } = await import('./odm-lab.mjs');
// Same shape as production: the table's bearer only ever sees odm_narrator for one campaign.
process.env.ODM_MCP_NARRATOR_ONLY = '1';
process.env.ODM_MCP_NARRATOR_CAMPAIGN_ID = campaignState().campaignId;
const { POST } = await import('../../src/app/api/internal/mcp/route.ts');
const nativeFetch = globalThis.fetch;
globalThis.fetch = (url, init) => String(url).startsWith('http://odm-lab.local/') ? POST(new Request(url, init)) : nativeFetch(url, init);
const { serveStdio, createVerifiedMcpServer } = await import('../../mcp/server.mjs');
await serveStdio(createVerifiedMcpServer);
