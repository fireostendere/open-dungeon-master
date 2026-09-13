import assert from 'node:assert/strict';
import { test } from 'node:test';
import { safeAuthUrl, loopbackOrigin, equalSecret, canApplyProfile, profileHasChanged, validateChat, publicError, ProviderError, requestIsSameOrigin } from '../src/lib/provider-auth/core.mjs';
for (const host of ['auth.openai.com', 'chatgpt.com']) {
  test(`official login host ${host}`, () => assert.equal(safeAuthUrl(`https://${host}/login`), `https://${host}/login`));
}
for (const url of ['http://auth.openai.com/', 'https://auth.openai.com.evil.test/', 'https://user@chatgpt.com/']) {
  test(`untrusted login URL ${url}`, () => assert.throws(() => safeAuthUrl(url), ProviderError));
}
test('local origin excludes remote hosts and paths', () => {
  assert.equal(loopbackOrigin('http://127.0.0.1:3005'), 'http://127.0.0.1:3005');
  assert.throws(() => loopbackOrigin('https://example.test'));
  assert.throws(() => loopbackOrigin('http://localhost/path'));
});
test('secret comparison handles invalid values', () => {
  const key = 'a'.repeat(64);
  assert.equal(equalSecret(key, key), true);
  for (const value of [null, '', 'b'.repeat(64)]) assert.equal(equalSecret(key, value), false);
});
test('model application requires all three probe stages', () => {
  const stages = { chat: { ok: true }, tool_call: { ok: true }, tool_result: { ok: true } };
  assert.equal(canApplyProfile({ lastCheck: { ok: true, stages } }), true);
  assert.equal(canApplyProfile({ lastCheck: null }), false);
  assert.equal(canApplyProfile({ lastCheck: { ok: true, stages: {} } }), false);
});
test('connection changes differ from cosmetic changes', () => {
  const profile = { model: 'fixture', name: 'one' };
  assert.equal(profileHasChanged(profile, { ...profile, name: 'two' }), false);
  assert.equal(profileHasChanged(profile, { ...profile, model: 'other' }), true);
});
test('invalid chat and arbitrary errors fail safely', () => {
  assert.throws(() => validateChat({}));
  assert.equal(publicError(new Error('private upstream detail')), 'PROVIDER_OPERATION_FAILED');
});
function originRequest(headers={}) {
  return new Request('http://localhost:3005/api/admin/provider-auth',{method:'POST',headers:{host:'127.0.0.1:3005',origin:'http://127.0.0.1:3005','content-type':'application/json','x-odm-provider-auth':'1',...headers}});
}
function configuredOrigin(value,fn) {
  const previous=process.env.ODM_PUBLIC_ORIGIN;
  if(value===undefined)delete process.env.ODM_PUBLIC_ORIGIN;else process.env.ODM_PUBLIC_ORIGIN=value;
  try {fn();} finally {if(previous===undefined)delete process.env.ODM_PUBLIC_ORIGIN;else process.env.ODM_PUBLIC_ORIGIN=previous;}
}
test('browser destination Host wins over Next internal request URL',()=>configuredOrigin(undefined,()=>{
  assert.equal(requestIsSameOrigin(originRequest()),true);
  assert.equal(requestIsSameOrigin(originRequest({host:'[::1]:3005',origin:'http://[::1]:3005'})),true);
  assert.equal(requestIsSameOrigin(originRequest({host:'game.local:80',origin:'http://game.local'})),true);
}));
test('wrong origin, wrong port and missing browser request markers fail closed',()=>configuredOrigin(undefined,()=>{
  for(const origin of ['https://evil.test','http://127.0.0.1:3006','null',''])assert.equal(requestIsSameOrigin(originRequest({origin})),false);
  assert.equal(requestIsSameOrigin(originRequest({'x-odm-provider-auth':''})),false);
  assert.equal(requestIsSameOrigin(originRequest({'content-type':'text/plain'})),false);
}));
test('public origin pins reverse-proxy target independently of request headers',()=>configuredOrigin('https://game.example.test',()=>{
  assert.equal(requestIsSameOrigin(originRequest({origin:'https://game.example.test'})),true);
  assert.equal(requestIsSameOrigin(originRequest()),false);
  assert.equal(requestIsSameOrigin(originRequest({host:'evil.test',origin:'http://evil.test'})),false);
}));
test('forwarded or malformed Host cannot override browser origin checks',()=>configuredOrigin(undefined,()=>{
  assert.equal(requestIsSameOrigin(originRequest({origin:'https://evil.test','x-forwarded-host':'evil.test','x-forwarded-proto':'https'})),false);
  for(const host of ['user@127.0.0.1:3005','evil.test/path','evil.test?x=1','evil.test,127.0.0.1:3005','evil.test\\path','bad%20host'])assert.equal(requestIsSameOrigin(originRequest({host})),false);
}));
test('invalid deployment origin fails closed',()=>{
  for(const value of ['not-a-url','https://game.test/path','https://user@game.test','file:///tmp'])configuredOrigin(value,()=>assert.equal(requestIsSameOrigin(originRequest()),false));
});
