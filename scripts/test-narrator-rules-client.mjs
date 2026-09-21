import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { RulesMcpClient } from '../narrator/rules-client.mjs';

function fakeRulesProcess({ extraTool = null } = {}) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => { child.killed = true; queueMicrotask(() => child.emit('exit', 0, null)); return true; };
  let buffer = '';
  const requests = [];
  child.stdin.on('data', chunk => {
    buffer += chunk.toString('utf8');
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line); requests.push(message);
      if (!Object.hasOwn(message, 'id')) continue;
      let result;
      if (message.method === 'initialize') {
        result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'dnd-rules', version: 'test' } };
      } else if (message.method === 'tools/list') {
        const names = ['rules_search','rules_get','rules_sources','rules_status', ...(extraTool ? [extraTool] : [])];
        result = { tools: names.map(name => ({ name, inputSchema: { type: 'object' } })) };
      } else if (message.method === 'tools/call' && message.params?.name === 'rules_search') {
        result = { content: [{ type: 'text', text: JSON.stringify({
          query: message.params.arguments.query,
          edition: 'test-srd', source: 'fixture', audience: 'public_rules',
          corpus_revision: 'a'.repeat(64), cache_hit: false,
          confidence: { level: 'medium', knowledge_gap: false, reason: 'fixture', lexical_coverage: 0.5 },
          hits: [{ document_id: 'doc-1', title: 'Rules', source: 'fixture', section: 'Combat', page_start: 1, page_end: 1,
            lexical_coverage: 0.5, snippet: 'Leaving reach may trigger a reaction.' }],
          context: '<untrusted_rules_evidence>fixture</untrusted_rules_evidence>',
        }) }] };
      } else {
        child.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'not found' } }) + '\n');
        continue;
      }
      child.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n');
    }
  });
  return { child, requests };
}

test('rules MCP client negotiates exact read-only surface and sanitizes search evidence', async () => {
  const fixture = fakeRulesProcess();
  const client = new RulesMcpClient({
    python: '/opt/test/python', edition: 'test-srd', collection: 'dnd_srd',
    spawnImpl: () => fixture.child, timeoutMs: 2000,
  });
  const result = await client.search('opportunity attack');
  assert.equal(result.ok, true);
  assert.equal(result.edition, 'test-srd');
  assert.equal(result.audience, 'public_rules');
  assert.equal(result.corpusRevision, 'a'.repeat(64));
  assert.equal(result.hits[0].documentId, 'doc-1');
  assert.equal(result.untrusted, true);
  assert.ok(fixture.requests.some(request => request.method === 'initialize'));
  assert.ok(fixture.requests.some(request => request.method === 'tools/list'));
  const call = fixture.requests.find(request => request.method === 'tools/call');
  assert.equal(call.params.name, 'rules_search');
  assert.equal(call.params.arguments.edition, 'test-srd');
  assert.equal(call.params.arguments.audience, 'public_rules');

  const before = fixture.requests.length;
  await assert.rejects(client.call('knowledge_ingest', { source: '/tmp/x' }), /not allowed/);
  assert.equal(fixture.requests.length, before, 'disallowed tool must not reach the subprocess');
  await client.close();
});

test('rules MCP client fails closed when subprocess advertises an extra tool', async () => {
  const fixture = fakeRulesProcess({ extraTool: 'knowledge_ingest' });
  const client = new RulesMcpClient({
    python: '/opt/test/python', edition: 'test-srd',
    spawnImpl: () => fixture.child, timeoutMs: 2000,
  });
  await assert.rejects(client.start(), /unexpected tool surface/);
  assert.equal(client.child, null);
  await client.close();
});

test('rules MCP client clips retrieved evidence before it reaches the referee', () => {
  const fixture = fakeRulesProcess();
  const client = new RulesMcpClient({
    python: '/opt/test/python', edition: 'test-srd',
    spawnImpl: () => fixture.child,
  });
  const value = client.sanitizeSearch({
    edition: 'test-srd', source: 'x'.repeat(500), corpus_revision: 'b'.repeat(64),
    confidence: { level: 'high', reason: 'r'.repeat(900), lexical_coverage: 1 },
    hits: [{ document_id: 'd'.repeat(500), title: 't'.repeat(500), snippet: 's'.repeat(2000) }],
    context: 'c'.repeat(20000),
  }, 'query');
  assert.equal(value.source.length, 200);
  assert.equal(value.hits[0].documentId.length, 120);
  assert.equal(value.hits[0].title.length, 240);
  assert.equal(value.hits[0].snippet.length, 700);
  assert.equal(value.context.length, 12000);
  assert.equal(value.confidence.reason.length, 400);
});
