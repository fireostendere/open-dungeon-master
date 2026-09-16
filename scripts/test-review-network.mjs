import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { assertSafeEndpointUrl, createSafeEndpointFetch, SsrfError } from '../src/lib/safe-endpoint.mjs';

for (const endpoint of ['http://127.0.0.1:11434/v1', 'http://192.168.1.50/v1', 'http://[::1]:11434/v1', 'https://[2606:4700::1111]/', 'http://[fd12::1]/']) {
  test(`allows intentional endpoint ${endpoint}`, () => assert.doesNotThrow(() => assertSafeEndpointUrl(endpoint)));
}
for (const host of ['169.254.169.254', '169.254.1.2', '100.100.100.200', '[fe80::1]', '[fd00:ec2:0:0:0:0:0:254]', '[::ffff:169.254.169.254]', '[::ffff:a9fe:a9fe]', 'metadata.google.internal.', '[::]']) {
  test(`blocks metadata/invalid address ${host}`, () => assert.throws(() => assertSafeEndpointUrl(`http://${host}/`), SsrfError));
}
test('rejects credentials and non-HTTP schemes', () => {
  for (const url of ['http://user:pass@localhost/', 'file:///etc/passwd', 'ftp://localhost/']) assert.throws(() => assertSafeEndpointUrl(url), SsrfError);
});
async function fixture(t, handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return server.address().port;
}
test('resolves once, pins the connection, preserves Host, streams and decodes response', async t => {
  let lookups = 0;
  const port = await fixture(t, async (req, res) => {
    assert.equal(req.headers.host, `provider.test:${port}`);
    assert.equal(req.url, '/v1/chat?stream=1');
    let body = ''; for await (const chunk of req) body += chunk;
    assert.equal(body, '{"model":"fixture"}');
    res.writeHead(200, { 'content-encoding': 'gzip' });
    res.end(gzipSync('first\nsecond\n'));
  });
  const fetch = createSafeEndpointFetch({ resolver: async () => {
    lookups++;
    return [{ address: lookups === 1 ? '127.0.0.1' : '169.254.169.254', family: 4 }];
  } });
  const response = await fetch(`http://provider.test:${port}/v1/chat?stream=1`, { method: 'POST', body: '{"model":"fixture"}' });
  assert.equal(await response.text(), 'first\nsecond\n');
  assert.equal(lookups, 1);
  await assert.rejects(fetch(`http://provider.test:${port}/`), SsrfError);
});
test('rejects all DNS answers when even one is forbidden', async () => {
  const fetch = createSafeEndpointFetch({ resolver: async () => [{ address: '127.0.0.1', family: 4 }, { address: '169.254.169.254', family: 4 }] });
  await assert.rejects(fetch('http://mixed.test/'), SsrfError);
});
test('never follows redirects to a new destination', async t => {
  let hits = 0;
  const port = await fixture(t, (_req, res) => { hits++; res.writeHead(302, { location: 'http://169.254.169.254/latest' }); res.end(); });
  const fetch = createSafeEndpointFetch();
  await assert.rejects(fetch(`http://127.0.0.1:${port}/`), SsrfError);
  const manual = await fetch(`http://127.0.0.1:${port}/`, { redirect: 'manual' });
  assert.equal(manual.status, 302); await manual.text();
  assert.equal(hits, 2);
});
test('abort during DNS prevents connecting and abort during body reading stops the stream', async t => {
  const controller = new AbortController();
  const fetchDns = createSafeEndpointFetch({ resolver: () => new Promise(() => {}) });
  const waiting = fetchDns('http://waiting.test/', { signal: controller.signal });
  controller.abort();
  await assert.rejects(waiting, { name: 'AbortError' });
  const port = await fixture(t, (_req, res) => { res.writeHead(200); res.write('prefix'); });
  const streamController = new AbortController();
  const response = await createSafeEndpointFetch()(`http://127.0.0.1:${port}/`, { signal: streamController.signal });
  const reading = response.text(); streamController.abort();
  await assert.rejects(reading, { name: 'AbortError' });
});
