import assert from 'node:assert/strict';
import { test } from 'node:test';
import { safeAuthUrl, loopbackOrigin, equalSecret, canApplyProfile, profileHasChanged, validateChat, publicError, ProviderError } from '../src/lib/provider-auth/core.mjs';
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
