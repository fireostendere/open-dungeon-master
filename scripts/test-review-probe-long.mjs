// Real HTTP acceptance: one provider stage takes 45 seconds. This is not a
// production database or an SDK JSON-RPC end-to-end test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { createSafeHttpListener } from '../mcp/http-boundary.mjs';
import { createControlClient } from '../mcp/control-client.mjs';
import { probeConnection } from '../src/lib/provider-auth/connections.mjs';
import { withOperationSignal } from '../src/lib/operation-scope.mjs';
async function listen(t, handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}`;
}
test('45-second provider stage succeeds through the control HTTP hop', { timeout: 60_000 }, async t => {
  const provider = await listen(t, createSafeHttpListener(async (req, res, path, signal) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    if (path.endsWith('/models')) { res.end('{"data":[{"id":"fixture"}]}'); return; }
    const body = JSON.parse(raw);
    if (!body.tool_choice) await delay(45_000, undefined, { signal });
    const message = body.tool_choice === 'auto'
      ? { role: 'assistant', content: null, tool_calls: [{ id: 'slow-probe', type: 'function', function: { name: 'probe_echo', arguments: '{"word":"куб","n":7}' } }] }
      : { role: 'assistant', content: 'готово' };
    res.end(JSON.stringify({ choices: [{ message }] }));
  }));
  const app = await listen(t, createSafeHttpListener(async (req, res, _path, signal) => {
    for await (const _chunk of req) {}
    const report = await withOperationSignal(signal, () => probeConnection({ baseUrl: provider + '/v1', model: 'fixture' }));
    res.end(JSON.stringify({ ok: true, result: report }));
  }));
  const client = createControlClient({ url: app, token: 'isolated-test-token' });
  const report = await client('models.test_and_connect', {});
  assert.equal(report.ok, true);
  assert.ok(report.stages.chat.ms >= 44_000);
  assert.deepEqual(Object.keys(report.stages), ['models', 'chat', 'tool_call', 'tool_result']);
});
