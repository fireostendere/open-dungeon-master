import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCallPreferences, captureConstraints, microphoneEnabled, DEFAULT_CALL_PREFERENCES, PTT_KEYS } from '../src/lib/voice/call-preferences.ts';
import { summarizeAudioStats, EMPTY_DIAGNOSTICS } from '../src/lib/voice/call-diagnostics.ts';

test('new devices join muted without enabling recording or changing rooms', () => {
  assert.equal(DEFAULT_CALL_PREFERENCES.startMuted, true);
  assert.deepEqual(Object.keys(DEFAULT_CALL_PREFERENCES).sort(), ['autoGainControl','echoCancellation','layout','noiseSuppression','pttKey','startMuted'].sort());
});
for (const raw of [null, '', '{', 'null', '[]', '42', 'false']) test(`preferences recover from ${String(raw)}`, () => {
  assert.deepEqual(parseCallPreferences(raw), DEFAULT_CALL_PREFERENCES);
});
test('preferences validate booleans, hotkeys and layouts instead of coercing strings', () => {
  const p = parseCallPreferences('{"noiseSuppression":"false","pttKey":"F5","layout":"<script>","startMuted":false}');
  assert.equal(p.noiseSuppression, true); assert.equal(p.pttKey, 'Backquote'); assert.equal(p.layout, 'grid'); assert.equal(p.startMuted, false);
});
test('all exposed PTT key choices round-trip', () => {
  for (const pttKey of PTT_KEYS) assert.equal(parseCallPreferences(JSON.stringify({ pttKey })).pttKey, pttKey);
});
test('capture only asks for audio; default device is an ideal rather than exact constraint', () => {
  assert.equal(captureConstraints('abc').video, false);
  assert.deepEqual(captureConstraints('abc').audio.deviceId, { ideal: 'abc' });
  assert.deepEqual(captureConstraints('abc', true).audio.deviceId, { exact: 'abc' });
  assert.equal('deviceId' in captureConstraints('').audio, false);
});
test('processing choices reach actual getUserMedia constraints', () => {
  assert.deepEqual(captureConstraints('', false, { ...DEFAULT_CALL_PREFERENCES, noiseSuppression:false, autoGainControl:false }).audio,
    { echoCancellation:true, noiseSuppression:false, autoGainControl:false });
});
test('manual mute always wins over open mic and held PTT', () => {
  for (const mode of ['open','ptt']) for (const held of [true,false]) assert.equal(microphoneEnabled(true, mode, held), false);
});
test('PTT is silent before the first hold, including initial publication and device replacement', () => {
  assert.equal(microphoneEnabled(false,'ptt',false), false);
  assert.equal(microphoneEnabled(false,'ptt',true), true);
  assert.equal(microphoneEnabled(false,'open',false), true);
});
test('missing network statistics remain unknown, not fabricated zero or good quality', () => {
  assert.deepEqual(summarizeAudioStats([]), EMPTY_DIAGNOSTICS);
});
test('jitter and selected-path RTT convert seconds to milliseconds', () => {
  const d=summarizeAudioStats([{id:'candidate',type:'candidate-pair',state:'succeeded',nominated:true,currentRoundTripTime:.045},
    {id:'other',type:'candidate-pair',state:'succeeded',currentRoundTripTime:9},
    {id:'a',type:'inbound-rtp',kind:'audio',jitter:.007}]);
  assert.equal(d.rttMs,45); assert.equal(d.jitterMs,7); assert.equal(d.lossPercent,null);
});
test('loss and bitrate use deltas, not lifetime packet counters', () => {
  const before=[{id:'a',type:'inbound-rtp',kind:'audio',timestamp:1000,packetsReceived:1000,packetsLost:30,bytesReceived:10000}];
  const now=[{...before[0],timestamp:3000,packetsReceived:1095,packetsLost:35,bytesReceived:18000}];
  const d=summarizeAudioStats(now,before); assert.equal(d.lossPercent,5); assert.equal(d.receiveKbps,32);
});
test('video traffic, NaNs and invalid candidate pairs are not audio metrics', () => {
  const d=summarizeAudioStats([{id:'v',type:'inbound-rtp',kind:'video',jitter:5},
    {id:'c',type:'candidate-pair',state:'failed',nominated:true,currentRoundTripTime:8},
    {id:'a',type:'inbound-rtp',kind:'audio',jitter:NaN}]); assert.deepEqual(d,EMPTY_DIAGNOSTICS);
});
test('counter resets and backwards timestamps never create negative rates', () => {
  const old={id:'a',type:'inbound-rtp',kind:'audio',timestamp:5000,packetsReceived:100,packetsLost:5,bytesReceived:10000};
  for (const now of [{...old,timestamp:4000},{...old,timestamp:6000,packetsReceived:0,bytesReceived:0,packetsLost:0}]) {
    const d=summarizeAudioStats([now],[old]); assert.equal(d.receiveKbps,null); assert.equal(d.lossPercent,null);
  }
});
test('diagnostic projection never returns addresses, room or participant identifiers', () => {
  const d=summarizeAudioStats([{id:'secret-user',type:'candidate-pair',state:'succeeded',nominated:true,currentRoundTripTime:.04,address:'192.0.2.1',token:'secret'}]);
  assert.deepEqual(Object.keys(d).sort(),Object.keys(EMPTY_DIAGNOSTICS).sort());
  assert.equal(JSON.stringify(d).includes('secret'),false); assert.equal(JSON.stringify(d).includes('192.0.2.1'),false);
});
