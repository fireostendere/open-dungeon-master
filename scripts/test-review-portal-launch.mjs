// Real child process and private files; Next itself is not substituted into a
// full application test. Existing portal credential validation runs unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { parsePortalOptions, portalLaunchSpec, launchPortal, portalHelp } from './launch-portal.mjs';
import { loadReviewModule } from './lib/review-module.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const portal = loadReviewModule(path.join(root, 'src/lib/portal.ts'));
const trust = loadReviewModule(path.join(root, 'src/lib/portal-trust.ts'), { '@/lib/portal': portal });
const token = 'isolated-test-token-012345678901234567890';
function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'odm-portal-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const tokenFile = path.join(directory, 'token');
  writeFileSync(tokenFile, token + '\n', { mode: 0o600 });
  return { directory, options: { origin: 'https://game.example.org', tokenFile, port: 3007 } };
}
function pins(spec) { return { enabled: spec.env.ODM_LOCAL_PORTAL, origin: spec.env.ODM_PORTAL_ORIGIN, token: spec.env.ODM_PORTAL_TOKEN }; }
function cookies(origin = 'https://game.example.org', value = token) { return name => name === portal.PORTAL_ORIGIN_COOKIE ? origin : name === portal.PORTAL_TOKEN_COOKIE ? value : undefined; }

test('CLI options are explicit; hostname and inline credentials cannot be injected', () => {
  assert.deepEqual(parsePortalOptions(['--origin','https://game.example.org','--token-file','/private/token','--dev','--port','3010']), {origin:'https://game.example.org',tokenFile:'/private/token',dev:true,port:3010});
  for (const argv of [['--hostname','0.0.0.0'],['--token',token],['--origin'],['--port','3e3'],['--port','3007','--port','3008']]) assert.throws(() => parsePortalOptions(argv));
  assert.match(portalHelp(), /127\.0\.0\.1/);
});
test('trusted launcher overwrites inherited pins and binds Next to loopback', t => {
  const f = fixture(t);
  const spec = portalLaunchSpec(f.options, {nextCli:'/fixture/next',environment:{ODM_LOCAL_PORTAL:'0',ODM_PORTAL_ORIGIN:'http://evil.test',ODM_PORTAL_TOKEN:'wrong',HOSTNAME:'0.0.0.0',KEEP:'yes'}});
  assert.deepEqual(spec.args, ['/fixture/next','start','--hostname','127.0.0.1','--port','3007']);
  assert.equal(spec.env.HOSTNAME,'127.0.0.1');assert.equal(spec.env.KEEP,'yes');
  assert.deepEqual(trust.trustedPortalFromCookies(cookies(),pins(spec)), {origin:f.options.origin,token});
  assert.ok(!JSON.stringify(spec.args).includes(token));
});
test('public/default-off mode ignores valid-looking portal cookies', () => {
  for (const config of [{},{enabled:'0'}, {origin:'https://game.example.org',token}]) assert.equal(trust.trustedPortalFromCookies(cookies(),config),null);
});
test('client cookies cannot change the pinned origin or bearer', t => {
  const f=fixture(t), spec=portalLaunchSpec(f.options,{nextCli:'/fixture/next'});
  for (const [origin,value] of [['http://169.254.169.254',token],['https://other.example.org',token],[f.options.origin,'another-valid-token-0000000000000000000']]) assert.equal(trust.trustedPortalFromCookies(cookies(origin,value),pins(spec)),null);
});
test('invalid origins, ports and self-forwarding loops are refused', t => {
  const f=fixture(t);
  for (const origin of ['file:///etc/passwd','https://user:pass@example.org','https://example.org/path','https://example.org/?key=secret','https://example.org/#token','http://127.0.0.1:3007','http://[::1]:3007']) assert.throws(()=>portalLaunchSpec({...f.options,origin},{nextCli:'/fixture/next'}));
  for (const port of [0,1023,65536,1.2,NaN]) assert.throws(()=>portalLaunchSpec({...f.options,port},{nextCli:'/fixture/next'}));
});
test('missing, oversized, empty and malformed token files fail closed', t => {
  const f=fixture(t);
  assert.throws(()=>portalLaunchSpec({...f.options,tokenFile:path.join(f.directory,'missing')},{nextCli:'/fixture/next'}));
  for (const value of ['', 'too-short', 'a'.repeat(1025), token+'\nother-token', 'x'.repeat(513)]) {
    writeFileSync(f.options.tokenFile,value);assert.throws(()=>portalLaunchSpec(f.options,{nextCli:'/fixture/next'}));
  }
});
test('group-readable and symlink credentials are refused on POSIX', {skip:process.platform==='win32'}, t => {
  const f=fixture(t);chmodSync(f.options.tokenFile,0o644);
  assert.throws(()=>portalLaunchSpec(f.options,{nextCli:'/fixture/next'}));
  chmodSync(f.options.tokenFile,0o600);const link=path.join(f.directory,'link');symlinkSync(f.options.tokenFile,link);
  assert.throws(()=>portalLaunchSpec({...f.options,tokenFile:link},{nextCli:'/fixture/next'}));
});
test('actual launched child receives pins, loopback flags and no bearer in argv', async t => {
  const f=fixture(t), childScript=path.join(f.directory,'child.mjs'), output=path.join(f.directory,'result.json');
  writeFileSync(childScript, "import fs from 'node:fs'; fs.writeFileSync(process.env.TEST_OUTPUT, JSON.stringify({argv:process.argv.slice(2),enabled:process.env.ODM_LOCAL_PORTAL,origin:process.env.ODM_PORTAL_ORIGIN,token:process.env.ODM_PORTAL_TOKEN,host:process.env.HOSTNAME}),{mode:0o600});");
  const child=launchPortal(f.options,{nextCli:childScript,environment:{TEST_OUTPUT:output}});
  const [code]=await once(child,'close');assert.equal(code,0);
  const result=JSON.parse(readFileSync(output,'utf8'));
  assert.equal(result.enabled,'1');assert.equal(result.origin,f.options.origin);assert.equal(result.token,token);assert.equal(result.host,'127.0.0.1');
  assert.deepEqual(result.argv,['start','--hostname','127.0.0.1','--port','3007']);
});
test('help and CLI errors neither launch a server nor disclose token contents', t => {
  const f=fixture(t), script=path.join(root,'scripts/launch-portal.mjs');
  const help=spawnSync(process.execPath,[script,'--help'],{encoding:'utf8'});assert.equal(help.status,0);
  const error=spawnSync(process.execPath,[script,'--origin','bad','--token-file',f.options.tokenFile],{encoding:'utf8'});
  assert.equal(error.status,1);assert.ok(!(error.stdout+error.stderr).includes(token));
});
