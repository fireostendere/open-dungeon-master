import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const campaign = '11111111-1111-4111-8111-111111111111';
const token = 'n'.repeat(64);

test('narrator-only sidecar registers no admin tools', () => {
  const script = 'const {createVerifiedMcpServer}=await import("./mcp/server.mjs"); console.log(JSON.stringify(Object.keys(createVerifiedMcpServer()._registeredTools||{}).sort()))';
  const output = execFileSync(process.execPath, [
    '--import', './mcp/external-tools-preload.mjs', '--input-type=module', '-e', script,
  ], {
    cwd: root,
    env: {
      ...process.env,
      ODM_MCP_NARRATOR_ONLY: '1',
      ODM_MCP_TOKEN: 'operator-secret',
      ODM_MCP_UPSTREAM_TOKEN: 'operator-secret',
      ODM_MCP_NARRATOR_TOKEN: token,
      ODM_MCP_NARRATOR_CAMPAIGN_ID: campaign,
    },
  }).toString().trim();
  assert.equal(output, '["odm_narrator"]');
});
